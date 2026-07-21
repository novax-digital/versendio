-- Per-end-customer usage rollup for the whitelabel dashboard and the
-- /api/v1/customers/{id}/usage endpoint (one source of truth). Billing
-- semantics: only items with status 'sent' count (that is what DP invoices,
-- ADR-0007); refunded failures are reported separately; test jobs excluded.
-- VK only — EK never leaves the operator side. Time range filters on
-- submitted_at (the billing anchor used by admin_dashboard_stats).
create or replace function public.wl_customer_usage(
  p_user_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  customer_id uuid,
  letters_sent bigint,
  cost_cents bigint,
  letters_failed_refunded bigint
)
language sql
security definer
set search_path = public
as $$
  select
    j.wl_customer_id,
    count(*) filter (where i.status = 'sent'),
    coalesce(sum(i.vk_cents) filter (where i.status = 'sent'), 0),
    count(*) filter (where i.status = 'failed' and i.refunded_at is not null)
  from public.send_job_items i
  join public.send_jobs j on j.id = i.job_id
  where j.user_id = p_user_id
    and j.wl_customer_id is not null
    and j.is_test = false
    and (p_from is null or i.submitted_at >= p_from)
    and (p_to is null or i.submitted_at < p_to)
  group by j.wl_customer_id
$$;
revoke all on function public.wl_customer_usage(uuid, timestamptz, timestamptz) from public;
revoke all on function public.wl_customer_usage(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.wl_customer_usage(uuid, timestamptz, timestamptz) to service_role;
