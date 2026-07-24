-- Canva Connect integration: per-user OAuth tokens for importing Canva
-- designs as letters. Credentials pattern mirrors moco_accounts/epost_accounts:
-- tokens AES-GCM-encrypted app-side (EPOST_CREDENTIALS_KEY), table is
-- service-role only (RLS enabled, NO client policies) — the UI reads via
-- server components/actions after requireProfile.
create table public.canva_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text not null,
  -- Canva access tokens live ~4h; refresh tokens are single-use and rotate.
  token_expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.canva_accounts enable row level security; -- no policies: service-role only
create trigger trg_canva_accounts_touch before update on public.canva_accounts
  for each row execute function public.touch_updated_at();

-- GDPR: profiles are anonymized, never hard-deleted → explicit cleanup helper
-- (wl_customers/moco precedent), called from the deletion orchestrator.
create or replace function public.delete_user_canva_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.canva_accounts where user_id = p_user_id;
end;
$$;
revoke all on function public.delete_user_canva_data(uuid) from public;
revoke all on function public.delete_user_canva_data(uuid) from anon, authenticated;
grant execute on function public.delete_user_canva_data(uuid) to service_role;
