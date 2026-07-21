-- Whitelabel-SaaS: an admin-granted flag lets a customer run Versendio for
-- their own software/end-customers. End-customers ("wl_customers") are pure
-- data objects — no login, no auth identity. Sends are attributed at the JOB
-- level (send_jobs.wl_customer_id, written by the caller right after
-- confirm_send_job returns — same post-RPC pattern the flows scheduler uses
-- for send_job_id; the money RPC stays untouched). Billing values exposed to
-- the customer are VK-only (EK stays an operator secret).

-- 1) Admin-only flag on profiles. Added to protect_profile_columns below so a
--    user cannot self-grant it through profiles_update_own.
alter table public.profiles
  add column if not exists is_whitelabel boolean not null default false;

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
       or new.email is distinct from old.email
       or new.is_whitelabel is distinct from old.is_whitelabel then
      raise exception 'profiles: protected column modification denied';
    end if;
  end if;
  return new;
end;
$$;

-- 2) End-customers of a whitelabel customer.
create table public.wl_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  -- The customer's own identifier for this end-customer (their system's id or
  -- customer number) — unique per owner so API creation can be idempotent.
  external_ref text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_wl_customers_external_ref
  on public.wl_customers (user_id, external_ref)
  where external_ref is not null;
create index idx_wl_customers_user on public.wl_customers (user_id, created_at desc);
create trigger trg_wl_customers_touch before update on public.wl_customers
  for each row execute function public.touch_updated_at();

alter table public.wl_customers enable row level security;
-- Owner-scoped CRUD (contacts pattern): the whitelabel customer manages their
-- end-customers through the authenticated client; admins may read.
create policy wl_customers_all_own on public.wl_customers
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- 3) Job-level attribution. Restrict: an end-customer with sends cannot be
--    hard-deleted (billing history) — deactivate instead; the delete action
--    surfaces a friendly error (plans pattern).
alter table public.send_jobs
  add column if not exists wl_customer_id uuid references public.wl_customers (id) on delete restrict;
create index idx_send_jobs_wl_customer
  on public.send_jobs (wl_customer_id)
  where wl_customer_id is not null;
-- send_jobs uses COLUMN-level select grants (ek_column_privacy revoked the
-- table-wide grant): every later column needs its own grant or RLS-client
-- reads silently fail with 42501 (admin_retry precedent).
grant select (wl_customer_id) on public.send_jobs to authenticated;

-- 4) GDPR: profiles are anonymized, never hard-deleted, so FK cascades never
--    fire (api_keys precedent). Helper detaches attribution, then deletes the
--    end-customer rows (their names/emails are third-party PII we must drop).
create or replace function public.delete_user_wl_customers(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.send_jobs
  set wl_customer_id = null
  where user_id = p_user_id and wl_customer_id is not null;

  delete from public.wl_customers where user_id = p_user_id;
end;
$$;
revoke all on function public.delete_user_wl_customers(uuid) from public;
revoke all on function public.delete_user_wl_customers(uuid) from anon, authenticated;
grant execute on function public.delete_user_wl_customers(uuid) to service_role;
