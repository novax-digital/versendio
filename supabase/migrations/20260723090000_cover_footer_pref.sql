-- Cover-page footer notice: auto-generated address cover pages carry a small
-- "Dieser Brief wurde automatisch mit versendio.de versendet." line at the
-- bottom. Per-user opt-out (notify_* precedent): typed boolean on profiles,
-- default ON for everyone, writable through the existing profiles_update_own
-- policy, NOT covered by protect_profile_columns, non-PII (no GDPR wiring).
alter table public.profiles
  add column if not exists cover_letter_footer boolean not null default true;
