-- Harden review_rewards against forged inserts. RLS lets a user insert their own
-- row (with check user_id = auth.uid()), but that policy cannot constrain the
-- amount, the lifecycle columns, or the URL host. A crafted client insert (e.g.
-- direct PostgREST, bypassing the server action) could otherwise set
-- amount_cents = 999999, status = 'approved', or a link on an attacker-owned
-- host; an admin approving by the stored amount/link would then credit real
-- money for a review that was never written. This trigger makes those columns
-- server-authoritative: the client may only pick the platform and submit a URL,
-- and the URL must live on the platform's own https domain.
create or replace function public.enforce_review_reward_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  case new.platform
    when 'trustpilot' then new.amount_cents := 1500;
    when 'linkedin' then new.amount_cents := 3000;
    else raise exception 'unknown review platform: %', new.platform;
  end case;

  -- Lifecycle is set only by the approval RPC / admin action, never on insert.
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;

  -- Host must belong to the platform (exact domain or a subdomain), https only.
  -- Backstops the app-layer isPlausibleReviewUrl check for inserts that skip it.
  if new.platform = 'trustpilot'
     and new.url !~* '^https://([a-z0-9-]+\.)*trustpilot\.com(/|\?|#|$)' then
    raise exception 'url host does not match platform';
  elsif new.platform = 'linkedin'
     and new.url !~* '^https://([a-z0-9-]+\.)*linkedin\.com(/|\?|#|$)' then
    raise exception 'url host does not match platform';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_review_rewards_enforce_insert on public.review_rewards;
create trigger trg_review_rewards_enforce_insert
  before insert on public.review_rewards
  for each row execute function public.enforce_review_reward_insert();
