-- Send hardening (send-monitor audit 2026-07-28):
-- 1. Test sends (free, no debit) become admin-only, enforced at the money
--    choke point itself — the test flag reaches this RPC from client-controlled
--    payloads (wizard action, public API), so the app-layer gates alone are
--    not sufficient against future callers.
-- 2. The RPC no longer trusts p_total_vk_cents: it must equal the sum of the
--    per-item vk_cents, which cancel/refund accounting later reads back.
--    A mismatch would silently corrupt the ledger; fail loudly instead.

create or replace function public.confirm_send_job(
  p_user_id uuid,
  p_client_token uuid,
  p_letter_id uuid,
  p_sender_snapshot jsonb,
  p_is_color boolean,
  p_is_duplex boolean,
  p_registered public.registered_type,
  p_is_test boolean,
  p_scheduled_release_at timestamptz,
  p_provider public.letter_provider,
  p_total_vk_cents integer,
  p_total_ek_cents integer,
  p_items jsonb -- array of {contact_id, recipient_snapshot, vk_cents, ek_cents, pricing_snapshot, sheet_count}
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_run_at timestamptz;
  v_role text;
  v_items_vk integer;
begin
  -- Idempotency: a double-click/retry returns the already-created job.
  select id into v_existing
  from public.send_jobs
  where user_id = p_user_id and client_token = p_client_token;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'no_items';
  end if;

  -- Test sends bypass the debit below — admin-only.
  if p_is_test then
    select role into v_role from public.profiles where id = p_user_id;
    if v_role is distinct from 'admin' then
      raise exception 'test_send_forbidden';
    end if;
  end if;

  -- The job total must equal the item sum; refunds are computed per item.
  select coalesce(sum((item->>'vk_cents')::integer), 0) into v_items_vk
  from jsonb_array_elements(p_items) as item;
  if v_items_vk is distinct from p_total_vk_cents then
    raise exception 'total_mismatch';
  end if;

  begin
    insert into public.send_jobs
      (user_id, letter_id, sender_snapshot, is_color, is_duplex, registered,
       is_test, scheduled_release_at, client_token, status, total_items,
       total_vk_cents, total_ek_cents)
    values
      (p_user_id, p_letter_id, p_sender_snapshot, p_is_color, p_is_duplex,
       p_registered, p_is_test, p_scheduled_release_at, p_client_token, 'queued',
       jsonb_array_length(p_items), p_total_vk_cents, p_total_ek_cents)
    returning id into v_job_id;
  exception when unique_violation then
    -- Truly concurrent duplicate confirm: the loser gracefully returns the
    -- winner's job instead of surfacing an error.
    select id into v_existing
    from public.send_jobs
    where user_id = p_user_id and client_token = p_client_token;
    return v_existing;
  end;

  -- Test runs are free (MASTERPROMPT §6.4); real jobs debit the full sum.
  if not p_is_test and p_total_vk_cents > 0 then
    perform public.book_credit(
      p_user_id, 'spend', -p_total_vk_cents, 'job_confirm', v_job_id::text,
      null, 'user', null, null);
  end if;

  v_run_at := coalesce(p_scheduled_release_at, now());

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.send_job_items
      (job_id, user_id, contact_id, recipient_snapshot, sheet_count,
       vk_cents, ek_cents, pricing_snapshot, provider, status)
    values
      (v_job_id, p_user_id,
       nullif(v_item->>'contact_id', '')::uuid,
       v_item->'recipient_snapshot',
       (v_item->>'sheet_count')::integer,
       (v_item->>'vk_cents')::integer,
       (v_item->>'ek_cents')::integer,
       v_item->'pricing_snapshot',
       p_provider, 'pending')
    returning id into v_item_id;

    insert into public.job_queue (type, payload, run_at)
    values ('submit_item', jsonb_build_object('itemId', v_item_id), v_run_at);
  end loop;

  return v_job_id;
end;
$$;
