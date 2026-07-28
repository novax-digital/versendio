"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { blockedActionError, requireProfile } from "@/lib/server/auth-context";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import { loadPricingRows, loadDiscountPercent } from "@/lib/server/pricing/load";
import { calculateLetterPrice, PricingError } from "@/lib/shared/pricing";
import { isMockMode } from "@/lib/server/env";
import {
  quoteRequestSchema,
  confirmRequestSchema,
  MAX_RECIPIENTS_PER_JOB,
} from "@/lib/shared/schemas/send";
import type { RecipientAddress } from "@/lib/shared/address";
import { de } from "@/lib/i18n/de";

export type QuoteResult =
  | {
      ok: true;
      recipientCount: number;
      sheets: number;
      pricePerLetterCents: number;
      totalCents: number;
      balanceCents: number;
      sufficient: boolean;
      discountPercent: number;
    }
  | { ok: false; error: string };

type RecipientRow = RecipientAddress & { contactId: string | null };

class TooManyRecipientsError extends Error {}

/**
 * Loads the selected recipients. A lead list larger than the cap is rejected
 * loudly — silently truncating would charge the user for a partial mailing
 * they believe went out in full.
 */
async function loadRecipients(
  userId: string,
  selection: { source: "lead_list"; leadListId: string } | { source: "contacts"; contactIds: string[] },
): Promise<RecipientRow[]> {
  const supabase = await createClient();

  if (selection.source === "lead_list") {
    // Explicit ownership pin — the RLS policy alone must not be the only guard.
    const { data: list } = await supabase
      .from("lead_lists")
      .select("id")
      .eq("id", selection.leadListId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!list) return [];

    const { data, count } = await supabase
      .from("lead_list_entries")
      .select(
        "contacts(id, salutation, first_name, last_name, company, street, address_extra, zip, city, country)",
        { count: "exact" },
      )
      .eq("list_id", selection.leadListId)
      .limit(MAX_RECIPIENTS_PER_JOB + 1);

    if ((count ?? 0) > MAX_RECIPIENTS_PER_JOB) {
      throw new TooManyRecipientsError();
    }
    return (data ?? [])
      .map((e) => e.contacts as unknown as ContactRow | null)
      .filter((c): c is ContactRow => !!c)
      .map(toRecipient);
  }

  if (selection.contactIds.length > MAX_RECIPIENTS_PER_JOB) {
    throw new TooManyRecipientsError();
  }
  const { data } = await supabase
    .from("contacts")
    .select("id, salutation, first_name, last_name, company, street, address_extra, zip, city, country")
    .in("id", selection.contactIds)
    .eq("user_id", userId);
  return (data ?? []).map((c) => toRecipient(c as ContactRow));
}

function tooManyRecipients(err: unknown): boolean {
  return err instanceof TooManyRecipientsError;
}

type ContactRow = {
  id: string;
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  street: string;
  address_extra: string | null;
  zip: string;
  city: string;
  country: string;
};

function toRecipient(c: ContactRow): RecipientRow {
  return {
    contactId: c.id,
    salutation: c.salutation,
    firstName: c.first_name,
    lastName: c.last_name,
    company: c.company,
    street: c.street,
    addressExtra: c.address_extra,
    zip: c.zip,
    city: c.city,
    country: c.country,
  };
}

/** Estimated sheets for pricing: stored sheet_count (incl. cover), min 1. */
async function loadLetterEstimate(letterId: string, userId: string) {
  const supabase = await createClient();
  const { data: letter } = await supabase
    .from("letters")
    .select("id, title, status, sheet_count, page_count, source, use_cover_letter")
    .eq("id", letterId)
    .eq("user_id", userId)
    .maybeSingle();
  return letter;
}

/**
 * An uploaded PDF without cover letter is submitted byte-for-byte, so its
 * printed page-1 address can match at most ONE recipient's metadata — Deutsche
 * Post compares both and rejects deviations with E203. Multi-recipient sends
 * therefore require the cover letter (which prints each recipient's address).
 */
function uploadCoverConflict(
  letter: { source: string; use_cover_letter: boolean | null },
  recipientCount: number,
): boolean {
  return letter.source === "upload" && !letter.use_cover_letter && recipientCount > 1;
}

export async function quoteSendJobAction(_prev: unknown, input: unknown): Promise<QuoteResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("send", `quote:${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = quoteRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const letter = await loadLetterEstimate(parsed.data.letterId, profile.id);
  if (!letter || letter.status !== "ready") {
    return { ok: false, error: de.send.letterNotReady };
  }

  let recipients;
  try {
    recipients = await loadRecipients(profile.id, parsed.data.recipients);
  } catch (err) {
    if (tooManyRecipients(err)) {
      return { ok: false, error: de.send.tooManyRecipients(MAX_RECIPIENTS_PER_JOB) };
    }
    throw err;
  }
  if (recipients.length === 0) return { ok: false, error: de.send.noRecipients };
  if (uploadCoverConflict(letter, recipients.length)) {
    return { ok: false, error: de.send.uploadNeedsCoverForMulti };
  }

  const sheets = Math.max(1, letter.sheet_count ?? 1);

  try {
    const [rows, discountPercent] = await Promise.all([
      loadPricingRows(),
      loadDiscountPercent(profile.plan_id),
    ]);
    const price = calculateLetterPrice(rows, {
      sheets,
      isColor: parsed.data.options.isColor,
      isDuplex: parsed.data.options.isDuplex,
      registered: parsed.data.options.registered,
      discountPercent,
    });
    const total = price.vkCents * recipients.length;
    // VK only — EK/margin never leaves the server (ADR-0002 §4).
    return {
      ok: true,
      recipientCount: recipients.length,
      sheets,
      pricePerLetterCents: price.vkCents,
      totalCents: total,
      balanceCents: profile.credit_balance_cents,
      sufficient: profile.credit_balance_cents >= total,
      discountPercent,
    };
  } catch (err) {
    if (err instanceof PricingError) {
      console.error("quote_pricing_error", { code: err.code });
      return { ok: false, error: de.send.pricingUnavailable };
    }
    throw err;
  }
}

export type ConfirmResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string };

export async function confirmSendJobAction(_prev: unknown, input: unknown): Promise<ConfirmResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = confirmRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? de.common.genericError };
  }

  // Test sends submit real letters to E-Post (testFlag, unbilled) without any
  // credit debit — admin-only so the free path cannot be abused.
  if (parsed.data.isTest && profile.role !== "admin") {
    return { ok: false, error: de.send.testSendAdminOnly };
  }

  const ip = await clientIp();
  if (!(await checkRateLimit("send", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const letter = await loadLetterEstimate(parsed.data.letterId, profile.id);
  if (!letter || letter.status !== "ready") {
    return { ok: false, error: de.send.letterNotReady };
  }

  // Sender address snapshot (default or explicitly chosen), pinned to owner.
  const supabase = await createClient();
  let senderQuery = supabase
    .from("sender_addresses")
    .select("id, label, company, first_name, last_name, street, zip, city, country, sender_line")
    .eq("user_id", profile.id);
  senderQuery = parsed.data.senderAddressId
    ? senderQuery.eq("id", parsed.data.senderAddressId)
    : senderQuery.eq("is_default", true);
  const { data: sender } = await senderQuery.maybeSingle();
  if (!sender) return { ok: false, error: de.send.noSenderAddress };

  let recipients;
  try {
    recipients = await loadRecipients(profile.id, parsed.data.recipients);
  } catch (err) {
    if (tooManyRecipients(err)) {
      return { ok: false, error: de.send.tooManyRecipients(MAX_RECIPIENTS_PER_JOB) };
    }
    throw err;
  }
  if (recipients.length === 0) return { ok: false, error: de.send.noRecipients };
  if (uploadCoverConflict(letter, recipients.length)) {
    return { ok: false, error: de.send.uploadNeedsCoverForMulti };
  }

  const sheets = Math.max(1, letter.sheet_count ?? 1);
  const [rows, discountPercent] = await Promise.all([
    loadPricingRows(),
    loadDiscountPercent(profile.plan_id),
  ]);

  let price;
  try {
    price = calculateLetterPrice(rows, {
      sheets,
      isColor: parsed.data.options.isColor,
      isDuplex: parsed.data.options.isDuplex,
      registered: parsed.data.options.registered,
      discountPercent,
    });
  } catch {
    return { ok: false, error: de.send.pricingUnavailable };
  }

  // Snapshot carries everything needed to reprice a different sheet count at
  // submit time (render adjust) without touching the live pricing table.
  const pricingSnapshot = { discountPercent, rows, sheets };

  const items = recipients.map((r) => ({
    contact_id: r.contactId,
    recipient_snapshot: {
      salutation: r.salutation,
      firstName: r.firstName,
      lastName: r.lastName,
      company: r.company,
      street: r.street,
      addressExtra: r.addressExtra,
      zip: r.zip,
      city: r.city,
      country: r.country,
    },
    sheet_count: sheets,
    vk_cents: price.vkCents,
    ek_cents: price.ekCents,
    pricing_snapshot: pricingSnapshot,
  }));

  const admin = createAdminClient();
  const { data: jobId, error } = await admin.rpc("confirm_send_job", {
    p_user_id: profile.id,
    p_client_token: parsed.data.clientToken,
    p_letter_id: letter.id,
    p_sender_snapshot: sender,
    p_is_color: parsed.data.options.isColor,
    p_is_duplex: parsed.data.options.isDuplex,
    p_registered: parsed.data.options.registered,
    p_is_test: parsed.data.isTest,
    p_scheduled_release_at: parsed.data.scheduledReleaseAt ?? null,
    p_provider: isMockMode() ? "mock" : "epost",
    p_total_vk_cents: price.vkCents * recipients.length,
    p_total_ek_cents: price.ekCents * recipients.length,
    p_items: items,
  });

  if (error) {
    if (error.message.includes("insufficient_funds")) {
      return { ok: false, error: de.send.insufficientFunds };
    }
    if (error.message.includes("test_send_forbidden")) {
      return { ok: false, error: de.send.testSendAdminOnly };
    }
    console.error("confirm_send_job_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  // The debit may have pushed the balance under the auto-top-up threshold.
  if (!parsed.data.isTest) {
    const { enqueueJob } = await import("@/lib/server/queue/enqueue");
    await enqueueJob("auto_topup", { userId: profile.id });
  }

  return { ok: true, jobId: jobId as string };
}

export async function cancelJobAction(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: true; refundedCents: number } | { ok: false; error: string }> {
  const profile = await requireProfile();
  const jobId = formData.get("jobId");
  if (typeof jobId !== "string" || !jobId) return { ok: false, error: de.common.genericError };

  // Ownership check with the RLS-scoped client before the service-role RPC.
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("send_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!job) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: refunded, error } = await admin.rpc("cancel_pending_job_items", {
    p_job_id: jobId,
    p_actor: "user",
  });
  if (error) {
    console.error("cancel_job_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  // Mixed jobs (some items already final) may be completable now.
  const { maybeCompleteJob } = await import("@/lib/server/send/complete-job");
  await maybeCompleteJob(jobId);

  return { ok: true, refundedCents: (refunded as number) ?? 0 };
}
