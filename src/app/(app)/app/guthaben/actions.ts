"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { getOrCreateCustomer, getStripe, getVatTaxRateId, stripeEnabled } from "@/lib/server/stripe";
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
  // B2B: the credit amount is NET; the checkout adds 19 % VAT on top via a
  // fixed exclusive tax rate, itemized on the Stripe invoice. The webhook
  // books metadata.amount_cents — the net amount — as credit.
  const vatTaxRateId = await getVatTaxRateId(stripe);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    // No payment_method_types → Stripe offers the dashboard-activated methods
    // (card; SEPA once enabled). Hardcoding a not-yet-activated method fails.
    line_items: [
      {
        quantity: 1,
        tax_rates: [vatTaxRateId],
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

/**
 * Embedded setup: creates a Stripe Checkout session in embedded mode so the
 * card/SEPA form renders INSIDE our UI (no redirect to a hosted page).
 * redirect_on_completion 'never' → the client reconciles via syncPaymentMethod.
 */
export async function createSetupSessionAction(): Promise<
  ActionResult<{ clientSecret: string; sessionId: string }>
> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };

  const stripe = getStripe();
  const customerId = await getOrCreateCustomer(profile.id, profile.email);
  try {
    // No payment_method_types → Stripe offers the methods activated in the
    // dashboard (card now; SEPA appears automatically once enabled). Setup
    // mode with dynamic methods requires a currency.
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      ui_mode: "embedded_page",
      currency: "eur",
      customer: customerId,
      redirect_on_completion: "never",
      metadata: { user_id: profile.id, purpose: "auto_topup_setup" },
    });
    if (!session.client_secret || !session.id) {
      return { ok: false, error: de.common.genericError };
    }
    return { ok: true, data: { clientSecret: session.client_secret, sessionId: session.id } };
  } catch (err) {
    console.error("setup_session_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: de.common.genericError };
  }
}

/**
 * After the embedded setup completes, store the saved payment method as the
 * default. Idempotent with the webhook's storePaymentMethod; the session's
 * metadata.user_id is checked so a session id can only attach to its owner.
 */
export async function syncPaymentMethodAction(input: unknown): Promise<ActionResult> {
  const profile = await requireProfile();
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };
  const parsed = z.object({ sessionId: z.string().min(1).max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId, {
    expand: ["setup_intent"],
  });
  if (session.metadata?.user_id !== profile.id) {
    return { ok: false, error: de.common.genericError };
  }
  const setupIntent = session.setup_intent;
  const paymentMethodId =
    typeof setupIntent === "object" && setupIntent
      ? typeof setupIntent.payment_method === "string"
        ? setupIntent.payment_method
        : (setupIntent.payment_method?.id ?? null)
      : null;
  if (!paymentMethodId) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { error } = await admin
    .from("billing_accounts")
    .upsert(
      { user_id: profile.id, default_payment_method_id: paymentMethodId },
      { onConflict: "user_id" },
    );
  if (error) {
    console.error("sync_payment_method_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/guthaben");
  return { ok: true };
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

/** Detaches the saved card at Stripe and clears it locally; disables auto top-up. */
export async function removePaymentMethodAction(): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };
  if (!stripeEnabled()) return { ok: false, error: de.credits.stripeDisabled };

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("billing_accounts")
    .select("default_payment_method_id")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (account?.default_payment_method_id) {
    try {
      await getStripe().paymentMethods.detach(account.default_payment_method_id);
    } catch (err) {
      // Already detached / unknown at Stripe — clear locally regardless.
      console.error("payment_method_detach_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const { error } = await admin
    .from("billing_accounts")
    .update({ default_payment_method_id: null, auto_topup_enabled: false })
    .eq("user_id", profile.id);
  if (error) {
    console.error("payment_method_remove_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/guthaben");
  return { ok: true };
}
