-- MOCO integration (mocoapp.com): connect a customer's MOCO account and send
-- their invoices/payment reminders ("Mahnungen") as physical letters —
-- automatically per user rules or via a manual sync.
--
-- Credentials pattern mirrors epost_accounts: the API key is AES-GCM-encrypted
-- app-side (EPOST_CREDENTIALS_KEY) and the table has NO client RLS policies —
-- service-role only; the settings UI reads via server components/actions after
-- requireProfile.

-- 1) Connection + auto-send rules (1:1 per user, so both live on one row).
create table public.moco_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  subdomain text not null,
  api_key_enc text not null,
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  last_sync_at timestamptz,
  -- Auto-send rules
  auto_send_invoices boolean not null default false,
  invoice_trigger_status text not null default 'created'
    check (invoice_trigger_status in ('created', 'sent')),
  auto_send_reminders boolean not null default false,
  is_duplex boolean not null default true,
  is_color boolean not null default false,
  -- Watermark: only documents dated on/after activation are ever auto-sent —
  -- enabling the integration must not blast the whole invoice archive.
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.moco_accounts enable row level security; -- no policies: service-role only
create trigger trg_moco_accounts_touch before update on public.moco_accounts
  for each row execute function public.touch_updated_at();

-- 2) Document ledger: idempotency anchor + user-visible activity. The row id
--    doubles as confirm_send_job's p_client_token (flow_enrollments pattern),
--    so a crash between the money RPC and the status flip can never
--    double-charge — the next tick resumes the same token.
create table public.moco_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice', 'reminder')),
  moco_id bigint not null,
  identifier text,
  title text,
  doc_date date,
  letter_id uuid references public.letters (id) on delete set null,
  send_job_id uuid references public.send_jobs (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_moco_documents_doc on public.moco_documents (user_id, doc_type, moco_id);
create index idx_moco_documents_user on public.moco_documents (user_id, created_at desc);
create trigger trg_moco_documents_touch before update on public.moco_documents
  for each row execute function public.touch_updated_at();

alter table public.moco_documents enable row level security;
-- Owner reads the activity feed; all writes happen with the service role.
create policy moco_documents_select_own on public.moco_documents
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 3) GDPR: profiles are anonymized, never hard-deleted, so FK cascades never
--    fire (wl_customers precedent). Helper removes the credential row and the
--    document ledger (identifiers/titles reference third-party business data).
create or replace function public.delete_user_moco_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.moco_documents where user_id = p_user_id;
  delete from public.moco_accounts where user_id = p_user_id;
end;
$$;
revoke all on function public.delete_user_moco_data(uuid) from public;
revoke all on function public.delete_user_moco_data(uuid) from anon, authenticated;
grant execute on function public.delete_user_moco_data(uuid) to service_role;
