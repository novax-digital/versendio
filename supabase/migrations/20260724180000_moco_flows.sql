-- MOCO as a flow source: a flow can enroll recipients from MOCO events (new
-- invoice / new payment reminder / new company) instead of a manually fed
-- list. The flow still binds an auto-created lead list — the MOCO scanner
-- upserts the recipient as a contact and inserts a list entry; the existing
-- AFTER-INSERT enrollment trigger, dedup (one lifetime enrollment per
-- flow+contact) and scheduler stay untouched.

-- New value is only ADDED here (used by app code, never inside this
-- transaction — Postgres forbids same-transaction use of new enum values).
alter type public.flow_source add value if not exists 'moco';

alter table public.flows
  add column if not exists moco_trigger text
    check (moco_trigger in ('invoice', 'reminder', 'customer')),
  add column if not exists moco_invoice_status text not null default 'created'
    check (moco_invoice_status in ('created', 'sent'));

-- Stable MOCO identity for auto-created contacts: the company id dedups
-- across syncs and survives address edits (the generated dedup_key would
-- change with them). Partial unique per user; ordinary contacts untouched.
alter table public.contacts add column if not exists moco_company_id bigint;
create unique index if not exists uq_contacts_moco_company
  on public.contacts (user_id, moco_company_id)
  where moco_company_id is not null;

-- Per-flow processed markers: WITHOUT this the scan window (which never
-- advances past activation) would keep already-handled events in front of
-- the per-tick cap forever, starving everything beyond the first batch —
-- and the reminder trigger would re-fetch linked invoices every tick.
-- Enrollment uniqueness remains the money-correctness backstop; this table
-- is the progress/efficiency layer. Service-role only.
create table public.moco_flow_processed (
  flow_id uuid not null references public.flows (id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice', 'reminder', 'customer')),
  moco_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (flow_id, doc_type, moco_id)
);
alter table public.moco_flow_processed enable row level security; -- no policies: service-role only

-- GDPR helper now also clears the flow markers (flow rows may survive
-- anonymization ordering; markers reference third-party document ids).
create or replace function public.delete_user_moco_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.moco_flow_processed p
  using public.flows f
  where p.flow_id = f.id and f.user_id = p_user_id;
  delete from public.moco_documents where user_id = p_user_id;
  delete from public.moco_accounts where user_id = p_user_id;
end;
$$;
