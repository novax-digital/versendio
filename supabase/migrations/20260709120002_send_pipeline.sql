-- Send pipeline: atomic job confirmation (ADR-0003 §4, ADR-0004 §6).
-- One transaction: idempotency check (client_token), send_job insert, credit
-- debit via book_credit, item inserts, submit_item queue jobs. Any failure
-- (incl. insufficient_funds) rolls back everything.

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
revoke all on function public.confirm_send_job(uuid, uuid, uuid, jsonb, boolean, boolean, public.registered_type, boolean, timestamptz, public.letter_provider, integer, integer, jsonb) from public;
revoke all on function public.confirm_send_job(uuid, uuid, uuid, jsonb, boolean, boolean, public.registered_type, boolean, timestamptz, public.letter_provider, integer, integer, jsonb) from anon, authenticated;
grant execute on function public.confirm_send_job(uuid, uuid, uuid, jsonb, boolean, boolean, public.registered_type, boolean, timestamptz, public.letter_provider, integer, integer, jsonb) to service_role;

-- Cancels all still-pending items of a job (Stornofrist / user cancel before
-- submission) and refunds them in one transaction. Returns refunded cents.
create or replace function public.cancel_pending_job_items(p_job_id uuid, p_actor text default 'user')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_refund integer := 0;
  v_canceled integer;
begin
  select id, user_id, is_test into v_job from public.send_jobs where id = p_job_id for update;
  if v_job is null then
    raise exception 'job_not_found';
  end if;

  -- Cancel pending/held items; their queue jobs become no-ops via status guard.
  with canceled as (
    update public.send_job_items
    set status = 'canceled'
    where job_id = p_job_id and status in ('pending', 'on_hold_funds')
    returning vk_cents
  )
  select coalesce(sum(vk_cents), 0), count(*) into v_refund, v_canceled from canceled;

  if v_canceled = 0 then
    return 0;
  end if;

  if not v_job.is_test and v_refund > 0 then
    perform public.book_credit(
      v_job.user_id, 'refund', v_refund, 'job_cancel_rest', p_job_id::text,
      null, p_actor, null, null);
  end if;

  -- Job status: canceled when nothing was submitted, otherwise keep processing
  -- (the status sync will complete it once submitted items are final).
  update public.send_jobs
  set status = case
    when not exists (select 1 from public.send_job_items where job_id = p_job_id and status not in ('canceled')) then 'canceled'::public.send_job_status
    else status
  end
  where id = p_job_id;

  return v_refund;
end;
$$;
revoke all on function public.cancel_pending_job_items(uuid, text) from public;
revoke all on function public.cancel_pending_job_items(uuid, text) from anon, authenticated;
grant execute on function public.cancel_pending_job_items(uuid, text) to service_role;

-- Weekly/daily integrity check: the append-only ledger is the truth, the
-- denormalized balance must always match its sum (ADR-0003 §6).
create or replace function public.check_ledger_integrity()
returns table (user_id uuid, balance integer, ledger_sum bigint)
language sql
security definer
set search_path = public
as $$
  select p.id, p.credit_balance_cents, coalesce(sum(t.amount_cents), 0)
  from public.profiles p
  left join public.credit_transactions t on t.user_id = p.id
  group by p.id, p.credit_balance_cents
  having p.credit_balance_cents <> coalesce(sum(t.amount_cents), 0);
$$;
revoke all on function public.check_ledger_integrity() from public;
revoke all on function public.check_ledger_integrity() from anon, authenticated;
grant execute on function public.check_ledger_integrity() to service_role;
