"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { getOrCreateCustomer, getStripe, stripeEnabled } from "@/lib/server/stripe";
import { getJsonSetting, getNumberSetting } from "@/lib/server/settings";
import { serverEnv } from "@/lib/server/env";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

async function appBaseUrl(): Promise<string> {
  const env = serverEnv();
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be set in production");
  }
  return "http://localhost:3000";
}

/** Billing address must be complete before the first top-up (§6.6, tax). */
function billingAddressComplete(profile: {
  billing_street: string | null;
  billing_zip: string | null;
  billing_city: string | null;
}): boolean {
  return !!(profile.billing_street && profile.billing_zip && profile.billing_city);
}

const topupSchema = z.object({ amountCents: z.coerce.number().int().positive() });

export async function startTopupAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };

  const parsed = topupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const [minCents, maxCents, allowedAmounts] = await Promise.all([
    getNumberSetting("topup_min_cents", 1000),
    getNumberSetting("topup_max_cents", 100000),
    getJsonSetting<number[]>("topup_amounts_cents", [1000, 2500, 5000, 10000]),
  ]);
  const amount = parsed.data.amountCents;
  // Preset amounts or any custom amount within [min, max].
  if (amount < minCents && !allowedAmounts.includes(amount)) {
    return { ok: false, error: de.credits.belowMinimum(minCents) };
  }
  if (amount > maxCents) {
    return { ok: false, error: de.credits.aboveMaximum(maxCents) };
  }

  if (!billingAddressComplete(profile)) {
    return { ok: false, error: de.credits.billingAddressRequired };
  }

  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(profile.id, profile.email);
  const base = await appBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    // SEPA aktiv anbieten (flat fee), Karte als Standard (§6.6).
    payment_method_types: ["card", "sepa_debit"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: amount,
          product_data: {
            name: `Guthaben-Aufladung ${serverEnv().APP_NAME}`,
          },
        },
      },
    ],
    metadata: { user_id: profile.id, amount_cents: String(amount), purpose: "topup" },
    payment_intent_data: {
      metadata: { user_id: profile.id, amount_cents: String(amount), purpose: "topup" },
    },
    invoice_creation: { enabled: true },
    success_url: `${base}/app/guthaben?status=erfolgreich`,
    cancel_url: `${base}/app/guthaben?status=abgebrochen`,
  });

  if (!session.url) return { ok: false, error: de.common.genericError };
  redirect(session.url);
}

export async function startSetupAction(): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };

  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(profile.id, profile.email);
  const base = await appBaseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card", "sepa_debit"],
    metadata: { user_id: profile.id, purpose: "auto_topup_setup" },
    success_url: `${base}/app/guthaben?setup=erfolgreich`,
    cancel_url: `${base}/app/guthaben?setup=abgebrochen`,
  });

  if (!session.url) return { ok: false, error: de.common.genericError };
  redirect(session.url);
}

const autoTopupSchema = z.object({
  enabled: z.enum(["true", "false"]),
  thresholdCents: z.coerce.number().int().min(0).max(1_000_000),
  amountCents: z.coerce.number().int().min(0).max(1_000_000),
});

export async function updateAutoTopupAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };

  const parsed = autoTopupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const enabled = parsed.data.enabled === "true";
  const minCents = await getNumberSetting("topup_min_cents", 1000);
  if (enabled && parsed.data.amountCents < minCents) {
    return { ok: false, error: de.credits.belowMinimum(minCents) };
  }

  const admin = createAdminClient();

  if (enabled) {
    // A saved payment method is required for off-session charges.
    const { data: account } = await admin
      .from("billing_accounts")
      .select("stripe_customer_id, default_payment_method_id")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!account?.default_payment_method_id) {
      return { ok: false, error: de.credits.noPaymentMethod };
    }
  }

  const { error } = await admin.from("billing_accounts").upsert(
    {
      user_id: profile.id,
      auto_topup_enabled: enabled,
      auto_topup_threshold_cents: parsed.data.thresholdCents,
      auto_topup_amount_cents: parsed.data.amountCents,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("auto_topup_update_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  return { ok: true };
}
