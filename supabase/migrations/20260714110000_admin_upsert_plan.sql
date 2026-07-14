-- Atomic create/update of a condition (plan) with default handling.
-- Guarantees the single-default invariant in BOTH directions: at most one
-- default (uq_plans_single_default) AND — crucially — never zero. A name
-- collision (unique) rolls the whole thing back, so clearing the previous
-- default can never be committed without the new default replacing it.
create or replace function public.admin_upsert_plan(
  p_id uuid,
  p_name text,
  p_discount numeric,
  p_make_default boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.plans (name, discount_percent, is_default)
    values (p_name, p_discount, false)
    returning id into v_id;
  else
    update public.plans
      set name = p_name, discount_percent = p_discount
      where id = p_id;
    if not found then
      raise exception 'plan_not_found' using errcode = 'P0002';
    end if;
    v_id := p_id;
  end if;

  if p_make_default then
    update public.plans set is_default = false where is_default and id <> v_id;
    update public.plans set is_default = true where id = v_id;
  else
    -- Turning off (or leaving off) default: refuse if it would leave zero.
    if exists (select 1 from public.plans where id = v_id and is_default)
       and (select count(*) from public.plans where is_default) <= 1 then
      raise exception 'last_default' using errcode = 'P0001';
    end if;
    update public.plans set is_default = false where id = v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_plan(uuid, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.admin_upsert_plan(uuid, text, numeric, boolean) to service_role;
