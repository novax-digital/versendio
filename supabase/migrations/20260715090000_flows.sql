-- Flows: automated, time-delayed letter sending. A flow binds a target lead_list
-- + a letter + a delay + send options and can be active/inactive. When a contact
-- enters the target list (via any path — manual add, CSV import, REST API), an
-- AFTER INSERT trigger on lead_list_entries enrolls it with a materialized
-- scheduled_send_at (= entry time + delay) and a SNAPSHOT of the letter/options.
-- A separate cron (/api/cron/flows) later calls the existing confirm_send_job RPC
-- for each due enrollment (idempotent via client_token = enrollment id). Money is
-- charged at fire time by that RPC — nothing is reserved at enrollment.

-- Flow lists are a distinguishable list_source so the UI can badge them.
alter type public.list_source add value if not exists 'flow';

create type public.flow_source as enum ('manual', 'api');
create type public.flow_enrollment_status as enum
  ('pending', 'sent', 'held', 'skipped', 'failed', 'canceled');

-- Flow definition ------------------------------------------------------------
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  name text not null,
  is_active boolean not null default false,
  source public.flow_source not null default 'manual',
  -- restrict: an active automation must not break silently when its list/letter
  -- is deleted — force the user to detach the flow first (friendly error).
  list_id uuid not null references public.lead_lists (id) on delete restrict,
  letter_id uuid not null references public.letters (id) on delete restrict,
  delay_minutes integer not null check (delay_minutes >= 0),
  is_color boolean not null default false,
  is_duplex boolean not null default true,
  registered public.registered_type not null default 'none',
  sender_address_id uuid references public.sender_addresses (id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_flows_user on public.flows (user_id);
-- Trigger hot path: "active flows bound to this list" must be an index lookup.
create index idx_flows_active_list on public.flows (list_id) where is_active;
create trigger trg_flows_touch before update on public.flows
  for each row execute function public.touch_updated_at();

-- Enrollment (one contact scheduled by one flow) -----------------------------
create table public.flow_enrollments (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  -- denormalized for RLS/scan without a join back through flows
  user_id uuid not null references public.profiles (id) on delete restrict,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status public.flow_enrollment_status not null default 'pending',
  enrolled_at timestamptz not null default now(),
  scheduled_send_at timestamptz not null,
  -- Config snapshot frozen at enrollment so later flow edits never rewrite an
  -- in-flight send. (The letter CONTENT is still read live at submit time.)
  letter_id uuid not null references public.letters (id) on delete restrict,
  is_color boolean not null,
  is_duplex boolean not null,
  registered public.registered_type not null,
  send_job_id uuid references public.send_jobs (id) on delete set null,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One lifetime enrollment per (flow, contact); re-adding to the list is a no-op.
create unique index uq_flow_enrollment_contact on public.flow_enrollments (flow_id, contact_id);
-- Scanner hot paths: due pending rows and held (retry) rows, oldest first.
create index idx_flow_enrollments_due on public.flow_enrollments (scheduled_send_at)
  where status = 'pending';
create index idx_flow_enrollments_held on public.flow_enrollments (scheduled_send_at)
  where status = 'held';
-- Belt-and-braces: at most one enrollment ever maps to a given send_job.
create unique index uq_flow_enrollment_job on public.flow_enrollments (send_job_id)
  where send_job_id is not null;
create trigger trg_flow_enrollments_touch before update on public.flow_enrollments
  for each row execute function public.touch_updated_at();

-- RLS ------------------------------------------------------------------------
alter table public.flows enable row level security;
alter table public.flow_enrollments enable row level security;

-- Flows: full own-scope (users manage their own via the authenticated client).
create policy flows_all_own on public.flows
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- Enrollments: read-only for users; every write goes through the SECURITY
-- DEFINER trigger or the service-role cron (analogous to send_jobs/items). This
-- prevents a client from forging scheduled_send_at / letter_id / status.
create policy flow_enrollments_select_own on public.flow_enrollments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Enrollment trigger ---------------------------------------------------------
-- Fires for EVERY insert into lead_list_entries (manual add, CSV import, API),
-- so enrollment can never miss a write path. Enrolls the new contact into every
-- ACTIVE flow bound to that list, anchoring the delay on the entry time.
create or replace function public.enroll_contact_in_flows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flow_enrollments
    (flow_id, user_id, contact_id, scheduled_send_at,
     letter_id, is_color, is_duplex, registered)
  select f.id, f.user_id, new.contact_id,
         new.created_at + make_interval(mins => f.delay_minutes),
         f.letter_id, f.is_color, f.is_duplex, f.registered
  from public.flows f
  where f.list_id = new.list_id and f.is_active
  -- Idempotent: re-adding a contact already enrolled changes nothing. Keeps the
  -- import transaction safe even if the same contact appears twice.
  on conflict (flow_id, contact_id) do nothing;
  return new;
end;
$$;

create trigger trg_enroll_on_list_entry
  after insert on public.lead_list_entries
  for each row execute function public.enroll_contact_in_flows();
