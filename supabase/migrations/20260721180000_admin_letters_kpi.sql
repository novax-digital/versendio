-- Admin KPI semantics fix: "Briefe heute/Monat" counted only status 'sent'
-- (= billed by DP, which lags days behind), so freshly submitted letters
-- showed 0 all day. They now count letters HANDED TO the provider in the
-- window (submitted_at set, not failed/canceled, no test sends). Gross profit
-- deliberately stays on 'sent' — only billed letters are revenue truth.
-- Also adds jobs_active (send_jobs queued/processing) so the dashboard can
-- show active Sendungen alongside the internal job queue.
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
  items_failed_30d bigint,
  jobs_active bigint
)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from public.send_job_items i
       join public.send_jobs j on j.id = i.job_id
       where i.submitted_at >= p_day_start
         and i.status in ('submitted', 'accepted', 'checked', 'print_center', 'sent')
         and j.is_test = false),
    (select count(*) from public.send_job_items i
       join public.send_jobs j on j.id = i.job_id
       where i.submitted_at >= p_month_start
         and i.status in ('submitted', 'accepted', 'checked', 'print_center', 'sent')
         and j.is_test = false),
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
       where status = 'failed' and created_at >= p_since),
    (select count(*) from public.send_jobs
       where status in ('queued', 'processing'));
$$;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from public;
revoke all on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.admin_dashboard_stats(timestamptz, timestamptz, timestamptz) to service_role;
