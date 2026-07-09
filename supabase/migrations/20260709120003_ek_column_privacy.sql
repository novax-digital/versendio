-- EK (purchase price) and margin are trade secrets (ADR-0002 §4). The own-row
-- RLS SELECT policies on send_jobs/send_job_items would otherwise expose the
-- ek columns and the pricing snapshot (which embeds the full EK price list for
-- render-time repricing) to any authenticated user via direct PostgREST calls.
-- Column-level privileges close that: revoke table-wide SELECT and re-grant an
-- explicit column list without the EK-bearing columns. service_role retains
-- full access; RLS still gates rows.

revoke select on public.send_jobs from anon, authenticated;
grant select (
  id, user_id, letter_id, sender_snapshot, is_color, is_duplex, registered,
  is_test, scheduled_release_at, client_token, status, total_items,
  total_vk_cents, batch_id, provider_batch_id, completed_at, created_at, updated_at
) on public.send_jobs to authenticated;

revoke select on public.send_job_items from anon, authenticated;
grant select (
  id, job_id, user_id, contact_id, recipient_snapshot, rendered_pdf_path,
  sheet_count, vk_cents, provider, provider_letter_id, status,
  provider_status_id, error_code, error_message, attempts,
  first_submit_attempt_at, frankier_id, refunded_at, submitted_at,
  last_status_sync_at, created_at, updated_at
) on public.send_job_items to authenticated;
