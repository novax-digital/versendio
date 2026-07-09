-- GDPR account deletion (ADR-0009): personal data is removed, billing data is
-- retained anonymized. The profile row survives as an anonymized anchor so the
-- append-only ledger and the send history keep their foreign keys.
--
-- Storage objects and the auth.users row are removed by the caller
-- (the delete-account server action) — SQL can reach neither.

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

-- Retention/cleanup helper: rate-limit rows keyed by a user id.
create or replace function public.purge_user_rate_limits(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits where key like '%' || p_user_id::text || '%';
$$;
revoke all on function public.purge_user_rate_limits(uuid) from public;
revoke all on function public.purge_user_rate_limits(uuid) from anon, authenticated;
grant execute on function public.purge_user_rate_limits(uuid) to service_role;
