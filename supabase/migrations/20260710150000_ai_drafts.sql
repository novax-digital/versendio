-- KI-Entwurf (AI letter drafts): telemetry log, settings, GDPR lifecycle.
--
-- Abuse model (see docs/ASSUMPTIONS.md A-009):
--   * Enforcement is atomic via the existing check_rate_limit RPC
--     (keys ai:<user> per minute and ai_daily:<user> per day) — NOT via
--     counting rows here. purge_user_rate_limits already cleans those keys.
--   * ai_draft_log is service-role telemetry only: RLS enabled, NO client
--     policies (same pattern as rate_limits). Stores only lengths/token
--     counts — never prompt or output content.

create table public.ai_draft_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  model text not null,
  input_chars integer not null,
  output_chars integer not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

alter table public.ai_draft_log enable row level security;
-- Intentionally no policies: only the service role reads/writes.

create index ai_draft_log_user_created_idx
  on public.ai_draft_log (user_id, created_at desc);

-- Admin-tunable settings (0 as daily limit doubles as a soft kill switch).
insert into public.app_settings (key, value)
values
  ('ai_drafts_enabled', 'true'::jsonb),
  ('ai_daily_draft_limit', '10'::jsonb)
on conflict (key) do nothing;

-- GDPR: drafts telemetry is per-user data — remove it on anonymization.
-- (Full function body re-declared; adds the ai_draft_log delete.)
create or replace function public.anonymize_account(
  p_user_id uuid,
  p_actor_user_id uuid -- null when the user deletes their own account
)
returns integer -- number of letters still with the carrier (cannot be recalled)
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

  -- Third-party recipient addresses inside send snapshots are personal data too.
  -- Carrier error messages and status details can echo address fragments
  -- (e.g. "Empfänger unter der Anschrift nicht zu ermitteln") — scrub them too.
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

  -- Retained anonymized: profiles (anchor), credit_transactions, send_jobs,
  -- send_job_items (counts + prices), status_events, audit_log.
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

revoke all on function public.anonymize_account(uuid, uuid) from public;
revoke all on function public.anonymize_account(uuid, uuid) from anon, authenticated;
grant execute on function public.anonymize_account(uuid, uuid) to service_role;
