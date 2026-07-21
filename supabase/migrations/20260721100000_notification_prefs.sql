-- E-mail notification preferences: per-user opt-outs for transactional mail
-- categories. Typed booleans on profiles (house pattern, welcome_sent_at
-- precedent): user-writable through the existing profiles_update_own policy,
-- NOT covered by protect_profile_columns, and no extra RLS/GDPR wiring needed
-- (non-PII booleans; anonymization may leave them untouched).
--
-- Deliberately NOT gated by these flags (account/action-critical mails):
-- welcome, account deletion, auto-top-up FAILURE, items_on_hold (letters
-- parked until the user acts).
alter table public.profiles
  add column if not exists notify_send_status boolean not null default true,
  add column if not exists notify_epost_updates boolean not null default true,
  add column if not exists notify_topup boolean not null default true,
  add column if not exists notify_flow_activity boolean not null default true;
