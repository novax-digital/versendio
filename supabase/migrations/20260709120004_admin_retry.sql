-- Admin retry of a failed send item, atomically (ADR-0003 §3 `item_retry`).
-- Mirrors confirm_send_job: claim + clone + debit + totals + queue job in ONE
-- transaction, so a partial failure can never charge without enqueueing.
--
-- `retried_at` claims the original exactly once (a second click finds no
-- unclaimed `failed` row and aborts). The original keeps status `failed` —
-- it did fail; the clone carries the new attempt. Reusing the original row
-- instead of cloning would collide on the ledger's unique
-- (type, reference_type, reference_id) index: its `item_failed` refund already
-- exists, which would make a second failure unrefundable.

alter table public.send_job_items
  add column if not exists retried_at timestamptz,
  add column if not exists retry_of_item_id uuid references public.send_job_items (id) on delete set null;

grant select (retried_at, retry_of_item_id) on public.send_job_items to authenticated;

create or replace function public.admin_retry_item(
  p_item_id uuid,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_is_test boolean;
  v_clone_id uuid;
begin
  -- Atomic claim: only an unclaimed failed item can be retried, exactly once.
  update public.send_job_items
  set retried_at = now()
  where id = p_item_id and status = 'failed' and retried_at is null
  returning * into v_item;

  if v_item is null then
    raise exception 'item_not_retryable';
  end if;

  select is_test into v_is_test from public.send_jobs where id = v_item.job_id for update;
  if not found then
    raise exception 'job_not_found';
  end if;

  insert into public.send_job_items
    (job_id, user_id, contact_id, recipient_snapshot, sheet_count, vk_cents,
     ek_cents, pricing_snapshot, provider, status, retry_of_item_id)
  values
    (v_item.job_id, v_item.user_id, v_item.contact_id, v_item.recipient_snapshot,
     v_item.sheet_count, v_item.vk_cents, v_item.ek_cents, v_item.pricing_snapshot,
     v_item.provider, 'pending', v_item.id)
  returning id into v_clone_id;

  -- The original was refunded when it failed, so the retry is paid for again.
  if not v_is_test and v_item.vk_cents > 0 then
    perform public.book_credit(
      v_item.user_id, 'spend', -v_item.vk_cents, 'item_retry', v_clone_id::text,
      'Erneuter Versandversuch (Admin)', p_actor, null, null);
  end if;

  -- Atomic increments (no read-modify-write: concurrent retries can't clobber).
  update public.send_jobs
  set total_items = total_items + 1,
      total_vk_cents = total_vk_cents + (case when v_is_test then 0 else v_item.vk_cents end),
      total_ek_cents = total_ek_cents + (case when v_is_test then 0 else v_item.ek_cents end),
      status = 'processing',
      completed_at = null
  where id = v_item.job_id;

  insert into public.job_queue (type, payload, run_at)
  values ('submit_item', jsonb_build_object('itemId', v_clone_id), now());

  return v_clone_id;
end;
$$;
revoke all on function public.admin_retry_item(uuid, text) from public;
revoke all on function public.admin_retry_item(uuid, text) from anon, authenticated;
grant execute on function public.admin_retry_item(uuid, text) to service_role;

-- Aggregated KPIs in SQL: transferring every row to compute sums silently
-- under-reports if PostgREST max-rows is configured, and does not scale.
create or replace function public.admin_dashboard_stats(
  p_month_start timestamptz,
  p_day_start timestamptz,
  p_since timestamptz
)
returns table (
  letters_sent_today bigint,
  letters_sent_month bigint,
  gross_profit_month_cents bigint,
  topup_revenue_month_cents bigint,
  items_final_30d bigint,
  items_failed_30d bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.send_job_items
       where status = 'sent' and submitted_at >= p_day_start),
    (select count(*) from public.send_job_items
       where status = 'sent' and submitted_at >= p_month_start),
    (select coalesce(sum(vk_cents - ek_cents), 0) from public.send_job_items
       where status = 'sent' and submitted_at >= p_month_start),
    (select coalesce(sum(amount_cents), 0) from public.credit_transactions
       where type = 'topup' and created_at >= p_month_start),
    (select count(*) from public.send_job_items
       where status in ('sent', 'failed') and created_at >= p_since),
    (select count(*) from public.send_job_items
       where status = 'failed' and created_at >= p_since);
$$;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) to service_role;
