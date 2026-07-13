import "server-only";
import { grossFromNetCents } from "@/lib/shared/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeEnabled } from "@/lib/server/stripe";

/**
 * Off-session auto top-up (§6.6): when the balance falls below the user's
 * threshold, charge the saved payment method. The webhook books the credit
 * and clears the in-flight flag; SCA/3DS failures notify the user.
 */
export async function processAutoTopup(userId: string): Promise<void> {
  if (!stripeEnabled()) return;

  const admin = createAdminClient();
  const [{ data: account }, { data: profile }] = await Promise.all([
    admin
      .from("billing_accounts")
      .select(
        "stripe_customer_id, auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents, default_payment_method_id, auto_topup_pending_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    admin.from("profiles").select("credit_balance_cents, status").eq("id", userId).single(),
  ]);

  if (
    !account?.auto_topup_enabled ||
    !account.stripe_customer_id ||
    !account.default_payment_method_id ||
    !account.auto_topup_amount_cents ||
    account.auto_topup_threshold_cents == null ||
    !profile ||
    profile.status !== "active"
  ) {
    return;
  }
  if (profile.credit_balance_cents >= account.auto_topup_threshold_cents) return;

  // Atomic in-flight claim: exactly one worker may set the flag. The filter
  // only matches when the flag is unset or stale (>1h — a lost webhook must
  // not disable auto top-up forever), so a concurrent claim yields zero rows
  // and that worker backs off. Prevents double off-session charges.
  const staleCutoff = new Date(Date.now() - 3_600_000).toISOString();
  const { data: claimedRows, error: flagError } = await admin
    .from("billing_accounts")
    .update({ auto_topup_pending_at: new Date().toISOString() })
    .eq("user_id", userId)
    .or(`auto_topup_pending_at.is.null,auto_topup_pending_at.lt.${staleCutoff}`)
    .select("user_id");
  if (flagError || !claimedRows || claimedRows.length === 0) return;

  try {
    const stripe = getStripe();
    // B2B: the configured top-up amount is the NET credit; the charge adds
    // 19 % VAT on top. The webhook books metadata.amount_cents (net), never
    // the gross charge amount. Itemized VAT invoice is deferred (IDEAS I-016).
    await stripe.paymentIntents.create({
      amount: grossFromNetCents(account.auto_topup_amount_cents),
      currency: "eur",
      customer: account.stripe_customer_id,
      payment_method: account.default_payment_method_id,
      off_session: true,
      confirm: true,
      metadata: {
        user_id: userId,
        purpose: "auto_topup",
        amount_cents: String(account.auto_topup_amount_cents),
      },
    });
    // Success/failure is handled by the webhook (payment_intent.succeeded/failed).
  } catch (err) {
    // SCA required or card declined: clear the flag; the failure webhook may
    // also fire, which is idempotent.
    console.error("auto_topup_charge_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    await admin
      .from("billing_accounts")
      .update({ auto_topup_pending_at: null })
      .eq("user_id", userId);
  }
}
