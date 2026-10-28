-- Send review hold (fraud incident 2026-10-28, apoBank phishing campaign):
-- every paid send job waits a configurable review window (default 8 h) before
-- its items may reach the provider. During the window an admin is notified and
-- can release the job early or stop it; afterwards it goes out automatically.
--
-- 1. send_jobs review columns. The submit worker re-checks hold, stop and the
--    reviewed content before every provider POST (defense in depth against
--    any path that enqueues submit_item early), so the queue run_at below is
--    the scheduling mechanism, not the only guard.
-- 2. confirm_send_job — the single money/queue choke point shared by the web
--    wizard, public API, flows and MOCO — stamps the hold, delays the queue
--    jobs and enqueues the admin review mail. Test sends (admin-only, free)
--    skip both.
-- 3. admin_release_send_job / restart_send_review: atomic early release, and
--    a fresh review when the letter content changed after it was reviewed
--    (customers can edit letters and overwrite their storage objects).
-- 4. cancel_pending_job_items: refund reference unique per call, so a second
--    stop of the same job (admin stop, block, retry clone) cannot roll back.

alter table public.send_jobs
  add column if not exists review_hold_until timestamptz,
  add column if not exists review_released_at timestamptz,
  add column if not exists review_stopped_at timestamptz,
  -- Admin-only (no column grant): warning flags of the review mail, the hash
  -- of the content the admin reviewed, and how often a change restarted it.
  add column if not exists review_flags jsonb,
  add column if not exists review_content_hash text,
  add column if not exists review_restarts integer not null default 0;

-- Owners see when their job leaves review (column privileges, see
-- 20260709120003_ek_column_privacy.sql).
grant select (review_hold_until, review_released_at) on public.send_jobs to authenticated;

create index if not exists idx_send_jobs_review_open
  on public.send_jobs (review_hold_until)
  where review_hold_until is not null and review_released_at is null;

insert into public.app_settings (key, value)
values
  ('send_review_hold_hours', '8'::jsonb),
  ('admin_notification_email', '"admin@novax-digital.de"'::jsonb)
on conflict (key) do nothing;

-- End of a review hold starting now, or NULL when the hold is switched off.
-- Missing or malformed setting ⇒ 8 h (fail closed); only an explicit 0
-- disables it; capped at 72 h.
create or replace function public.send_review_hold_until()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_setting jsonb;
  v_hours numeric := 8;
begin
  select value into v_setting from public.app_settings where key = 'send_review_hold_hours';
  if jsonb_typeof(v_setting) = 'number' then
    if (v_setting::text)::numeric >= 0 then
      v_hours := least((v_setting::text)::numeric, 72);
    end if;
  end if;
  if v_hours <= 0 then
    return null;
  end if;
  return now() + make_interval(secs => v_hours * 3600);
end;
$$;
revoke all on function public.send_review_hold_until() from public;
revoke all on function public.send_review_hold_until() from anon, authenticated;
grant execute on function public.send_review_hold_until() to service_role;

create or replace function public.confirm_send_job(
  p_user_id uuid,
  p_client_token uuid,
  p_letter_id uuid,
  p_sender_snapshot jsonb,
  p_is_color boolean,
  p_is_duplex boolean,
  p_registered public.registered_type,
  p_is_test boolean,
  p_scheduled_release_at timestamptz,
  p_provider public.letter_provider,
  p_total_vk_cents integer,
  p_total_ek_cents integer,
  p_items jsonb -- array of {contact_id, recipient_snapshot, vk_cents, ek_cents, pricing_snapshot, sheet_count}
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_job_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_run_at timestamptz;
  v_role text;
  v_items_vk integer;
  v_hold_until timestamptz;
begin
  -- Idempotency: a double-click/retry returns the already-created job.
  select id into v_existing
  from public.send_jobs
  where user_id = p_user_id and client_token = p_client_token;
  if v_existing is not null then
    return v_existing;
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'no_items';
  end if;

  -- Test sends bypass the debit below — admin-only.
  if p_is_test then
    select role into v_role from public.profiles where id = p_user_id;
    if v_role is distinct from 'admin' then
      raise exception 'test_send_forbidden';
    end if;
  end if;

  -- The job total must equal the item sum; refunds are computed per item.
  select coalesce(sum((item->>'vk_cents')::integer), 0) into v_items_vk
  from jsonb_array_elements(p_items) as item;
  if v_items_vk is distinct from p_total_vk_cents then
    raise exception 'total_mismatch';
  end if;

  if not p_is_test then
    v_hold_until := public.send_review_hold_until();
  end if;

  begin
    insert into public.send_jobs
      (user_id, letter_id, sender_snapshot, is_color, is_duplex, registered,
       is_test, scheduled_release_at, client_token, status, total_items,
       total_vk_cents, total_ek_cents, review_hold_until)
    values
      (p_user_id, p_letter_id, p_sender_snapshot, p_is_color, p_is_duplex,
       p_registered, p_is_test, p_scheduled_release_at, p_client_token, 'queued',
       jsonb_array_length(p_items), p_total_vk_cents, p_total_ek_cents, v_hold_until)
    returning id into v_job_id;
  exception when unique_violation then
    -- Truly concurrent duplicate confirm: the loser gracefully returns the
    -- winner's job instead of surfacing an error.
    select id into v_existing
    from public.send_jobs
    where user_id = p_user_id and client_token = p_client_token;
    return v_existing;
  end;

  -- Test runs are free (MASTERPROMPT §6.4); real jobs debit the full sum.
  if not p_is_test and p_total_vk_cents > 0 then
    perform public.book_credit(
      p_user_id, 'spend', -p_total_vk_cents, 'job_confirm', v_job_id::text,
      null, 'user', null, null);
  end if;

  -- Whichever is later: the customer's scheduled release or the review hold.
  v_run_at := greatest(coalesce(p_scheduled_release_at, now()), coalesce(v_hold_until, now()));

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.send_job_items
      (job_id, user_id, contact_id, recipient_snapshot, sheet_count,
       vk_cents, ek_cents, pricing_snapshot, provider, status)
    values
      (v_job_id, p_user_id,
       nullif(v_item->>'contact_id', '')::uuid,
       v_item->'recipient_snapshot',
       (v_item->>'sheet_count')::integer,
       (v_item->>'vk_cents')::integer,
       (v_item->>'ek_cents')::integer,
       v_item->'pricing_snapshot',
       p_provider, 'pending')
    returning id into v_item_id;

    insert into public.job_queue (type, payload, run_at)
    values ('submit_item', jsonb_build_object('itemId', v_item_id), v_run_at);
  end loop;

  -- Admin review mail, enqueued in the same transaction so every entry point
  -- (wizard, API, flows, MOCO) is covered without app-layer cooperation.
  if not p_is_test then
    insert into public.job_queue (type, payload, run_at)
    values ('send_email',
            jsonb_build_object('template', 'admin_send_review', 'userId', p_user_id, 'jobId', v_job_id),
            now());
  end if;

  return v_job_id;
end;
$$;

-- Early release by an admin: ends the hold and pulls the job's pending submit
-- jobs forward (never before the customer's own scheduled release). Idempotent:
-- a second call finds review_released_at set and returns 0. Returns the
-- number of queue jobs moved.
create or replace function public.admin_release_send_job(p_job_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_moved integer;
begin
  select id, status, scheduled_release_at, review_released_at, review_stopped_at
  into v_job
  from public.send_jobs
  where id = p_job_id
  for update;
  if v_job is null then
    raise exception 'job_not_found';
  end if;
  if v_job.review_released_at is not null then
    return 0;
  end if;
  if v_job.review_stopped_at is not null
     or v_job.status in ('canceled', 'completed', 'completed_with_errors') then
    raise exception 'job_not_releasable';
  end if;

  update public.send_jobs set review_released_at = now() where id = p_job_id;

  update public.job_queue q
  set run_at = greatest(now(), coalesce(v_job.scheduled_release_at, now()))
  where q.type = 'submit_item'
    and q.status = 'pending'
    and q.payload->>'itemId' in (
      select i.id::text from public.send_job_items i where i.job_id = p_job_id
    );
  get diagnostics v_moved = row_count;

  return v_moved;
end;
$$;
revoke all on function public.admin_release_send_job(uuid) from public;
revoke all on function public.admin_release_send_job(uuid) from anon, authenticated;
grant execute on function public.admin_release_send_job(uuid) to service_role;

-- The worker rendered content that differs from what the admin reviewed:
-- start a fresh hold, drop the release, re-park the pending submit jobs and
-- queue a new review mail. Concurrent detections by several items of one job
-- restart only once (the first clears review_content_hash). Returns the new
-- hold end, or NULL when the hold is switched off (job leaves review).
create or replace function public.restart_send_review(p_job_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_until timestamptz;
begin
  select id, user_id, scheduled_release_at, review_hold_until, review_released_at,
         review_content_hash
  into v_job
  from public.send_jobs
  where id = p_job_id
  for update;
  if v_job is null then
    raise exception 'job_not_found';
  end if;

  -- Already restarted and waiting for its review render.
  if v_job.review_content_hash is null and v_job.review_released_at is null
     and v_job.review_hold_until > now() then
    return v_job.review_hold_until;
  end if;

  v_until := public.send_review_hold_until();
  update public.send_jobs
  set review_hold_until = v_until,
      review_released_at = null,
      review_content_hash = null,
      review_flags = null,
      review_restarts = review_restarts + 1
  where id = p_job_id;

  if v_until is not null then
    update public.job_queue q
    set run_at = greatest(v_until, coalesce(v_job.scheduled_release_at, v_until))
    where q.type = 'submit_item'
      and q.status = 'pending'
      and q.payload->>'itemId' in (
        select i.id::text from public.send_job_items i where i.job_id = p_job_id
      );
    insert into public.job_queue (type, payload, run_at)
    values ('send_email',
            jsonb_build_object('template', 'admin_send_review', 'userId', v_job.user_id,
                               'jobId', p_job_id, 'restart', true),
            now());
  end if;

  return v_until;
end;
$$;
revoke all on function public.restart_send_review(uuid) from public;
revoke all on function public.restart_send_review(uuid) from anon, authenticated;
grant execute on function public.restart_send_review(uuid) to service_role;

-- Same as 20260709120002_send_pipeline.sql, except the refund reference is
-- unique per call: the first stop keeps the job id (existing ledger rows),
-- a later one (items that became pending again) gets a suffixed reference
-- instead of tripping uq_credit_tx_reference and rolling everything back.
create or replace function public.cancel_pending_job_items(p_job_id uuid, p_actor text default 'user')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_refund integer := 0;
  v_canceled integer;
  v_reference text;
begin
  select id, user_id, is_test into v_job from public.send_jobs where id = p_job_id for update;
  if v_job is null then
    raise exception 'job_not_found';
  end if;

  -- Cancel pending/held items; their queue jobs become no-ops via status guard.
  with canceled as (
    update public.send_job_items
    set status = 'canceled'
    where job_id = p_job_id and status in ('pending', 'on_hold_funds')
    returning vk_cents
  )
  select coalesce(sum(vk_cents), 0), count(*) into v_refund, v_canceled from canceled;

  if v_canceled = 0 then
    return 0;
  end if;

  if not v_job.is_test and v_refund > 0 then
    v_reference := p_job_id::text;
    if exists (
      select 1 from public.credit_transactions
      where type = 'refund' and reference_type = 'job_cancel_rest' and reference_id = v_reference
    ) then
      v_reference := p_job_id::text || ':' || gen_random_uuid()::text;
    end if;
    perform public.book_credit(
      v_job.user_id, 'refund', v_refund, 'job_cancel_rest', v_reference,
      null, p_actor, null, null);
  end if;

  -- Job status: canceled when nothing was submitted, otherwise keep processing
  -- (the status sync will complete it once submitted items are final).
  update public.send_jobs
  set status = case
    when not exists (select 1 from public.send_job_items where job_id = p_job_id and status not in ('canceled')) then 'canceled'::public.send_job_status
    else status
  end
  where id = p_job_id;

  return v_refund;
end;
$$;
revoke all on function public.cancel_pending_job_items(uuid, text) from public;
revoke all on function public.cancel_pending_job_items(uuid, text) from anon, authenticated;
grant execute on function public.cancel_pending_job_items(uuid, text) to service_role;

-- GDPR: review flags can quote company names (sole traders = personal
-- names). anonymize_account replaces sender_snapshot with {anonymized:true};
-- clear the flags in the same update instead of re-defining that function.
create or replace function public.clear_review_flags_on_anonymize()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.sender_snapshot = '{"anonymized": true}'::jsonb then
    new.review_flags := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_send_jobs_clear_review_flags on public.send_jobs;
create trigger trg_send_jobs_clear_review_flags
  before update of sender_snapshot on public.send_jobs
  for each row execute function public.clear_review_flags_on_anonymize();
