-- Credit rewards for public reviews (Trustpilot / LinkedIn). A customer submits
-- the link to their review; an admin approves it and the snapshotted amount is
-- credited automatically. Money is granted only via book_credit; approval is
-- atomic and idempotent so a double-click cannot double-credit.

create type public.review_platform as enum ('trustpilot', 'linkedin');
create type public.review_reward_status as enum ('pending', 'approved', 'rejected');

create table public.review_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform public.review_platform not null,
  amount_cents integer not null check (amount_cents > 0),
  url text not null,
  status public.review_reward_status not null default 'pending',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_review_rewards_user on public.review_rewards (user_id, created_at desc);
create index idx_review_rewards_status on public.review_rewards (status, created_at);
-- One live request per platform per user (a rejected one may be re-submitted).
create unique index uq_review_rewards_live
  on public.review_rewards (user_id, platform)
  where status in ('pending', 'approved');

create trigger trg_review_rewards_touch before update on public.review_rewards
  for each row execute function public.touch_updated_at();

alter table public.review_rewards enable row level security;
-- Users read/insert their own; admins read all. Status changes happen via the
-- service role (server actions / RPC), never directly from the client.
create policy review_rewards_select on public.review_rewards
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy review_rewards_insert on public.review_rewards
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Atomic approval: flip pending → approved and credit the snapshotted amount in
-- one transaction. Reuses book_credit with a review_reward reference so a
-- retry (same reward id) is deduped by uq_credit_tx_reference. Returns the
-- credited amount, or NULL when the request was not pending.
create or replace function public.approve_review_reward(p_id uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_amount integer;
  v_platform public.review_platform;
begin
  update public.review_rewards
    set status = 'approved', reviewed_by = p_actor, reviewed_at = now()
    where id = p_id and status = 'pending'
    returning user_id, amount_cents, platform into v_user_id, v_amount, v_platform;
  if not found then
    return null;
  end if;

  perform public.book_credit(
    v_user_id,
    'topup',
    v_amount,
    'review_reward',
    p_id::text,
    case v_platform
      when 'trustpilot' then 'Bonus für Trustpilot-Bewertung'
      else 'Bonus für LinkedIn-Erfahrungsbericht'
    end,
    'admin',
    null,
    null
  );
  return v_amount;
end;
$$;
revoke all on function public.approve_review_reward(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_review_reward(uuid, uuid) to service_role;
