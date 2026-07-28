-- AVV self-service: remember when the user generated their signed DPA so the
-- settings page can offer a permanent re-download (the PDF itself lives in the
-- private assets bucket under {user_id}/avv/, wiped with the account).
alter table public.profiles
  add column if not exists avv_signed_at timestamptz;
