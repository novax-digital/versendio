-- One-shot flag so the welcome email is sent exactly once, at first e-mail
-- confirmation. A conditional update (… where welcome_sent_at is null) makes
-- the enqueue idempotent across repeated callback hits.
alter table public.profiles
  add column welcome_sent_at timestamptz;
