-- SSO (Google / Microsoft via Supabase OAuth): the profile-bootstrap trigger
-- only read raw_user_meta_data->>'display_name', which is set by our e-mail
-- registration form. OAuth providers deliver the user's name as 'full_name'
-- (Google, Azure) or 'name' instead — coalesce so SSO signups get a display
-- name too. Everything else (company, default plan, idempotent insert) is
-- unchanged from the original definition in 20260709120000_initial_schema.sql.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, company, plan_id)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    nullif(new.raw_user_meta_data ->> 'company', ''),
    (select id from public.plans where is_default limit 1)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
