-- Admin KPI: split monthly top-ups into PAID (real Stripe money, net) and FREE
-- gift credit (top-up bonus, vouchers, review rewards). The webhook already
-- books bonus credit as a separate ledger row (reference_type 'stripe_bonus'),
-- so a 10 € purchase with 2 € bonus cleanly splits 10/2. Paid is exactly
-- reference_type = 'stripe_event'; everything else of type 'topup' is free
-- gift credit. admin_adjust corrections stay out of all three figures.
--
-- Return table changes → drop + recreate (create or replace cannot alter it).
drop function if exists public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz);

create function public.admin_dashboard_stats(
  p_month_start timestamptz,
  p_day_start timestamptz,
  p_since timestamptz
)
returns table (
  letters_sent_today bigint,
  letters_sent_month bigint,
  gross_profit_month_cents bigint,
  topup_revenue_month_cents bigint,
  topup_paid_month_cents bigint,
  topup_free_month_cents bigint,
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
    (select coalesce(sum(amount_cents), 0) from public.credit_transactions
       where type = 'topup' and reference_type = 'stripe_event'
         and created_at >= p_month_start),
    (select coalesce(sum(amount_cents), 0) from public.credit_transactions
       where type = 'topup' and reference_type is distinct from 'stripe_event'
         and created_at >= p_month_start),
    (select count(*) from public.send_job_items
       where status in ('sent', 'failed') and created_at >= p_since),
    (select count(*) from public.send_job_items
       where status = 'failed' and created_at >= p_since);
$$;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) to service_role;
