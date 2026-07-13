-- Letterheads ("Briefpapier"): reusable theme/logo/header/footer presets.
-- Stored in letter_templates and discriminated by kind so RLS, the touch
-- trigger and the GDPR hard-delete in anonymize_account apply unchanged.
alter table public.letter_templates
  add column kind text not null default 'template'
  check (kind in ('template', 'letterhead'));
