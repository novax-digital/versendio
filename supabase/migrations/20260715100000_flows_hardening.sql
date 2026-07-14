-- Flows hardening (post-review):
--   1. GDPR: anonymize_account must delete flows/enrollments before the lists,
--      letters and contacts they reference with ON DELETE RESTRICT — otherwise
--      erasure of any user who owns a flow fails with a FK violation.
--   2. Retry backoff: a next_attempt_at column so held (retrying) enrollments
--      don't re-run every tick and starve freshly-due pending ones.

-- 1) Retry pacing column. Fresh rows are eligible at their scheduled_send_at;
--    held rows get pushed out by the scheduler's backoff.
alter table public.flow_enrollments
  add column next_attempt_at timestamptz not null default now();
update public.flow_enrollments set next_attempt_at = scheduled_send_at;

-- Replace the status-partial indexes with one keyed on the readiness column.
drop index if exists public.idx_flow_enrollments_due;
drop index if exists public.idx_flow_enrollments_held;
create index idx_flow_enrollments_ready on public.flow_enrollments (next_attempt_at)
  where status in ('pending', 'held');

-- Trigger now also seeds next_attempt_at = scheduled_send_at.
create or replace function public.enroll_contact_in_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flow_enrollments
    (flow_id, user_id, contact_id, scheduled_send_at, next_attempt_at,
     letter_id, is_color, is_duplex, registered)
  select f.id, f.user_id, new.contact_id,
         new.created_at + make_interval(mins => f.delay_minutes),
         new.created_at + make_interval(mins => f.delay_minutes),
         f.letter_id, f.is_color, f.is_duplex, f.registered
  from public.flows f
  where f.list_id = new.list_id and f.is_active
  on conflict (flow_id, contact_id) do nothing;
  return new;
end;
$$;

-- 2) GDPR erasure: remove flow rows first so the RESTRICT FKs to lists/letters
--    don't block the personal-data deletes that follow.
create or replace function public.anonymize_account(
  p_user_id uuid,
  p_actor_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_open_items integer;
  v_actor text := case when p_actor_user_id is null then 'self'
                       else 'admin:' || p_actor_user_id::text end;
begin
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  -- Refund everything not yet handed to the carrier.
  for v_job in
    select id from public.send_jobs
    where user_id = p_user_id and status in ('queued', 'processing')
  loop
    perform public.cancel_pending_job_items(v_job.id, v_actor);
  end loop;

  select count(*) into v_open_items
  from public.send_job_items
  where user_id = p_user_id
    and status in ('submitting', 'submitted', 'accepted', 'checked', 'print_center');

  -- Flows first: they reference lead_lists/letters with ON DELETE RESTRICT.
  delete from public.flow_enrollments where user_id = p_user_id;
  delete from public.flows where user_id = p_user_id;

  -- Personal data: hard delete.
  delete from public.lead_list_entries
    where list_id in (select id from public.lead_lists where user_id = p_user_id);
  delete from public.lead_lists where user_id = p_user_id;
  delete from public.contacts where user_id = p_user_id;
  delete from public.letters where user_id = p_user_id;
  delete from public.letter_templates where user_id = p_user_id;
  delete from public.sender_addresses where user_id = p_user_id;
  delete from public.epost_accounts where user_id = p_user_id;
  delete from public.billing_accounts where user_id = p_user_id;
  delete from public.ai_draft_log where user_id = p_user_id;
  delete from public.job_queue
    where type = 'auto_topup' and payload->>'userId' = p_user_id::text and status = 'pending';

  update public.status_events
  set details = null
  where item_id in (select id from public.send_job_items where user_id = p_user_id);

  update public.send_job_items
  set recipient_snapshot = jsonb_build_object('anonymized', true),
      rendered_pdf_path = null,
      contact_id = null,
      error_message = null
  where user_id = p_user_id;

  update public.send_jobs
  set sender_snapshot = jsonb_build_object('anonymized', true)
  where user_id = p_user_id;

  update public.profiles
  set email = null,
      display_name = null,
      company = null,
      billing_street = null,
      billing_zip = null,
      billing_city = null,
      billing_country = null,
      status = 'deleted',
      deleted_at = now()
  where id = p_user_id;

  insert into public.audit_log (actor_user_id, action, target_type, target_id, details)
  values (p_actor_user_id, 'account_anonymized', 'user', p_user_id::text,
          jsonb_build_object('open_provider_items', v_open_items));

  return v_open_items;
end;
$$;
