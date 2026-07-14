-- API keys for the Integrations REST API. Only the SHA-256 hash of the key is
-- stored; the plaintext is shown to the user exactly once at creation. The key
-- prefix is kept for display ("vk_live_a1b2…"). Revocation is a soft delete.
-- Keys stop working when the owner is no longer active (blocked/anonymized) —
-- enforced in the REST auth layer, so no function re-declaration is needed.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  key_prefix text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_api_keys_user on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;

-- House pattern: owner-scoped, admins may read. The key_hash is never exposed
-- to the client (the management UI selects only id/name/prefix/timestamps).
create policy api_keys_all_own on public.api_keys
  for all to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()));

-- GDPR: hard-delete a user's keys when their account is anonymized. The
-- anonymize_account function keeps the profile as an anchor (status='deleted'),
-- so add the cleanup here rather than relying on the FK cascade.
create or replace function public.delete_user_api_keys(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.api_keys where user_id = p_user_id;
$$;
revoke all on function public.delete_user_api_keys(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_api_keys(uuid) to service_role;
