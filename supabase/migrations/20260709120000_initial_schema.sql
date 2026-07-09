-- E-Post-Mailer — initial schema
-- Design: docs/adr/0002 (data model & RLS), 0003 (credit ledger),
-- 0004 (job queue), 0009 (GDPR lifecycle). All money in integer cents.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('user', 'admin');
create type public.user_status as enum ('active', 'blocked', 'deleted');
create type public.letter_source as enum ('upload', 'editor');
create type public.letter_status as enum ('draft', 'ready');
create type public.zone_result as enum ('ok', 'warning', 'fail');
create type public.list_source as enum ('manual', 'import');
create type public.registered_type as enum ('none', 'einwurf', 'einschreiben', 'rueckschein');
create type public.send_job_status as enum
  ('draft', 'queued', 'processing', 'completed', 'completed_with_errors', 'canceled');
create type public.send_item_status as enum
  ('pending', 'on_hold_funds', 'submitting', 'submitted', 'accepted', 'checked',
   'print_center', 'sent', 'failed', 'canceled');
create type public.letter_provider as enum ('mock', 'epost');
create type public.status_event_type as enum ('status_change', 'bze_tracking', 'system_note');
create type public.status_event_source as enum ('provider', 'system');
create type public.tx_type as enum ('topup', 'spend', 'refund', 'admin_adjust');
create type public.pricing_kind as enum ('tier', 'extra_sheet', 'surcharge');
create type public.pricing_zone as enum ('national', 'international');
create type public.queue_job_type as enum
  ('submit_item', 'sync_status', 'send_email', 'cleanup_storage', 'auto_topup', 'release_queued');
create type public.queue_job_status as enum ('pending', 'running', 'done', 'failed', 'dead');
create type public.webhook_status as enum ('received', 'processed', 'failed', 'skipped');
create type public.epost_account_status as enum ('pending_activation', 'active', 'error');

-- ---------------------------------------------------------------------------
-- Helper: updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Returns true when the request runs without a PostgREST JWT (direct DB
-- connection: migrations, seeds) or with the service_role key.
create or replace function public.is_service_request()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(current_setting('request.jwt.claims', true), '') = ''
      or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
$$;

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_plans_single_default on public.plans (is_default) where is_default;
create trigger trg_plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profiles — id mirrors auth.users.id but has NO FK: the row survives account
-- deletion anonymized as the anchor for retained billing data (ADR-0009).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text,
  company text,
  billing_street text,
  billing_zip text,
  billing_city text,
  billing_country char(2) default 'DE',
  role public.user_role not null default 'user',
  status public.user_status not null default 'active',
  deleted_at timestamptz,
  plan_id uuid references public.plans (id) on delete restrict,
  credit_balance_cents integer not null default 0 check (credit_balance_cents >= 0),
  -- costCenter for DP invoice grouping: API allows max 8 chars, [0-9a-zA-Z]
  -- only (verified against Swagger v2.6.1) — 8 hex chars of the user id.
  cost_center text generated always as (left(replace(id::text, '-', ''), 8)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_profiles_cost_center on public.profiles (cost_center);
-- Unique so an anonymized/duplicate row can never shadow a real account in
-- email-keyed lookups. NULLs stay allowed (anonymized profiles, ADR-0009).
create unique index uq_profiles_email on public.profiles (email) where email is not null;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Admin check used by RLS policies. SECURITY DEFINER so it can read profiles
-- regardless of the caller's own row visibility.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon, service_role;

-- Protected columns: only service requests may change role/status/plan/
-- balance/deletion marker/email. Keeps the user-facing UPDATE policy simple.
-- `email` is protected because it identifies the account in operator tooling
-- (admin seeding, support lookups) — a self-writable email would let a user
-- impersonate the configured ADMIN_EMAIL.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_service_request() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.deleted_at is distinct from old.deleted_at
       or new.plan_id is distinct from old.plan_id
       or new.credit_balance_cents is distinct from old.credit_balance_cents
       or new.email is distinct from old.email then
      raise exception 'profiles: protected column modification denied';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_columns();

-- Profiles are anonymized, never hard-deleted (ADR-0009).
create or replace function public.forbid_profile_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.is_service_request() then
    raise exception 'profiles: rows are anonymized, not deleted';
  end if;
  return old;
end;
$$;
create trigger trg_profiles_no_delete before delete on public.profiles
  for each row execute function public.forbid_profile_delete();

-- Auto-create a profile (with the default plan) on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, company, plan_id)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'company', ''),
    (select id from public.plans where is_default limit 1)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- sender_addresses
-- ---------------------------------------------------------------------------
create table public.sender_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  label text not null,
  company text,
  first_name text,
  last_name text,
  street text not null,
  zip text not null,
  city text not null,
  country char(2) not null default 'DE',
  sender_line text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_sender_addresses_default on public.sender_addresses (user_id) where is_default;
create index idx_sender_addresses_user on public.sender_addresses (user_id);
create trigger trg_sender_addresses_touch before update on public.sender_addresses
  for each row execute function public.touch_updated_at();

-- "Exactly one default per user" cannot be expressed as a deferrable partial
-- unique index, so promoting a default requires clearing the old one first.
-- These functions make that pair atomic: a failing write rolls back the clear
-- and never leaves the account without a default sender address.
-- SECURITY INVOKER — RLS applies, and the ownership guard makes the intent
-- explicit rather than relying on an UPDATE silently matching zero rows.
create or replace function public.set_default_sender_address(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sender_addresses
    where id = p_id and user_id = (select auth.uid())
  ) then
    raise exception 'sender_address_not_found';
  end if;

  update public.sender_addresses
  set is_default = false
  where user_id = (select auth.uid()) and is_default and id <> p_id;

  update public.sender_addresses set is_default = true where id = p_id;
end;
$$;
grant execute on function public.set_default_sender_address(uuid) to authenticated;

create or replace function public.upsert_sender_address(
  p_id uuid,
  p_label text,
  p_company text,
  p_first_name text,
  p_last_name text,
  p_street text,
  p_zip text,
  p_city text,
  p_country char(2),
  p_sender_line text,
  p_is_default boolean
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_id is not null and not exists (
    select 1 from public.sender_addresses where id = p_id and user_id = v_user
  ) then
    raise exception 'sender_address_not_found';
  end if;

  if p_is_default then
    update public.sender_addresses
    set is_default = false
    where user_id = v_user and is_default and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.sender_addresses
      (user_id, label, company, first_name, last_name, street, zip, city,
       country, sender_line, is_default)
    values
      (v_user, p_label, p_company, p_first_name, p_last_name, p_street, p_zip,
       p_city, p_country, p_sender_line, p_is_default)
    returning id into v_id;
  else
    update public.sender_addresses
    set label = p_label, company = p_company, first_name = p_first_name,
        last_name = p_last_name, street = p_street, zip = p_zip, city = p_city,
        country = p_country, sender_line = p_sender_line, is_default = p_is_default
    where id = p_id
    returning id into v_id;
  end if;

  return v_id;
end;
$$;
grant execute on function public.upsert_sender_address(
  uuid, text, text, text, text, text, text, text, char, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- billing_accounts
-- ---------------------------------------------------------------------------
create table public.billing_accounts (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  stripe_customer_id text unique,
  auto_topup_enabled boolean not null default false,
  auto_topup_threshold_cents integer,
  auto_topup_amount_cents integer,
  default_payment_method_id text,
  auto_topup_pending_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_billing_accounts_touch before update on public.billing_accounts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- letters & templates
-- ---------------------------------------------------------------------------
create table public.letter_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  editor_document jsonb not null,
  logo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_letter_templates_user on public.letter_templates (user_id);
create trigger trg_letter_templates_touch before update on public.letter_templates
  for each row execute function public.touch_updated_at();

create table public.letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  template_id uuid references public.letter_templates (id) on delete set null,
  title text not null,
  source public.letter_source not null,
  storage_path text,
  page_count integer,
  sheet_count integer,
  file_size_bytes integer,
  validation jsonb,
  address_zone_result public.zone_result,
  needs_cover_letter boolean not null default false, -- system recommendation
  use_cover_letter boolean not null default false, -- user choice (prepend at send)
  editor_document jsonb,
  has_placeholders boolean not null default false,
  status public.letter_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_letters_user_created on public.letters (user_id, created_at desc);
create trigger trg_letters_touch before update on public.letters
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- contacts & lead lists
-- ---------------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  salutation text,
  first_name text,
  last_name text,
  company text,
  street text not null,
  address_extra text,
  zip text not null,
  city text not null,
  country char(2) not null default 'DE',
  email text,
  custom jsonb not null default '{}'::jsonb,
  dedup_key text generated always as (
    lower(coalesce(first_name, '') || '|' || coalesce(last_name, '') || '|' ||
          coalesce(company, '') || '|' || coalesce(street, '') || '|' ||
          coalesce(zip, '') || '|' || coalesce(city, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company is not null or last_name is not null)
);
create index idx_contacts_user_dedup on public.contacts (user_id, dedup_key);
create index idx_contacts_user_names_trgm on public.contacts
  using gin ((coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
              coalesce(company, '')) gin_trgm_ops);
create trigger trg_contacts_touch before update on public.contacts
  for each row execute function public.touch_updated_at();

create table public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  description text,
  source public.list_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_lead_lists_user on public.lead_lists (user_id);
create trigger trg_lead_lists_touch before update on public.lead_lists
  for each row execute function public.touch_updated_at();

create table public.lead_list_entries (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (list_id, contact_id)
);
create index idx_lead_list_entries_list on public.lead_list_entries (list_id);

-- ---------------------------------------------------------------------------
-- pricing_table — EK is a trade secret: RLS enabled, NO client policies.
-- ---------------------------------------------------------------------------
create table public.pricing_table (
  id uuid primary key default gen_random_uuid(),
  option_key text not null unique,
  display_name_de text not null,
  kind public.pricing_kind not null,
  zone public.pricing_zone not null default 'national',
  ek_cents integer check (ek_cents is null or ek_cents >= 0),
  vk_cents integer not null check (vk_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pricing_table_touch before update on public.pricing_table
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- send_jobs & items & events
-- ---------------------------------------------------------------------------
create table public.send_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  letter_id uuid references public.letters (id) on delete set null,
  sender_snapshot jsonb not null,
  is_color boolean not null default false,
  is_duplex boolean not null default true,
  registered public.registered_type not null default 'none',
  is_test boolean not null default false,
  scheduled_release_at timestamptz,
  client_token uuid not null,
  status public.send_job_status not null default 'queued',
  total_items integer not null default 0,
  total_vk_cents integer not null default 0,
  total_ek_cents integer not null default 0,
  batch_id uuid not null default gen_random_uuid(),
  -- Provider batch id: the E-Post API expects an int32 batchID for grouped
  -- status queries (Swagger v2.6.1). Random 31-bit value per job.
  provider_batch_id integer not null default (floor(random() * 2147483646) + 1)::integer,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_token)
);
create index idx_send_jobs_user_created on public.send_jobs (user_id, created_at desc);
create index idx_send_jobs_status on public.send_jobs (status);
create trigger trg_send_jobs_touch before update on public.send_jobs
  for each row execute function public.touch_updated_at();

create table public.send_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.send_jobs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete restrict,
  contact_id uuid references public.contacts (id) on delete set null,
  recipient_snapshot jsonb not null,
  rendered_pdf_path text,
  sheet_count integer,
  vk_cents integer not null,
  ek_cents integer not null,
  pricing_snapshot jsonb not null,
  provider public.letter_provider not null,
  provider_letter_id text,
  status public.send_item_status not null default 'pending',
  provider_status_id smallint,
  error_code text,
  error_message text,
  attempts integer not null default 0,
  first_submit_attempt_at timestamptz,
  frankier_id text,
  refunded_at timestamptz,
  submitted_at timestamptz,
  last_status_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_send_job_items_job on public.send_job_items (job_id);
create index idx_send_job_items_user_created on public.send_job_items (user_id, created_at desc);
create index idx_send_job_items_sync on public.send_job_items (status, last_status_sync_at);
create index idx_send_job_items_provider_letter on public.send_job_items (provider_letter_id);
create trigger trg_send_job_items_touch before update on public.send_job_items
  for each row execute function public.touch_updated_at();

create table public.status_events (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.send_job_items (id) on delete cascade,
  event_type public.status_event_type not null default 'status_change',
  status public.send_item_status,
  provider_status_id smallint,
  details text,
  source public.status_event_source not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_status_events_item on public.status_events (item_id, occurred_at);

-- ---------------------------------------------------------------------------
-- credit_transactions — append-only ledger (ADR-0003)
-- ---------------------------------------------------------------------------
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  type public.tx_type not null,
  amount_cents integer not null,
  balance_after_cents integer not null,
  reference_type text,
  reference_id text,
  receipt_url text,
  stripe_invoice_id text,
  comment text,
  created_by text not null default 'system',
  created_at timestamptz not null default now()
);
create index idx_credit_tx_user_created on public.credit_transactions (user_id, created_at desc);
-- Idempotency: each business event books at most once. reference_type values
-- form a fixed, disjoint vocabulary (job_confirm, item_render_adjust,
-- item_failed, item_canceled, job_cancel_rest, stripe_event) so two distinct
-- bookings for the same object never collide (ADR-0003 §3).
create unique index uq_credit_tx_reference
  on public.credit_transactions (type, reference_type, reference_id)
  where type in ('topup', 'spend', 'refund');

create or replace function public.forbid_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'credit_transactions: ledger is append-only';
end;
$$;
create trigger trg_credit_tx_no_update before update on public.credit_transactions
  for each row execute function public.forbid_ledger_mutation();
create trigger trg_credit_tx_no_delete before delete on public.credit_transactions
  for each row execute function public.forbid_ledger_mutation();

-- The single money entry point (ADR-0003). Serializes per user via row lock,
-- rejects negative balances, writes ledger + denormalized balance atomically.
create or replace function public.book_credit(
  p_user_id uuid,
  p_type public.tx_type,
  p_amount_cents integer,
  p_reference_type text,
  p_reference_id text,
  p_comment text default null,
  p_created_by text default 'system',
  p_receipt_url text default null,
  p_stripe_invoice_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_tx_id uuid;
begin
  if p_amount_cents = 0 then
    raise exception 'zero_amount';
  end if;

  select credit_balance_cents into v_balance
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'user_not_found';
  end if;

  if v_balance + p_amount_cents < 0 then
    raise exception 'insufficient_funds';
  end if;

  v_balance := v_balance + p_amount_cents;

  insert into public.credit_transactions
    (user_id, type, amount_cents, balance_after_cents, reference_type,
     reference_id, comment, created_by, receipt_url, stripe_invoice_id)
  values
    (p_user_id, p_type, p_amount_cents, v_balance, p_reference_type,
     p_reference_id, p_comment, p_created_by, p_receipt_url, p_stripe_invoice_id)
  returning id into v_tx_id;

  update public.profiles
  set credit_balance_cents = v_balance
  where id = p_user_id;

  return v_tx_id;
end;
$$;
-- Money moves only server-side: no client roles may execute this.
revoke all on function public.book_credit(uuid, public.tx_type, integer, text, text, text, text, text, text) from public;
revoke all on function public.book_credit(uuid, public.tx_type, integer, text, text, text, text, text, text) from anon, authenticated;
grant execute on function public.book_credit(uuid, public.tx_type, integer, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- job_queue (ADR-0004) — service-role only
-- ---------------------------------------------------------------------------
create table public.job_queue (
  id uuid primary key default gen_random_uuid(),
  type public.queue_job_type not null,
  payload jsonb not null default '{}'::jsonb,
  status public.queue_job_status not null default 'pending',
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_job_queue_claim on public.job_queue (run_at) where status = 'pending';
create index idx_job_queue_status on public.job_queue (status);
create trigger trg_job_queue_touch before update on public.job_queue
  for each row execute function public.touch_updated_at();

create or replace function public.claim_jobs(
  p_types public.queue_job_type[],
  p_limit integer,
  p_worker_id text
)
returns setof public.job_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.job_queue jq
  set status = 'running', locked_at = now(), locked_by = p_worker_id,
      attempts = jq.attempts + 1
  where jq.id in (
    select id from public.job_queue
    where status = 'pending' and run_at <= now() and type = any (p_types)
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning jq.*;
end;
$$;
revoke all on function public.claim_jobs(public.queue_job_type[], integer, text) from public;
revoke all on function public.claim_jobs(public.queue_job_type[], integer, text) from anon, authenticated;
grant execute on function public.claim_jobs(public.queue_job_type[], integer, text) to service_role;

-- Stuck-job recovery: running jobs whose lock expired go back to pending
-- (or dead once attempts are exhausted).
create or replace function public.reset_stuck_jobs(p_timeout_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.job_queue
  set status = case when attempts >= max_attempts then 'dead'::public.queue_job_status
                    else 'pending'::public.queue_job_status end,
      locked_at = null, locked_by = null,
      last_error = coalesce(last_error, '') || ' [lock expired]'
  where status = 'running' and locked_at < now() - make_interval(mins => p_timeout_minutes);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.reset_stuck_jobs(integer) from public;
revoke all on function public.reset_stuck_jobs(integer) from anon, authenticated;
grant execute on function public.reset_stuck_jobs(integer) to service_role;

-- ---------------------------------------------------------------------------
-- webhook_events, audit_log, app_settings, rate_limits — service-role only
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null unique,
  type text not null,
  payload jsonb,
  status public.webhook_status not null default 'received',
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_log_created on public.audit_log (created_at desc);
create trigger trg_audit_log_no_update before update on public.audit_log
  for each row execute function public.forbid_ledger_mutation();
create trigger trg_audit_log_no_delete before delete on public.audit_log
  for each row execute function public.forbid_ledger_mutation();

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- Fixed-window rate limiting (ADR-0002). Returns true while under the limit.
create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public;
revoke all on function public.check_rate_limit(text, integer, integer) from anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- epost_accounts / epost_tokens — encrypted at rest (AES-256-GCM in app code),
-- service-role only. Reserved for the partner model (ADR-0008); tokens cache
-- the central account's 24h JWT across serverless instances (ADR-0005).
-- ---------------------------------------------------------------------------
create table public.epost_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete restrict,
  ekp text not null,
  mobile_masked text,
  password_enc text,
  secret_enc text,
  status public.epost_account_status not null default 'pending_activation',
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_epost_accounts_touch before update on public.epost_accounts
  for each row execute function public.touch_updated_at();

create table public.epost_tokens (
  id uuid primary key default gen_random_uuid(),
  account_ref text not null unique,
  token_enc text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_epost_tokens_touch before update on public.epost_tokens
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — enabled on EVERY table. Tables without policies are
-- reachable only with the service-role key (ADR-0002 §4).
-- Policies wrap auth.uid() in scalar subselects for per-query evaluation.
-- ---------------------------------------------------------------------------
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.sender_addresses enable row level security;
alter table public.billing_accounts enable row level security;
alter table public.letter_templates enable row level security;
alter table public.letters enable row level security;
alter table public.contacts enable row level security;
alter table public.lead_lists enable row level security;
alter table public.lead_list_entries enable row level security;
alter table public.pricing_table enable row level security;
alter table public.send_jobs enable row level security;
alter table public.send_job_items enable row level security;
alter table public.status_events enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.job_queue enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_log enable row level security;
alter table public.app_settings enable row level security;
alter table public.rate_limits enable row level security;
alter table public.epost_accounts enable row level security;
alter table public.epost_tokens enable row level security;

-- plans: users may read (name/discount shown in profile); writes admin-only via server.
create policy plans_select on public.plans
  for select to authenticated using (true);

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- sender_addresses
create policy sender_addresses_all_own on public.sender_addresses
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- billing_accounts: read own; writes server-side only.
create policy billing_accounts_select_own on public.billing_accounts
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- letter_templates
create policy letter_templates_all_own on public.letter_templates
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- letters
create policy letters_all_own on public.letters
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- contacts
create policy contacts_all_own on public.contacts
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- lead_lists
create policy lead_lists_all_own on public.lead_lists
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- lead_list_entries: via list ownership
create policy lead_list_entries_all_own on public.lead_list_entries
  for all to authenticated
  using (exists (
    select 1 from public.lead_lists l
    where l.id = list_id and (l.user_id = (select auth.uid()) or public.is_admin())
  ))
  with check (
    exists (
      select 1 from public.lead_lists l
      where l.id = list_id and l.user_id = (select auth.uid())
    )
    -- The contact must belong to the caller too: owning the list alone would
    -- let a user attach a foreign contact id to their own list.
    and exists (
      select 1 from public.contacts c
      where c.id = contact_id and c.user_id = (select auth.uid())
    )
  );

-- send_jobs / items / events / ledger: read own; ALL writes server-side.
create policy send_jobs_select_own on public.send_jobs
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy send_job_items_select_own on public.send_job_items
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy status_events_select_own on public.status_events
  for select to authenticated
  using (exists (
    select 1 from public.send_job_items i
    where i.id = item_id and (i.user_id = (select auth.uid()) or public.is_admin())
  ));
create policy credit_tx_select_own on public.credit_transactions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- pricing_table, job_queue, webhook_events, audit_log, app_settings,
-- rate_limits, epost_accounts, epost_tokens: NO client policies on purpose.
