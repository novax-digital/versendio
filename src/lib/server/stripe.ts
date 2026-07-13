import "server-only";
import Stripe from "stripe";
import { VAT_RATE_PERCENT } from "@/lib/shared/money";
import { serverEnv } from "@/lib/server/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe integration. Everything is gated behind FEATURE_STRIPE; credit is
 * booked exclusively by the webhook, never on redirect (§6.6). B2B pricing:
 * amounts are NET — German VAT is added at the payment boundary via a fixed
 * Stripe tax rate (see getVatTaxRateId).
 */

export function stripeEnabled(): boolean {
  const env = serverEnv();
  return env.FEATURE_STRIPE && !!env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  // Live keys deliberately released on 2026-07-13 (operator decision) — the
  // former hard guard from MASTERPROMPT §9 is retired. Test keys keep working
  // for local/staging environments.
  return new Stripe(env.STRIPE_SECRET_KEY);
}

// Module cache is a serverless-safe optimization only — rebuilt per cold
// start via find-or-create against Stripe (metadata marker).
let cachedVatTaxRateId: string | null = null;

/**
 * Finds or creates the exclusive German VAT tax rate (19 %) used on checkout
 * line items: the customer pays net + VAT and the Stripe invoice itemizes the
 * tax, while ledger credit stays net. Fixed-rate deliberately (B2B, DE) —
 * EU reverse charge would move this to Stripe Tax (see ASSUMPTIONS A-014).
 */
export async function getVatTaxRateId(stripe: Stripe): Promise<string> {
  if (cachedVatTaxRateId) return cachedVatTaxRateId;
  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const match = existing.data.find(
    (r) =>
      r.metadata?.app === "versendio" &&
      !r.inclusive &&
      r.percentage === VAT_RATE_PERCENT,
  );
  if (match) {
    cachedVatTaxRateId = match.id;
    return match.id;
  }
  const created = await stripe.taxRates.create({
    display_name: "USt.",
    description: `Umsatzsteuer ${VAT_RATE_PERCENT} %`,
    percentage: VAT_RATE_PERCENT,
    inclusive: false,
    country: "DE",
    metadata: { app: "versendio", purpose: "vat" },
  });
  cachedVatTaxRateId = created.id;
  return created.id;
}

/** Finds or creates the Stripe customer for a user, persisted in billing_accounts. */
export async function getOrCreateCustomer(userId: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) {
    // Keep the Stripe email current so receipt/invoice mails reach the
    // customer's ACTIVE address (it is only set at creation otherwise).
    // Best-effort: a failure must never block the payment flow.
    if (email) {
      try {
        await getStripe().customers.update(existing.stripe_customer_id, { email });
      } catch (err) {
        console.error("stripe_customer_email_sync_failed", {
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
    return existing.stripe_customer_id;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: email ?? undefined,
    metadata: { user_id: userId },
  });

  const { error } = await admin
    .from("billing_accounts")
    .upsert({ user_id: userId, stripe_customer_id: customer.id }, { onConflict: "user_id" });
  if (error) {
    console.error("billing_account_upsert_failed", { error: error.message });
  }
  return customer.id;
}
