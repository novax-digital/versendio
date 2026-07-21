-- Vouchers: admin-created gift-credit codes the customer redeems on the credit
-- page. Redemption books plain gift credit through the single money entry point
-- (book_credit, type 'topup', reference_type 'voucher', reference_id
-- '<voucher>:<user>') — no payment, no VAT, exactly like the top-up bonus. The
-- ledger's unique (type, reference_type, reference_id) index is the last-line
-- guard against a per-user double redemption.

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  amount_cents integer not null check (amount_cents > 0),
  -- null = unlimited total redemptions
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0,
  -- null = never expires
  valid_until timestamptz,
  is_active boolean not null default true,
  comment text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Codes are matched case-insensitively; the upper() form is the unique key.
create unique index uq_vouchers_code on public.vouchers (upper(code));
create trigger trg_vouchers_touch before update on public.vouchers
  for each row execute function public.touch_updated_at();

create table public.voucher_redemptions (
  id uuid primary key default gen_random_uuid(),
  -- restrict: a redeemed voucher must not be hard-deleted (keeps the audit
  -- trail and lets redemption_count stay meaningful).
  voucher_id uuid not null references public.vouchers (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  credit_tx_id uuid not null references public.credit_transactions (id) on delete restrict,
  amount_cents integer not null,
  created_at timestamptz not null default now(),
  -- One redemption per (voucher, user).
  unique (voucher_id, user_id)
);
create index idx_voucher_redemptions_voucher on public.voucher_redemptions (voucher_id);
create index idx_voucher_redemptions_user on public.voucher_redemptions (user_id);

alter table public.vouchers enable row level security;
alter table public.voucher_redemptions enable row level security;

-- Codes are secrets: only admins may read the voucher table. Every write goes
-- through the service role (admin CRUD) or the SECURITY DEFINER redeem RPC, so
-- there are deliberately no client write policies.
create policy vouchers_select_admin on public.vouchers
  for select to authenticated using (public.is_admin());

-- A user may see their own redemptions; admins see all.
create policy voucher_redemptions_select_own on public.voucher_redemptions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Redemption entry point. SECURITY DEFINER: validates, books and records in one
-- transaction, serialized on the voucher row (FOR UPDATE) so max_redemptions can
-- never oversell under concurrency. Raises a stable error code on every reject
-- so the server action can map it to a German message.
create or replace function public.redeem_voucher(p_user_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_voucher public.vouchers;
  v_norm text := upper(btrim(coalesce(p_code, '')));
  v_tx_id uuid;
  v_balance integer;
begin
  if v_norm = '' then
    raise exception 'voucher_not_found';
  end if;

  select * into v_voucher
  from public.vouchers
  where upper(code) = v_norm
  for update;

  if not found then raise exception 'voucher_not_found'; end if;
  if not v_voucher.is_active then raise exception 'voucher_inactive'; end if;
  if v_voucher.valid_until is not null and v_voucher.valid_until < now() then
    raise exception 'voucher_expired';
  end if;
  if v_voucher.max_redemptions is not null
     and v_voucher.redemption_count >= v_voucher.max_redemptions then
    raise exception 'voucher_exhausted';
  end if;
  if exists (
    select 1 from public.voucher_redemptions
    where voucher_id = v_voucher.id and user_id = p_user_id
  ) then
    raise exception 'voucher_already_redeemed';
  end if;

  -- Gift credit through the single money entry point (no VAT, like the bonus).
  v_tx_id := public.book_credit(
    p_user_id,
    'topup',
    v_voucher.amount_cents,
    'voucher',
    v_voucher.id::text || ':' || p_user_id::text,
    'Gutschein eingelöst: ' || v_voucher.code,
    'voucher'
  );

  insert into public.voucher_redemptions (voucher_id, user_id, credit_tx_id, amount_cents)
  values (v_voucher.id, p_user_id, v_tx_id, v_voucher.amount_cents);

  update public.vouchers
  set redemption_count = redemption_count + 1
  where id = v_voucher.id;

  select credit_balance_cents into v_balance from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'amount_cents', v_voucher.amount_cents,
    'balance_cents', v_balance,
    'code', v_voucher.code
  );
end;
$$;

-- Money moves only server-side: clients never call this directly, the server
-- action invokes it with the service role and the caller's own user id.
revoke all on function public.redeem_voucher(uuid, text) from public;
revoke all on function public.redeem_voucher(uuid, text) from anon, authenticated;
grant execute on function public.redeem_voucher(uuid, text) to service_role;
