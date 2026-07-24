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
} from "./client";

/**
 * MOCO → letter sync engine (flows-scheduler pattern): cron-driven, small
 * batches, per-account isolation, idempotent money booking.
 *
 * Exactly-once contract:
 * - A document is CLAIMED by inserting into moco_documents (unique index over
 *   user/subdomain/type/id); the row id is confirm_send_job's client token.
 * - Every processing attempt takes an optimistic lock (attempts counter as
 *   compare-and-swap), so a concurrent cron tick and manual sync can never
 *   work the same claim simultaneously.
 * - Resumes first look for an existing send_job with the claim's client token
 *   (repair after a crash between RPC commit and status flip) before doing
 *   any work — a charged document is never re-charged, re-built or reported
 *   as failed.
 * - insufficient_funds keeps the claim pending: topping up makes the next
 *   tick (or a manual sync) send it automatically. Only real per-document
 *   defects (bad PDF, unparseable address, attempt cap) are terminal.
 */

const TIME_BUDGET_MS = 40_000;
const MAX_ACCOUNTS_PER_TICK = 20;
const MAX_DOCS_PER_ACCOUNT_TICK = 10;
/** Terminal cap for repeated non-funds failures (poisoned documents). */
const MAX_ATTEMPTS = 5;

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
  invoices_activated_at: string | null;
  reminders_activated_at: string | null;
};

const ACCOUNT_COLUMNS =
  "user_id, subdomain, api_key_enc, status, auto_send_invoices, invoice_trigger_status, auto_send_reminders, is_duplex, is_color, invoices_activated_at, reminders_activated_at";

type DocCandidate = {
  docType: "invoice" | "reminder";
  mocoId: number;
  identifier: string;
  title: string;
  date: string;
  /** Invoice carrying the recipient address (the reminder's linked invoice). */
  addressInvoiceId: number;
  recipientAddress: string | null;
  reminderFileUrl: string | null;
};

type ClaimRow = {
  id: string;
  doc_type: "invoice" | "reminder";
  moco_id: number;
  identifier: string | null;
  letter_id: string | null;
  address_invoice_id: number | null;
  attempts: number;
  detail: string | null;
};

/**
 * sent/failed/funds_first feed the digest; retry/repaired/funds_repeat and
 * lock_lost are silent (nothing final happened this tick, or it already
 * counted in an earlier one).
 */
type DocOutcome =
  | "sent"
  | "failed"
  | "funds_first"
  | "funds_repeat"
  | "retry"
  | "repaired"
  | "lock_lost";

export type MocoSyncResult = {
  sent: number;
  failed: number;
  insufficientFunds: number;
  /** Account-level problem this run (auth/network) — nothing was processed. */
  accountError: "auth" | "transient" | null;
};

export type MocoSyncStats = {
  accounts: number;
  sent: number;
  failed: number;
  insufficientFunds: number;
};

/** MOCO document dates are local business dates — compare in Europe/Berlin. */
function berlinDate(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));
}

/** Cron entry: sync all active accounts with at least one auto-send rule. */
export async function runMocoSync(): Promise<MocoSyncStats> {
  const admin = createAdminClient();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const stats: MocoSyncStats = { accounts: 0, sent: 0, failed: 0, insufficientFunds: 0 };

  const { data: accounts, error } = await admin
    .from("moco_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("status", "active")
    .or("auto_send_invoices.eq.true,auto_send_reminders.eq.true")
    .order("last_sync_at", { ascending: true, nullsFirst: true })
    .limit(MAX_ACCOUNTS_PER_TICK);
  if (error) {
    console.error("moco_sync_scan_failed", { error: error.message });
    return stats;
  }

  for (const account of accounts ?? []) {
    if (Date.now() > deadline) break;
    stats.accounts += 1;
    try {
      const result = await syncMocoAccount(account as MocoAccountRow, deadline, false);
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

/**
 * Manual "Jetzt synchronisieren": syncs one user's account and PROPAGATES
 * account-level problems so the UI can show a real error instead of a
 * hollow "0 sent" success.
 */
export async function syncMocoAccountForUser(userId: string): Promise<MocoSyncResult | null> {
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("moco_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (!account) return null;
  return syncMocoAccount(account as MocoAccountRow, Date.now() + TIME_BUDGET_MS, true);
}

async function syncMocoAccount(
  account: MocoAccountRow,
  deadline: number,
  manual: boolean,
): Promise<MocoSyncResult> {
  const admin = createAdminClient();
  const counters = { sent: 0, failed: 0, insufficientFunds: 0 };
  const auth: MocoAuth = {
    subdomain: account.subdomain,
    apiKey: decryptSecret(account.api_key_enc),
  };

  let candidates: DocCandidate[];
  try {
    candidates = await collectCandidates(auth, account);
  } catch (err) {
    const kind = await recordAccountError(account.user_id, err);
    return { ...counters, accountError: kind };
  }

  // Filter already-claimed documents via targeted lookups (never a full-table
  // scan — PostgREST row caps would silently drop rows on busy accounts).
  const fresh = (await filterUnclaimed(admin, account, candidates)).slice(
    0,
    MAX_DOCS_PER_ACCOUNT_TICK,
  );

  // Claims from earlier ticks (crash, funds, transient errors) come first.
  const { data: pendingRows } = await admin
    .from("moco_documents")
    .select("id, doc_type, moco_id, identifier, letter_id, address_invoice_id, attempts, detail")
    .eq("user_id", account.user_id)
    .eq("subdomain", account.subdomain)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_DOCS_PER_ACCOUNT_TICK);

  const { data: profile } = await admin
    .from("profiles")
    .select("plan_id, status")
    .eq("id", account.user_id)
    .maybeSingle();
  if (!profile || profile.status !== "active") {
    return { ...counters, accountError: null };
  }

  const { data: sender } = await admin
    .from("sender_addresses")
    .select("id, label, company, first_name, last_name, street, zip, city, country, sender_line")
    .eq("user_id", account.user_id)
    .eq("is_default", true)
    .maybeSingle();
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

  let fundsBlocked = false;
  let stopAccount = false;

  const runDoc = async (claim: ClaimRow, candidate?: DocCandidate) => {
    const outcome = await processClaimedDoc(ctx, claim, candidate);
    if (outcome === "sent") counters.sent += 1;
    else if (outcome === "failed") counters.failed += 1;
    else if (outcome === "funds_first") {
      counters.insufficientFunds += 1;
      fundsBlocked = true;
    } else if (outcome === "funds_repeat") fundsBlocked = true;
  };

  // 1) Resume earlier claims.
  for (const row of pendingRows ?? []) {
    if (Date.now() > deadline || fundsBlocked || stopAccount) break;
    try {
      await runDoc(row as ClaimRow);
    } catch (err) {
      if (err instanceof MocoError && !err.transient) {
        await recordAccountError(account.user_id, err);
        stopAccount = true;
      }
      // Transient/unknown: claim stays pending, next tick retries.
    }
  }

  // 2) New documents: claim (insert = cross-instance dedup) then process.
  for (const doc of fresh) {
    if (Date.now() > deadline || fundsBlocked || stopAccount) break;
    const { data: claim } = await admin
      .from("moco_documents")
      .insert({
        user_id: account.user_id,
        subdomain: account.subdomain,
        doc_type: doc.docType,
        moco_id: doc.mocoId,
        identifier: doc.identifier,
        title: doc.title,
        doc_date: doc.date || null,
        address_invoice_id: doc.addressInvoiceId,
        status: "pending",
      })
      .select("id, doc_type, moco_id, identifier, letter_id, address_invoice_id, attempts, detail")
      .maybeSingle();
    if (!claim) continue; // unique violation → another instance claimed it
    try {
      await runDoc(claim as ClaimRow, doc);
    } catch (err) {
      if (err instanceof MocoError && !err.transient) {
        await recordAccountError(account.user_id, err);
        stopAccount = true;
      }
    }
  }

  if (!stopAccount) {
    await admin
      .from("moco_accounts")
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq("user_id", account.user_id);
  }

  // Digest only for outcomes that are FINAL this tick (sent/terminal-failed)
  // or newly funds-blocked — retries and repairs stay silent, so a flaky
  // MOCO afternoon can't spam action-critical mail every 10 minutes.
  if (!manual && counters.sent + counters.failed + counters.insufficientFunds > 0) {
    await enqueueJob("send_email", {
      template: "moco_summary",
      userId: account.user_id,
      sentCount: counters.sent,
      failedCount: counters.failed,
      heldFundsCount: counters.insufficientFunds,
    });
  }
  return { ...counters, accountError: null };
}

type DocContext = {
  admin: ReturnType<typeof createAdminClient>;
  auth: MocoAuth;
  account: MocoAccountRow;
  sender: Record<string, unknown> | null;
  pricing: { rows: Awaited<ReturnType<typeof loadPricingRows>>; discountPercent: number };
};

async function collectCandidates(
  auth: MocoAuth,
  account: MocoAccountRow,
): Promise<DocCandidate[]> {
  const out: DocCandidate[] = [];
  if (account.auto_send_invoices && account.invoices_activated_at) {
    const invoices = await listMocoInvoices(auth, {
      status: account.invoice_trigger_status,
      dateFrom: berlinDate(account.invoices_activated_at),
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
  if (account.auto_send_reminders && account.reminders_activated_at) {
    const reminders = await listMocoReminders(auth, {
      dateFrom: berlinDate(account.reminders_activated_at),
    });
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

/** Existence check per candidate id (chunked .in), scoped to the tenant. */
async function filterUnclaimed(
  admin: ReturnType<typeof createAdminClient>,
  account: MocoAccountRow,
  candidates: DocCandidate[],
): Promise<DocCandidate[]> {
  const seen = new Set<string>();
  for (const docType of ["invoice", "reminder"] as const) {
    const ids = candidates.filter((c) => c.docType === docType).map((c) => c.mocoId);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error } = await admin
        .from("moco_documents")
        .select("moco_id")
        .eq("user_id", account.user_id)
        .eq("subdomain", account.subdomain)
        .eq("doc_type", docType)
        .in("moco_id", chunk);
      if (error) throw new MocoError("dedup_check_failed", true);
      for (const row of data ?? []) seen.add(`${docType}:${row.moco_id}`);
    }
  }
  return candidates.filter((c) => !seen.has(`${c.docType}:${c.mocoId}`));
}

/**
 * Runs one claimed document. Account-level MocoErrors (auth) are THROWN so the
 * caller stops the account; everything document-specific resolves to an
 * outcome and is recorded on the claim row.
 */
async function processClaimedDoc(
  ctx: DocContext,
  claim: ClaimRow,
  candidate?: DocCandidate,
): Promise<DocOutcome> {
  const { admin, account } = ctx;

  // Optimistic lock: attempts is the compare-and-swap token. If another
  // instance (cron vs manual sync) already bumped it, we lost the race.
  const { data: locked } = await admin
    .from("moco_documents")
    .update({ attempts: claim.attempts + 1 })
    .eq("id", claim.id)
    .eq("status", "pending")
    .eq("attempts", claim.attempts)
    .select("id")
    .maybeSingle();
  if (!locked) return "lock_lost";

  const setClaim = async (patch: Record<string, unknown>) => {
    const { error } = await admin
      .from("moco_documents")
      .update(patch)
      .eq("id", claim.id)
      .eq("status", "pending");
    if (error) {
      console.error("moco_claim_update_failed", { error: error.message });
      return false;
    }
    return true;
  };

  const fail = async (detail: string): Promise<DocOutcome> => {
    await setClaim({ status: "failed", detail: detail.slice(0, 300) });
    return "failed";
  };
  /** Leaves the claim pending for the next tick, remembering why. */
  const retry = async (detail: string): Promise<DocOutcome> => {
    await setClaim({ detail: detail.slice(0, 300) });
    return "retry";
  };

  try {
    // 0) Repair path: if a send_job already exists for this claim's client
    //    token, the money moved in an earlier crashed tick — just reconcile.
    const { data: existingJob } = await admin
      .from("send_jobs")
      .select("id")
      .eq("user_id", account.user_id)
      .eq("client_token", claim.id)
      .maybeSingle();
    if (existingJob) {
      await setClaim({ status: "sent", send_job_id: existingJob.id, detail: null });
      return "repaired";
    }

    // Poisoned-document cap — never for funds blocks (those retry until
    // topped up) and never counted for lost races.
    if (claim.attempts + 1 > MAX_ATTEMPTS && claim.detail !== "insufficient_funds") {
      return await fail("too_many_attempts");
    }

    if (!ctx.sender) return await retry("no_sender_address");

    // 1) Letter: reuse the one from a crashed attempt, else build it now.
    let letterId = claim.letter_id;
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
      const built = await buildLetterForDoc(ctx, claim, candidate);
      if ("error" in built) {
        return built.terminal ? await fail(built.error) : await retry(built.error);
      }
      letterId = built.letterId;
      sheetCount = built.sheetCount;
      await setClaim({ letter_id: letterId });
    }

    // 2) Recipient from the (persisted) linked invoice's address block.
    const recipient = await resolveRecipient(ctx, claim, candidate);
    if ("error" in recipient) {
      return recipient.terminal ? await fail(recipient.error) : await retry(recipient.error);
    }

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
      p_client_token: claim.id,
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
        const first = claim.detail !== "insufficient_funds";
        await setClaim({ detail: "insufficient_funds" });
        return first ? "funds_first" : "funds_repeat";
      }
      // DB/network blips are retryable — the claim token keeps a hidden
      // commit from ever double-charging (repair path catches it next tick).
      return await retry("send_error");
    }

    await setClaim({ status: "sent", send_job_id: jobId as string, detail: null });
    return "sent";
  } catch (err) {
    if (err instanceof MocoError) {
      if (!err.transient) throw err; // account-level (auth) — caller stops the account
      return await retry(err.message);
    }
    return await retry(err instanceof Error ? err.message.slice(0, 200) : "unknown_error");
  }
}

async function buildLetterForDoc(
  ctx: DocContext,
  claim: ClaimRow,
  candidate?: DocCandidate,
): Promise<{ letterId: string; sheetCount: number } | { error: string; terminal: boolean }> {
  const { admin, auth, account } = ctx;

  let pdf: Uint8Array;
  if (claim.doc_type === "invoice") {
    pdf = await getMocoInvoicePdf(auth, claim.moco_id);
  } else {
    let fileUrl = candidate?.reminderFileUrl ?? null;
    if (!fileUrl) {
      // Resumed claim: re-list around the reminder to recover its file_url.
      const reminders = await listMocoReminders(auth, { dateFrom: "1970-01-01" });
      fileUrl = reminders.find((r) => r.id === claim.moco_id)?.file_url ?? null;
    }
    if (!fileUrl) return { error: "reminder_pdf_unavailable", terminal: true };
    pdf = await getMocoReminderPdf(auth, fileUrl);
  }

  const { bytes, adjusted } = await normalizePdfToA4(pdf);
  const validation = await validateLetterPdf(bytes, { a4Normalized: adjusted });
  if (!isSubmittable(validation)) {
    const firstError = validation.rules.find((r) => r.severity === "error");
    return { error: `pdf_invalid: ${firstError?.message ?? "?"}`, terminal: true };
  }

  const letterId = randomUUID();
  const storagePath = `${account.user_id}/letters/${letterId}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(BUCKETS.letters)
    .upload(storagePath, bytes as unknown as Blob, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (uploadError) return { error: "storage_failed", terminal: false };

  const coverSheets = validation.needsCoverLetter ? 1 : 0;
  const sheetCount = (validation.sheetCountSimplex ?? 0) + coverSheets;
  const label = claim.doc_type === "invoice" ? "Rechnung" : "Mahnung";
  const { error: insertError } = await admin.from("letters").insert({
    id: letterId,
    user_id: account.user_id,
    title: `MOCO ${label} ${claim.identifier || claim.moco_id}`.slice(0, 200),
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
    return { error: "letter_insert_failed", terminal: false };
  }
  return { letterId, sheetCount };
}

async function resolveRecipient(
  ctx: DocContext,
  claim: ClaimRow,
  candidate?: DocCandidate,
): Promise<{ snapshot: Record<string, unknown> } | { error: string; terminal: boolean }> {
  const { auth } = ctx;

  let rawAddress = candidate?.recipientAddress ?? null;
  if (!rawAddress) {
    // address_invoice_id is persisted at claim time, so resumed claims (both
    // types) can always re-resolve the address.
    const invoiceId =
      claim.address_invoice_id ?? (claim.doc_type === "invoice" ? claim.moco_id : null);
    if (!invoiceId) return { error: "address_unavailable", terminal: true };
    const invoice = await getMocoInvoice(auth, invoiceId);
    rawAddress = invoice.recipient_address || null;
  }
  if (!rawAddress) return { error: "address_unavailable", terminal: true };

  const parsed = parseMocoRecipientAddress(rawAddress);
  if (!parsed.ok) return { error: `address_parse_failed: ${parsed.reason}`, terminal: true };

  const check = contactSchema.safeParse({
    company: parsed.recipient.company,
    addressExtra: parsed.recipient.addressExtra ?? undefined,
    street: parsed.recipient.street,
    zip: parsed.recipient.zip,
    city: parsed.recipient.city,
    country: parsed.recipient.country,
  });
  if (!check.success) {
    return {
      error: `address_invalid: ${check.error.issues[0]?.message ?? "?"}`,
      terminal: true,
    };
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

/** Records the failure; only auth problems flip the account out of rotation. */
async function recordAccountError(userId: string, err: unknown): Promise<"auth" | "transient"> {
  const admin = createAdminClient();
  const isAuth = err instanceof MocoError && !err.transient;
  const patch: Record<string, unknown> = {
    last_error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    last_sync_at: new Date().toISOString(),
  };
  // Transient errors must NOT resurrect a status='error' account into the
  // cron rotation — status changes only on auth failures (or reconnect).
  if (isAuth) patch.status = "error";
  await admin.from("moco_accounts").update(patch).eq("user_id", userId);
  return isAuth ? "auth" : "transient";
}
