import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/server/stripe";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting } from "@/lib/server/settings";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { sendMail } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
import { computeBonusCents, type BonusTier } from "@/lib/shared/topup-bonus";
import { de } from "@/lib/i18n/de";

export const maxDuration = 60;

/**
 * Stripe webhook: THE only place credit is granted for payments (§6.6 —
 * never on redirect). Signature-verified; idempotent via webhook_events
 * (unique event_id) plus the ledger reference index.
 */
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency gate: only SUCCESSFULLY PROCESSED events are terminal
  // duplicates. A replay of a previously failed event must re-run processing —
  // otherwise a transient error would permanently swallow a paid top-up
  // (Stripe stops retrying once it sees a 200). The ledger's unique reference
  // index makes reprocessing safe against double credit.
  const { error: insertError } = await admin.from("webhook_events").insert({
    provider: "stripe",
    event_id: event.id,
    type: event.type,
    payload: { type: event.type }, // metadata only — full payloads can carry PII
  });
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: existing } = await admin
        .from("webhook_events")
        .select("status")
        .eq("event_id", event.id)
        .single();
      if (existing?.status === "processed") {
        return NextResponse.json({ received: true, duplicate: true });
      }
      // fall through: re-run processing for received/failed replays
    } else {
      console.error("webhook_event_insert_failed", { error: insertError.message });
      return NextResponse.json({ error: "storage_failed" }, { status: 500 });
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment" && session.payment_status === "paid") {
          await creditTopup(event.id, session);
        }
        if (session.mode === "setup") {
          await storePaymentMethod(session);
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // Auto top-ups run through the invoicing flow and carry our metadata.
        // Checkout-created invoices (regular top-ups) have no purpose metadata
        // and are credited via checkout.session.completed instead.
        if (invoice.metadata?.purpose === "auto_topup") {
          await creditAutoTopupInvoice(event.id, invoice);
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.metadata?.purpose === "auto_topup" && invoice.metadata.user_id) {
          await handleAutoTopupFailure(invoice.metadata.user_id);
        }
        break;
      }
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        // Legacy path: auto top-ups created as bare PaymentIntents before the
        // invoicing flow (2026-07-13) carry our metadata directly. New invoice
        // payments arrive WITHOUT purpose metadata on the intent and are
        // credited via invoice.paid; checkout payments via checkout.session.*.
        if (intent.metadata?.purpose === "auto_topup") {
          await creditAutoTopup(event.id, intent);
        }
        break;
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata?.purpose === "auto_topup" && intent.metadata.user_id) {
          await handleAutoTopupFailure(intent.metadata.user_id);
        }
        break;
      }
      default:
        break;
    }

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("event_id", event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    console.error("webhook_processing_failed", { type: event.type, error: message });
    await admin
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("event_id", event.id);
    // 500 → Stripe retries; ledger idempotency makes the retry safe.
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

async function creditTopup(eventId: string, session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;
  const amount = Number(session.metadata?.amount_cents);
  if (!userId || !Number.isInteger(amount) || amount <= 0) {
    throw new Error("topup_metadata_invalid");
  }

  // Receipt is cosmetic and must never gate the credit: best-effort only.
  // (The ledger is append-only, so the URL has to be known at booking time —
  // a failed lookup just means the row carries no receipt link.)
  let receipt: { url: string | null; invoiceId: string | null } = { url: null, invoiceId: null };
  try {
    receipt = await resolveReceipt(session);
  } catch (err) {
    console.error("receipt_resolution_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
  }

  await bookTopup(userId, amount, eventId, receipt.url, receipt.invoiceId, "Guthaben-Aufladung");
}

async function creditAutoTopupInvoice(eventId: string, invoice: Stripe.Invoice): Promise<void> {
  const userId = invoice.metadata?.user_id;
  // Credited is the NET amount from our metadata (the invoice total is gross).
  const amount = Number(invoice.metadata?.amount_cents);
  if (!userId || !Number.isInteger(amount) || amount <= 0) {
    throw new Error("auto_topup_invoice_metadata_invalid");
  }

  await bookTopup(
    userId,
    amount,
    eventId,
    invoice.hosted_invoice_url ?? null,
    invoice.id ?? null,
    "Automatische Aufladung",
  );

  const admin = createAdminClient();
  await admin
    .from("billing_accounts")
    .update({ auto_topup_pending_at: null })
    .eq("user_id", userId);
}

/** Legacy: auto top-ups charged as bare PaymentIntents before 2026-07-13. */
async function creditAutoTopup(eventId: string, intent: Stripe.PaymentIntent): Promise<void> {
  const userId = intent.metadata.user_id;
  // B2B: the charge is gross (net + 19 % VAT); credited is the NET amount
  // from our metadata. Fallback to amount_received for intents created
  // before the VAT change (those were charged net without tax).
  const metaAmount = Number(intent.metadata.amount_cents);
  const amount =
    Number.isInteger(metaAmount) && metaAmount > 0 ? metaAmount : intent.amount_received;
  if (!userId || amount <= 0) throw new Error("auto_topup_metadata_invalid");

  const receiptUrl = await chargeReceiptUrl(intent.latest_charge);
  await bookTopup(userId, amount, eventId, receiptUrl, null, "Automatische Aufladung");

  const admin = createAdminClient();
  await admin
    .from("billing_accounts")
    .update({ auto_topup_pending_at: null })
    .eq("user_id", userId);
}

async function bookTopup(
  userId: string,
  amountCents: number,
  eventId: string,
  receiptUrl: string | null,
  invoiceId: string | null,
  comment: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("book_credit", {
    p_user_id: userId,
    p_type: "topup",
    p_amount_cents: amountCents,
    p_reference_type: "stripe_event",
    p_reference_id: eventId,
    p_comment: comment,
    p_created_by: "stripe",
    p_receipt_url: receiptUrl,
    p_stripe_invoice_id: invoiceId,
  });
  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`book_topup_failed: ${error.message}`);
  }

  // Bonus credit (gift, no VAT / no invoice): a SEPARATE ledger row keyed by
  // the same event.id but reference_type 'stripe_bonus', so a Stripe retry
  // re-books neither the net nor the bonus. Config is read at grant time.
  const tiers = await getJsonSetting<BonusTier[]>("topup_bonus_tiers", []);
  const bonusCents = computeBonusCents(amountCents, tiers);
  if (bonusCents > 0) {
    const { error: bonusError } = await admin.rpc("book_credit", {
      p_user_id: userId,
      p_type: "topup",
      p_amount_cents: bonusCents,
      p_reference_type: "stripe_bonus",
      p_reference_id: eventId,
      p_comment: de.credits.bonusComment,
      p_created_by: "stripe",
      p_receipt_url: null,
      p_stripe_invoice_id: null,
    });
    if (bonusError && !bonusError.message.includes("duplicate key")) {
      throw new Error(`book_bonus_failed: ${bonusError.message}`);
    }
  }

  // Fresh funds: release any letters parked on insufficient balance.
  const { data: held } = await admin
    .from("send_job_items")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "on_hold_funds")
    .limit(200);
  for (const item of held ?? []) {
    await enqueueJob("submit_item", { itemId: item.id });
  }
}

async function storePaymentMethod(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id;
  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id;
  if (!userId || !setupIntentId) return;

  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const paymentMethodId =
    typeof setupIntent.payment_method === "string"
      ? setupIntent.payment_method
      : setupIntent.payment_method?.id;
  if (!paymentMethodId) return;

  const admin = createAdminClient();
  await admin
    .from("billing_accounts")
    .update({ default_payment_method_id: paymentMethodId })
    .eq("user_id", userId);
}

async function handleAutoTopupFailure(userId: string): Promise<void> {
  const admin = createAdminClient();

  // Clearing the in-flight flag is the idempotency token for this notification:
  // only the first processing of the event (the one that actually clears a set
  // flag) mails the user. A webhook replay finds it null and stays silent.
  const { data: cleared } = await admin
    .from("billing_accounts")
    .update({ auto_topup_pending_at: null })
    .eq("user_id", userId)
    .not("auto_topup_pending_at", "is", null)
    .select("user_id");
  if (!cleared || cleared.length === 0) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("email, display_name")
    .eq("id", userId)
    .single();
  if (!profile?.email) return;

  const appName = serverEnv().APP_NAME;
  const appUrl = (serverEnv().APP_URL ?? "").replace(/\/$/, "");
  const { html, text } = renderBrandedEmail({
    displayName: profile.display_name,
    paragraphs: [
      "Ihre automatische Guthaben-Aufladung konnte nicht durchgeführt werden (z. B. wegen einer erforderlichen Bestätigung Ihrer Bank). Bitte laden Sie Ihr Guthaben manuell auf oder hinterlegen Sie eine andere Zahlungsmethode.",
    ],
    cta: appUrl ? { label: "Zum Guthaben", url: `${appUrl}/app/guthaben` } : undefined,
  });
  await sendMail({
    to: profile.email,
    subject: `Automatische Aufladung fehlgeschlagen – ${appName}`,
    html,
    text,
  });
}

async function resolveReceipt(
  session: Stripe.Checkout.Session,
): Promise<{ url: string | null; invoiceId: string | null }> {
  const stripe = getStripe();
  const invoiceId = typeof session.invoice === "string" ? session.invoice : session.invoice?.id;
  if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      return { url: invoice.hosted_invoice_url ?? null, invoiceId };
    } catch {
      // fall through to charge receipt
    }
  }
  const intentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (intentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(intentId);
      return { url: await chargeReceiptUrl(intent.latest_charge), invoiceId: null };
    } catch {
      return { url: null, invoiceId: null };
    }
  }
  return { url: null, invoiceId: null };
}

async function chargeReceiptUrl(
  latestCharge: string | Stripe.Charge | null,
): Promise<string | null> {
  if (!latestCharge) return null;
  if (typeof latestCharge !== "string") return latestCharge.receipt_url ?? null;
  try {
    const charge = await getStripe().charges.retrieve(latestCharge);
    return charge.receipt_url ?? null;
  } catch {
    return null;
  }
}
