-- Drop the "OR is_admin()" widening from all row-scoping RLS policies
-- (send-monitor audit 2026-07-28).
--
-- Why: user-facing pages rely on RLS for row scoping. The is_admin() branch
-- made an admin's RLS-scoped session see EVERY user's rows in the normal app
-- views (/app/sendungen, /app/kontakte, …) — and, on FOR ALL policies, even
-- allowed deleting foreign rows through user-facing actions (DELETE is gated
-- by USING only; the WITH CHECK clauses never contained is_admin()).
--
-- Safe to drop: every admin console surface (src/app/admin/**) queries
-- exclusively through the service-role client, which bypasses RLS. No admin
-- page reads via these policies. All WITH CHECK clauses stay untouched, so
-- user writes are unaffected. Future admin surfaces MUST use createAdminClient.
--
-- ALTER POLICY replaces USING in place and keeps WITH CHECK unchanged.

alter policy profiles_select_own on public.profiles
  using (id = (select auth.uid()));

alter policy sender_addresses_all_own on public.sender_addresses
  using (user_id = (select auth.uid()));

alter policy billing_accounts_select_own on public.billing_accounts
  using (user_id = (select auth.uid()));

alter policy letter_templates_all_own on public.letter_templates
  using (user_id = (select auth.uid()));

alter policy letters_all_own on public.letters
  using (user_id = (select auth.uid()));

alter policy contacts_all_own on public.contacts
  using (user_id = (select auth.uid()));

alter policy lead_lists_all_own on public.lead_lists
  using (user_id = (select auth.uid()));

alter policy lead_list_entries_all_own on public.lead_list_entries
  using (exists (
    select 1 from public.lead_lists l
    where l.id = lead_list_entries.list_id
      and l.user_id = (select auth.uid())
  ));

alter policy send_jobs_select_own on public.send_jobs
  using (user_id = (select auth.uid()));

alter policy send_job_items_select_own on public.send_job_items
  using (user_id = (select auth.uid()));

alter policy status_events_select_own on public.status_events
  using (exists (
    select 1 from public.send_job_items i
    where i.id = status_events.item_id
      and i.user_id = (select auth.uid())
  ));

alter policy credit_tx_select_own on public.credit_transactions
  using (user_id = (select auth.uid()));

alter policy api_keys_all_own on public.api_keys
  using (user_id = (select auth.uid()));

alter policy review_rewards_select on public.review_rewards
  using (user_id = (select auth.uid()));

alter policy flows_all_own on public.flows
  using (user_id = (select auth.uid()));

alter policy flow_enrollments_select_own on public.flow_enrollments
  using (user_id = (select auth.uid()));

alter policy voucher_redemptions_select_own on public.voucher_redemptions
  using (user_id = (select auth.uid()));

alter policy wl_customers_all_own on public.wl_customers
  using (user_id = (select auth.uid()));

-- vouchers become fully server-only: the only reader is the admin console,
-- which uses the service role; user redemption goes through the
-- SECURITY DEFINER redeem_voucher RPC.
drop policy vouchers_select_admin on public.vouchers;

-- is_admin() stays defined: requireAdmin() mirrors it app-side and future
-- deliberate admin RPCs may use it.
