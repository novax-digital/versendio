import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/server/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Stripe integration (test mode only until launch — MASTERPROMPT §9 forbids
 * live keys). Everything is gated behind FEATURE_STRIPE; credit is booked
 * exclusively by the webhook, never on redirect (§6.6).
 */

export function stripeEnabled(): boolean {
  const env = serverEnv();
  return env.FEATURE_STRIPE && !!env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  if (env.STRIPE_SECRET_KEY.startsWith("sk_live")) {
    // Hard guard: live payments must never be activated from this codebase
    // without a deliberate release step (MASTERPROMPT §9).
    throw new Error("Live Stripe keys are not allowed in this build");
  }
  return new Stripe(env.STRIPE_SECRET_KEY);
}

/** Finds or creates the Stripe customer for a user, persisted in billing_accounts. */
export async function getOrCreateCustomer(userId: string, email: string | null): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

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
