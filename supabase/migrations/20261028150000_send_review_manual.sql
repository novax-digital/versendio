-- Send review, step 2 (owner decision 2026-10-28, IDEAS I-035): jobs whose
-- review raised at least one HIGH warning do not go out automatically when
-- the hold ends — they wait for an explicit admin release (or stop).
-- Set by the review mail job (send/admin-review.ts) from the computed flags;
-- the submit worker keeps re-parking such jobs until review_released_at is
-- set. A finite re-park interval is used on purpose: an 'infinity' timestamp
-- would parse as NaN in the worker and slip through its date comparison.
-- Switch: app setting send_review_manual_on_high (default true).

alter table public.send_jobs
  add column if not exists review_manual_required boolean not null default false;

-- Owners see that their job waits for a manual check (no time promise).
grant select (review_manual_required) on public.send_jobs to authenticated;

insert into public.app_settings (key, value)
values ('send_review_manual_on_high', 'true'::jsonb)
on conflict (key) do nothing;
