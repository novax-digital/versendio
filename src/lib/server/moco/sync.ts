import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/server/crypto";
import { BUCKETS } from "@/lib/server/storage";
import { normalizePdfToA4 } from "@/lib/server/pdf/normalize";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { isSubmittable } from "@/lib/shared/validation-result";
import { loadPricingRows, loadDiscountPercent } from "@/lib/server/pricing/load";
import { calculateLetterPrice } from "@/lib/shared/pricing";
import { contactSchema } from "@/lib/shared/schemas/contact";
import { parseMocoRecipientAddress } from "@/lib/shared/moco-address";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { isMockMode } from "@/lib/server/env";
import {
  MocoError,
  getMocoInvoice,
  getMocoInvoicePdf,
  getMocoReminderPdf,
  listMocoInvoices,
  listMocoReminders,
  type MocoAuth,
  type MocoInvoice,
} from "./client";

/**
 * MOCO → letter sync engine (flows-scheduler pattern): cron-driven, small
 * batches, per-account isolation, idempotent money booking. Each processed
 * document is claimed by inserting into moco_documents FIRST (unique index =
 * cross-tick/cross-instance claim); the row id is confirm_send_job's client
 * token, so a crash anywhere in between resumes without double-charging.
 */

const TIME_BUDGET_MS = 45_000;
const MAX_ACCOUNTS_PER_TICK = 20;
const MAX_DOCS_PER_ACCOUNT_TICK = 10;

type MocoAccountRow = {
  user_id: string;
  subdomain: string;
  api_key_enc: string;
  status: string;
  auto_send_invoices: boolean;
  invoice_trigger_status: string;
  auto_send_reminders: boolean;
  is_duplex: boolean;
  is_color: boolean;
  activated_at: string | null;
};

type DocCandidate = {
  docType: "invoice" | "reminder";
  mocoId: number;
  identifier: string;
  title: string;
  date: string;
  /** Invoice carrying the recipient address (the reminder's linked invoice). */
  addressInvoiceId: number;
  recipientAddress: string | null; // present for invoices from the list payload
  reminderFileUrl: string | null;
};

export type MocoSyncStats = {
  accounts: number;
  sent: number;
  failed: number;
  insufficientFunds: number;
};

/** Cron entry: sync all active accounts with at least one auto-send rule. */
export async function runMocoSync(): Promise<MocoSyncStats> {
  const admin = createAdminClient();
  const startedAt = Date.now();
  const stats: MocoSyncStats = { accounts: 0, sent: 0, failed: 0, insufficientFunds: 0 };

  const { data: accounts, error } = await admin
    .from("moco_accounts")
    .select(
      "user_id, subdomain, api_key_enc, status, auto_send_invoices, invoice_trigger_status, auto_send_reminders, is_duplex, is_color, activated_at",
    )
    .eq("status", "active")
    .or("auto_send_invoices.eq.true,auto_send_reminders.eq.true")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(MAX_ACCOUNTS_PER_TICK);
  if (error) {
    console.error("moco_sync_scan_failed", { error: error.message });
    return stats;
  }

  for (const account of accounts ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    stats.accounts += 1;
    try {
      const result = await syncMocoAccount(account as MocoAccountRow);
      stats.sent += result.sent;
      stats.failed += result.failed;
      stats.insufficientFunds += result.insufficientFunds;
    } catch (err) {
      // One account's failure must never starve the others.
      console.error("moco_sync_account_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return stats;
}

/** Loads and syncs a single user's account (manual "Jetzt synchronisieren"). */
export async function syncMocoAccountForUser(
  userId: string,
): Promise<{ sent: number; failed: number; insufficientFunds: number } | null> {
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("moco_accounts")
    .select(
      "user_id, subdomain, api_key_enc, status, auto_send_invoices, invoice_trigger_status, auto_send_reminders, is_duplex, is_color, activated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!account) return null;
  return syncMocoAccount(account as MocoAccountRow);
}

async function syncMocoAccount(account: MocoAccountRow) {
  const admin = createAdminClient();
  const counters = { sent: 0, failed: 0, insufficientFunds: 0 };
  const auth: MocoAuth = {
    subdomain: account.subdomain,
    apiKey: decryptSecret(account.api_key_enc),
  };

  // Watermark: never auto-send documents predating the integration.
  const watermark = (account.activated_at ?? new Date().toISOString()).slice(0, 10);

  let candidates: DocCandidate[];
  try {
    candidates = await collectCandidates(auth, account, watermark);
  } catch (err) {
    await recordAccountError(account.user_id, err);
    return counters;
  }

  // Resume claims from a crashed earlier tick before taking on new work.
  const { data: pendingRows } = await admin
    .from("moco_documents")
    .select("id, doc_type, moco_id, identifier, title, letter_id")
    .eq("user_id", account.user_id)
    .eq("status", "pending")
    .limit(MAX_DOCS_PER_ACCOUNT_TICK);

  const { data: existing } = await admin
    .from("moco_documents")
    .select("doc_type, moco_id")
    .eq("user_id", account.user_id);
  const seen = new Set((existing ?? []).map((r) => `${r.doc_type}:${r.moco_id}`));

  const fresh = candidates
    .filter((c) => !seen.has(`${c.docType}:${c.mocoId}`))
    .slice(0, MAX_DOCS_PER_ACCOUNT_TICK);

  // Shared per-tick context (sender, pricing) — loaded once, not per document.
  const { data: sender } = await admin
    .from("sender_addresses")
    .select("id, label, company, first_name, last_name, street, zip, city, country, sender_line")
    .eq("user_id", account.user_id)
    .eq("is_default", true)
    .maybeSingle();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_id, status")
    .eq("id", account.user_id)
    .maybeSingle();
  if (!profile || profile.status !== "active") return counters;
  const [rows, discountPercent] = await Promise.all([
    loadPricingRows(),
    loadDiscountPercent(profile.plan_id ?? null),
  ]);

  const ctx: DocContext = {
    admin,
    auth,
    account,
    sender: sender ?? null,
    pricing: { rows, discountPercent },
  };

  // 1) Resume pending claims (idempotent client token = row id).
  for (const row of pendingRows ?? []) {
    const outcome = await processClaimedDoc(ctx, {
      claimId: row.id,
      docType: row.doc_type as "invoice" | "reminder",
      mocoId: row.moco_id,
      identifier: row.identifier ?? "",
      title: row.title ?? "",
      letterId: row.letter_id,
    });
    bump(counters, outcome);
    if (outcome === "insufficient_funds") break;
  }

  // 2) New documents: claim (insert) then process.
  if (counters.insufficientFunds === 0) {
    for (const doc of fresh) {
      const { data: claim, error: claimError } = await admin
        .from("moco_documents")
        .insert({
          user_id: account.user_id,
          doc_type: doc.docType,
          moco_id: doc.mocoId,
          identifier: doc.identifier,
          title: doc.title,
          doc_date: doc.date || null,
          status: "pending",
        })
        .select("id")
        .maybeSingle();
      if (claimError || !claim) {
        // Unique violation → another tick claimed it concurrently. Skip.
        continue;
      }
      const outcome = await processClaimedDoc(ctx, {
        claimId: claim.id,
        docType: doc.docType,
        mocoId: doc.mocoId,
        identifier: doc.identifier,
        title: doc.title,
        letterId: null,
        candidate: doc,
      });
      bump(counters, outcome);
      if (outcome === "insufficient_funds") break;
    }
  }

  await admin
    .from("moco_accounts")
    .update({ last_sync_at: new Date().toISOString(), last_error: null })
    .eq("user_id", account.user_id);

  // Digest: one mail per tick with activity (flow_summary pattern).
  if (counters.sent + counters.failed + counters.insufficientFunds > 0) {
    await enqueueJob("send_email", {
      template: "moco_summary",
      userId: account.user_id,
      sentCount: counters.sent,
      failedCount: counters.failed,
      heldFundsCount: counters.insufficientFunds,
    });
  }
  return counters;
}

type DocContext = {
  admin: ReturnType<typeof createAdminClient>;
  auth: MocoAuth;
  account: MocoAccountRow;
  sender: Record<string, unknown> | null;
  pricing: { rows: Awaited<ReturnType<typeof loadPricingRows>>; discountPercent: number };
};

type ClaimedDoc = {
  claimId: string;
  docType: "invoice" | "reminder";
  mocoId: number;
  identifier: string;
  title: string;
  letterId: string | null;
  candidate?: DocCandidate;
};

type DocOutcome = "sent" | "failed" | "insufficient_funds";

function bump(counters: { sent: number; failed: number; insufficientFunds: number }, o: DocOutcome) {
  if (o === "sent") counters.sent += 1;
  else if (o === "failed") counters.failed += 1;
  else counters.insufficientFunds += 1;
}

async function collectCandidates(
  auth: MocoAuth,
  account: MocoAccountRow,
  dateFrom: string,
): Promise<DocCandidate[]> {
  const out: DocCandidate[] = [];
  if (account.auto_send_invoices) {
    const invoices = await listMocoInvoices(auth, {
      status: account.invoice_trigger_status,
      dateFrom,
    });
    for (const inv of invoices) {
      out.push({
        docType: "invoice",
        mocoId: inv.id,
        identifier: inv.identifier,
        title: inv.title,
        date: inv.date,
        addressInvoiceId: inv.id,
        recipientAddress: inv.recipient_address || null,
        reminderFileUrl: null,
      });
    }
  }
  if (account.auto_send_reminders) {
    const reminders = await listMocoReminders(auth, { dateFrom });
    for (const rem of reminders) {
      // "created" = drafted in MOCO but not e-mailed — the postal case.
      if (rem.status !== "created" || !rem.invoice) continue;
      out.push({
        docType: "reminder",
        mocoId: rem.id,
        identifier: rem.invoice.identifier ?? String(rem.invoice.id),
        title: rem.title ?? `Mahnung zu ${rem.invoice.identifier ?? rem.invoice.id}`,
        date: rem.date,
        addressInvoiceId: rem.invoice.id,
        recipientAddress: null,
        reminderFileUrl: rem.file_url,
      });
    }
  }
  return out;
}

/**
 * Runs one claimed document to a terminal state. Never throws for per-doc
 * problems — the claim row records the outcome; only account-level failures
 * (auth) propagate via recordAccountError by the caller's collect step.
 */
async function processClaimedDoc(ctx: DocContext, doc: ClaimedDoc): Promise<DocOutcome> {
  const { admin, account } = ctx;

  const fail = async (detail: string): Promise<DocOutcome> => {
    await admin
      .from("moco_documents")
      .update({ status: "failed", detail })
      .eq("id", doc.claimId)
      .eq("status", "pending");
    return "failed";
  };

  try {
    if (!ctx.sender) return await fail("no_sender_address");

    // 1) Letter: reuse a letter created before a crash, else build it now.
    let letterId = doc.letterId;
    let sheetCount: number | null = null;
    if (letterId) {
      const { data: letter } = await admin
        .from("letters")
        .select("id, sheet_count")
        .eq("id", letterId)
        .maybeSingle();
      if (letter) sheetCount = letter.sheet_count;
      else letterId = null;
    }

    if (!letterId) {
      const built = await buildLetterForDoc(ctx, doc);
      if ("error" in built) return await fail(built.error);
      letterId = built.letterId;
      sheetCount = built.sheetCount;
      await admin
        .from("moco_documents")
        .update({ letter_id: letterId })
        .eq("id", doc.claimId)
        .eq("status", "pending");
    }

    // 2) Recipient: parse from the (possibly re-fetched) invoice address.
    const recipient = await resolveRecipient(ctx, doc);
    if ("error" in recipient) return await fail(recipient.error);

    // 3) Price + charge + queue (idempotent on the claim id).
    const sheets = Math.max(1, sheetCount ?? 1);
    const price = calculateLetterPrice(ctx.pricing.rows, {
      sheets,
      isColor: account.is_color,
      isDuplex: account.is_duplex,
      registered: "none",
      discountPercent: ctx.pricing.discountPercent,
    });

    const { data: jobId, error: rpcError } = await admin.rpc("confirm_send_job", {
      p_user_id: account.user_id,
      p_client_token: doc.claimId,
      p_letter_id: letterId,
      p_sender_snapshot: ctx.sender,
      p_is_color: account.is_color,
      p_is_duplex: account.is_duplex,
      p_registered: "none",
      p_is_test: false,
      p_scheduled_release_at: null,
      p_provider: isMockMode() ? "mock" : "epost",
      p_total_vk_cents: price.vkCents,
      p_total_ek_cents: price.ekCents,
      p_items: [
        {
          contact_id: null,
          recipient_snapshot: recipient.snapshot,
          sheet_count: sheets,
          vk_cents: price.vkCents,
          ek_cents: price.ekCents,
          pricing_snapshot: {
            discountPercent: ctx.pricing.discountPercent,
            rows: ctx.pricing.rows,
            sheets,
          },
        },
      ],
    });

    if (rpcError) {
      if (rpcError.message.includes("insufficient_funds")) {
        await admin
          .from("moco_documents")
          .update({ status: "failed", detail: "insufficient_funds" })
          .eq("id", doc.claimId)
          .eq("status", "pending");
        return "insufficient_funds";
      }
      return await fail(`send_failed: ${rpcError.message.slice(0, 200)}`);
    }

    await admin
      .from("moco_documents")
      .update({ status: "sent", send_job_id: jobId as string, detail: null })
      .eq("id", doc.claimId)
      .eq("status", "pending");
    return "sent";
  } catch (err) {
    if (err instanceof MocoError && err.transient) {
      // Leave the claim pending — the next tick resumes it.
      return "failed";
    }
    return await fail(err instanceof Error ? err.message.slice(0, 200) : "unknown_error");
  }
}

async function buildLetterForDoc(
  ctx: DocContext,
  doc: ClaimedDoc,
): Promise<{ letterId: string; sheetCount: number } | { error: string }> {
  const { admin, auth, account } = ctx;

  let pdf: Uint8Array;
  if (doc.docType === "invoice") {
    pdf = await getMocoInvoicePdf(auth, doc.mocoId);
  } else {
    const fileUrl =
      doc.candidate?.reminderFileUrl ??
      (await listMocoReminders(auth, { dateFrom: "1970-01-01" })
        .then((rs) => rs.find((r) => r.id === doc.mocoId)?.file_url ?? null)
        .catch(() => null));
    if (!fileUrl) return { error: "reminder_pdf_unavailable" };
    pdf = await getMocoReminderPdf(auth, fileUrl);
  }

  const { bytes, adjusted } = await normalizePdfToA4(pdf);
  const validation = await validateLetterPdf(bytes, { a4Normalized: adjusted });
  if (!isSubmittable(validation)) {
    const firstError = validation.rules.find((r) => r.severity === "error");
    return { error: `pdf_invalid: ${firstError?.message ?? "?"}`.slice(0, 300) };
  }

  const letterId = randomUUID();
  const storagePath = `${account.user_id}/letters/${letterId}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(BUCKETS.letters)
    .upload(storagePath, bytes as unknown as Blob, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) return { error: `storage_failed: ${uploadError.message.slice(0, 200)}` };

  const coverSheets = validation.needsCoverLetter ? 1 : 0;
  const sheetCount = (validation.sheetCountSimplex ?? 0) + coverSheets;
  const label = doc.docType === "invoice" ? "Rechnung" : "Mahnung";
  const { error: insertError } = await admin.from("letters").insert({
    id: letterId,
    user_id: account.user_id,
    title: `MOCO ${label} ${doc.identifier || doc.mocoId}`.slice(0, 200),
    source: "upload",
    storage_path: storagePath,
    page_count: validation.pageCount,
    sheet_count: sheetCount,
    file_size_bytes: validation.fileSizeBytes,
    validation: validation as unknown as Record<string, unknown>,
    address_zone_result: validation.addressZoneResult,
    needs_cover_letter: validation.needsCoverLetter,
    use_cover_letter: validation.needsCoverLetter,
    has_placeholders: false,
    status: "ready",
  });
  if (insertError) {
    await admin.storage.from(BUCKETS.letters).remove([storagePath]);
    return { error: `letter_insert_failed: ${insertError.message.slice(0, 200)}` };
  }
  return { letterId, sheetCount };
}

async function resolveRecipient(
  ctx: DocContext,
  doc: ClaimedDoc,
): Promise<{ snapshot: Record<string, unknown> } | { error: string }> {
  const { auth } = ctx;

  // Invoices from the list payload carry the address; reminders and resumed
  // claims re-fetch the (linked) invoice.
  let invoice: MocoInvoice | null = null;
  let rawAddress = doc.candidate?.recipientAddress ?? null;
  const invoiceId = doc.candidate?.addressInvoiceId ?? (doc.docType === "invoice" ? doc.mocoId : null);
  if (!rawAddress) {
    if (!invoiceId) return { error: "address_unavailable" };
    invoice = await getMocoInvoice(auth, invoiceId);
    rawAddress = invoice.recipient_address || null;
  }
  if (!rawAddress) return { error: "address_unavailable" };

  const parsed = parseMocoRecipientAddress(rawAddress);
  if (!parsed.ok) return { error: `address_parse_failed: ${parsed.reason}` };

  const check = contactSchema.safeParse({
    company: parsed.recipient.company,
    addressExtra: parsed.recipient.addressExtra ?? undefined,
    street: parsed.recipient.street,
    zip: parsed.recipient.zip,
    city: parsed.recipient.city,
    country: parsed.recipient.country,
  });
  if (!check.success) {
    return { error: `address_invalid: ${check.error.issues[0]?.message ?? "?"}`.slice(0, 200) };
  }

  return {
    snapshot: {
      salutation: null,
      firstName: check.data.firstName || null,
      lastName: check.data.lastName || null,
      company: check.data.company || null,
      street: check.data.street,
      addressExtra: check.data.addressExtra || null,
      zip: check.data.zip,
      city: check.data.city,
      country: check.data.country,
    },
  };
}

async function recordAccountError(userId: string, err: unknown): Promise<void> {
  const admin = createAdminClient();
  const isAuth = err instanceof MocoError && !err.transient;
  await admin
    .from("moco_accounts")
    .update({
      status: isAuth ? "error" : "active",
      last_error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      last_sync_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}
