-- Top-up bonus tiers config (admin-editable). Empty array = feature off.
-- The bonus is unpaid gift credit booked in the Stripe webhook as a separate
-- ledger row (reference_type 'stripe_bonus'); no VAT, no invoice.
insert into public.app_settings (key, value)
values ('topup_bonus_tiers', '[]'::jsonb)
on conflict (key) do nothing;
