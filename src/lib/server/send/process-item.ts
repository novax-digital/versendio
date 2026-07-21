import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLetterProvider } from "@/lib/server/providers";
import { ProviderError, type SubmitLetterInput } from "@/lib/server/providers/types";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { prependCoverLetter } from "@/lib/server/pdf/cover-letter";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { isSubmittable } from "@/lib/shared/validation-result";
import { parseLetterDocument } from "@/lib/shared/letter-document";
import {
  buildRecipientAddressLines,
  buildProviderAddressLines,
  toPlaceholderContext,
  type RecipientAddress,
} from "@/lib/shared/address";
import { calculateLetterPrice, type PricingRow } from "@/lib/shared/pricing";
import { sheetsFromPages } from "@/lib/shared/sheets";
import { BUCKETS } from "@/lib/server/storage";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { maybeCompleteJob } from "./complete-job";

const SUBMIT_WINDOW_MS = 55 * 60 * 1000; // stay inside the 60-min duplicate failsafe

export type ProcessResult =
  | { outcome: "submitted" }
  | { outcome: "skipped"; reason: string }
  | { outcome: "on_hold_funds" }
  | { outcome: "failed_permanent"; reason: string }
  | { outcome: "retry"; reason: string };

type PricingSnapshot = {
  discountPercent: number;
  rows: PricingRow[];
  sheets: number;
};

/**
 * Processes one submit_item queue job (ADR-0004 §5, ADR-0006 §4):
 * status guard → crash reconciliation → personalize+validate → render-diff
 * booking → provider submission with duplicate failsafe.
 */
export async function processSubmitItem(itemId: string): Promise<ProcessResult> {
  const admin = createAdminClient();
  const provider = getLetterProvider();

  const { data: item } = await admin
    .from("send_job_items")
    .select(
      "id, job_id, user_id, status, recipient_snapshot, sheet_count, vk_cents, ek_cents, pricing_snapshot, provider_letter_id, first_submit_attempt_at, attempts",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { outcome: "skipped", reason: "item_not_found" };

  // Status guard: only pending/on_hold_funds/submitting are processable.
  if (!["pending", "on_hold_funds", "submitting"].includes(item.status)) {
    return { outcome: "skipped", reason: `status_${item.status}` };
  }

  const { data: job } = await admin
    .from("send_jobs")
    .select(
      "id, user_id, letter_id, sender_snapshot, is_color, is_duplex, registered, is_test, provider_batch_id, status",
    )
    .eq("id", item.job_id)
    .single();
  if (!job) return { outcome: "skipped", reason: "job_not_found" };
  if (job.status === "canceled") return { outcome: "skipped", reason: "job_canceled" };

  // Crash recovery: a previous attempt may have POSTed without recording the
  // letterID. NEVER blindly resubmit — reconcile via custom1 lookup first.
  if (item.status === "submitting") {
    const existing = await provider.findByItemId(item.id).catch(() => null);
    if (existing) {
      await recordSubmitted(item.id, existing.providerLetterId);
      return { outcome: "submitted" };
    }
    const firstAttempt = item.first_submit_attempt_at
      ? Date.parse(item.first_submit_attempt_at)
      : Date.now();
    if (Date.now() - firstAttempt > SUBMIT_WINDOW_MS) {
      // Outside the failsafe window and not found at the provider: give up
      // safely rather than risk a double print.
      await failItem(item.id, item.user_id, job.is_test, item.vk_cents, "submit_window_expired",
        "Einlieferung konnte nicht bestätigt werden (Sicherheitsfenster abgelaufen)");
      return { outcome: "failed_permanent", reason: "submit_window_expired" };
    }
    // Inside the window: safe to submit again (duplicate failsafe covers us).
  }

  // Claim the item with a compare-and-set BEFORE any slow work: a concurrent
  // cancel only touches pending/on_hold_funds, so once we hold `submitting`
  // the cancel path skips this item — and vice versa, a cancel that won the
  // race makes this claim match zero rows and we abort (no send after refund).
  const { data: claimed } = await admin
    .from("send_job_items")
    .update({
      status: "submitting",
      first_submit_attempt_at: item.first_submit_attempt_at ?? new Date().toISOString(),
      attempts: item.attempts + 1,
    })
    .eq("id", item.id)
    .in("status", ["pending", "on_hold_funds", "submitting"])
    .select("id")
    .maybeSingle();
  if (!claimed) {
    return { outcome: "skipped", reason: "claim_lost" };
  }

  // First item entering submission flips the job queued → processing so the UI
  // stops claiming "In Warteschlange" while letters already move through the
  // provider. Guarded on `queued`: a no-op for every later item and never
  // resurrects a canceled/completed job. (Completion is maybeCompleteJob's.)
  await admin
    .from("send_jobs")
    .update({ status: "processing" })
    .eq("id", item.job_id)
    .eq("status", "queued");

  const recipient = item.recipient_snapshot as unknown as RecipientAddress;
  const addressLines = buildRecipientAddressLines(recipient);
  const senderSnapshot = job.sender_snapshot as { sender_line?: string; city?: string } | null;
  const senderLine = senderSnapshot?.sender_line ?? "";
  const senderCity = senderSnapshot?.city ?? null;

  // --- personalize + validate (same path as uploads, ADR-0006) --------------
  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await buildItemPdf(job.letter_id, recipient, senderLine, senderCity, addressLines);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "render_failed";
    await failItem(item.id, item.user_id, job.is_test, item.vk_cents, "render_failed", reason);
    return { outcome: "failed_permanent", reason };
  }

  const validation = await validateLetterPdf(pdfBytes);
  if (!isSubmittable(validation)) {
    const firstError = validation.rules.find((r) => r.severity === "error");
    await failItem(item.id, item.user_id, job.is_test, item.vk_cents, "validation_failed",
      firstError?.message ?? "PDF-Validierung fehlgeschlagen");
    return { outcome: "failed_permanent", reason: "validation_failed" };
  }

  // --- render-diff booking (ADR-0006 §4) -------------------------------------
  const actualSheets = sheetsFromPages(validation.pageCount ?? 0, job.is_duplex);
  let vkCents = item.vk_cents;
  let ekCents = item.ek_cents;

  if (!job.is_test && actualSheets !== item.sheet_count) {
    const snapshot = item.pricing_snapshot as unknown as PricingSnapshot;
    const actual = calculateLetterPrice(snapshot.rows, {
      sheets: actualSheets,
      isColor: job.is_color,
      isDuplex: job.is_duplex,
      registered: job.registered,
      discountPercent: snapshot.discountPercent,
    });
    const diff = actual.vkCents - item.vk_cents; // >0 debit, <0 refund

    if (diff !== 0) {
      const { error: bookError } = await admin.rpc("book_credit", {
        p_user_id: item.user_id,
        p_type: diff > 0 ? "spend" : "refund",
        p_amount_cents: -diff, // spend = negative amount
        p_reference_type: "item_render_adjust",
        p_reference_id: item.id,
        p_comment: `Blattzahl-Anpassung ${item.sheet_count} → ${actualSheets}`,
        p_created_by: "system",
      });
      if (bookError) {
        if (bookError.message.includes("insufficient_funds")) {
          // Never send unpaid letters: park the item. sheet_count deliberately
          // keeps the ESTIMATE so re-entry recomputes the diff and re-attempts
          // the debit (persisting actualSheets here would skip the adjust and
          // mail the letter under-charged).
          await admin
            .from("send_job_items")
            .update({ status: "on_hold_funds" })
            .eq("id", item.id);
          // Notify only on the FIRST transition into on_hold_funds — the daily
          // maintenance re-enqueue would otherwise re-mail every day.
          if (item.status !== "on_hold_funds") {
            await addEvent(item.id, "on_hold_funds", null, "Guthaben reicht für die Blattzahl-Anpassung nicht aus", "system");
            await enqueueJob("send_email", {
              template: "items_on_hold",
              userId: item.user_id,
              jobId: item.job_id,
            });
          }
          return { outcome: "on_hold_funds" };
        }
        // Unique violation = adjust already booked by a previous attempt: continue.
        if (!bookError.message.includes("duplicate key")) {
          return { outcome: "retry", reason: `render_adjust_failed: ${bookError.message}` };
        }
      }
      vkCents = actual.vkCents;
      ekCents = actual.ekCents;
      await admin
        .from("send_job_items")
        .update({ vk_cents: vkCents, ek_cents: ekCents, sheet_count: actualSheets })
        .eq("id", item.id);
    } else {
      await admin.from("send_job_items").update({ sheet_count: actualSheets }).eq("id", item.id);
    }
  }

  // --- store the final PDF ----------------------------------------------------
  const pdfPath = `${item.user_id}/jobs/${item.job_id}/${item.id}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(BUCKETS.letters)
    .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    return { outcome: "retry", reason: `pdf_store_failed: ${uploadError.message}` };
  }

  // --- submit ------------------------------------------------------------------
  const { data: profile } = await admin
    .from("profiles")
    .select("cost_center")
    .eq("id", item.user_id)
    .single();

  await admin
    .from("send_job_items")
    .update({ rendered_pdf_path: pdfPath })
    .eq("id", item.id);

  // Last cancel check before the irreversible provider POST. The cancel RPC
  // skips items in `submitting`, so if the job is canceled here we must
  // finalize this item ourselves (cancel + idempotent refund).
  const { data: freshJob } = await admin
    .from("send_jobs")
    .select("status")
    .eq("id", item.job_id)
    .single();
  if (freshJob?.status === "canceled") {
    await admin.from("send_job_items").update({ status: "canceled" }).eq("id", item.id);
    if (!job.is_test && vkCents > 0) {
      const { error } = await admin.rpc("book_credit", {
        p_user_id: item.user_id,
        p_type: "refund",
        p_amount_cents: vkCents,
        p_reference_type: "item_canceled",
        p_reference_id: item.id,
        p_comment: "Storno vor Einlieferung",
        p_created_by: "system",
      });
      if (error && !error.message.includes("duplicate key")) {
        console.error("cancel_refund_failed", { itemId: item.id, error: error.message });
      }
    }
    return { outcome: "skipped", reason: "job_canceled" };
  }

  const submitInput: SubmitLetterInput = {
    itemId: item.id,
    fileName: `epm${item.id.replaceAll("-", "")}.pdf`,
    pdfBytes,
    isColor: job.is_color,
    isDuplex: job.is_duplex,
    registered: job.registered,
    // Provider lines exclude zip/city/country — those go in the discrete
    // fields below; repeating them would print the locality twice.
    addressLines: buildProviderAddressLines(recipient),
    zipCode: recipient.zip,
    city: recipient.city,
    country: recipient.country ?? "DE",
    senderLine,
    providerBatchId: job.provider_batch_id,
    costCenter: profile?.cost_center ?? "",
    isTest: job.is_test,
  };

  try {
    const result = await provider.submitLetter(submitInput);
    await recordSubmitted(item.id, result.providerLetterId);
    return { outcome: "submitted" };
  } catch (err) {
    if (err instanceof ProviderError && err.options.duplicate) {
      // E324: the previous attempt made it — reconcile instead of failing.
      const existing = await provider.findByItemId(item.id).catch(() => null);
      if (existing) {
        await recordSubmitted(item.id, existing.providerLetterId);
        return { outcome: "submitted" };
      }
      return { outcome: "retry", reason: "duplicate_without_lookup" };
    }
    if (err instanceof ProviderError && !err.options.retryable) {
      await failItem(item.id, item.user_id, job.is_test, vkCents,
        err.options.providerCode ?? "provider_error", err.message);
      return { outcome: "failed_permanent", reason: err.message };
    }
    const reason = err instanceof Error ? err.message : "unknown";
    return { outcome: "retry", reason };
  }
}

/**
 * Renders the exact letter sent to one recipient: the letter template resolved
 * against the frozen recipient/sender snapshots. Same path used at submit time,
 * reused by the Sendungen PDF download to reproduce a sent letter on demand.
 */
export async function buildItemPdf(
  letterId: string | null,
  recipient: RecipientAddress,
  senderLine: string,
  senderCity: string | null,
  addressLines: string[],
): Promise<Uint8Array> {
  const admin = createAdminClient();
  if (!letterId) throw new Error("letter_missing");

  const { data: letter } = await admin
    .from("letters")
    .select("user_id, source, storage_path, editor_document, use_cover_letter")
    .eq("id", letterId)
    .single();
  if (!letter) throw new Error("letter_missing");

  if (letter.source === "editor") {
    const doc = parseLetterDocument(letter.editor_document);
    return renderEditorLetter({
      document: doc,
      senderLine,
      senderCity,
      recipient: {
        addressLines,
        placeholders: toPlaceholderContext(recipient),
      },
      loadImage: async (path) => {
        // Ownership boundary: the service-role client bypasses RLS, so the
        // document must never reference another tenant's asset objects.
        if (!path.startsWith(`${letter.user_id}/`)) return null;
        const { data } = await admin.storage.from(BUCKETS.assets).download(path);
        if (!data) return null;
        return {
          bytes: new Uint8Array(await data.arrayBuffer()),
          mime: path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
        };
      },
    });
  }

  if (!letter.storage_path) throw new Error("letter_pdf_missing");
  const { data: file } = await admin.storage.from(BUCKETS.letters).download(letter.storage_path);
  if (!file) throw new Error("letter_pdf_missing");
  const original = new Uint8Array(await file.arrayBuffer());

  return letter.use_cover_letter
    ? prependCoverLetter(original, senderLine, addressLines)
    : original;
}

async function recordSubmitted(itemId: string, providerLetterId: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("send_job_items")
    .update({
      status: "submitted",
      provider_letter_id: providerLetterId,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  await addEvent(itemId, "submitted", null, "Sendung eingeliefert", "system");
}

/**
 * Terminal resolution for a submit job that exhausted its retries (dead):
 * one final provider reconciliation, then a safe fail+refund. Never resubmits.
 */
export async function resolveDeadSubmit(itemId: string): Promise<void> {
  const admin = createAdminClient();
  const provider = getLetterProvider();

  const { data: item } = await admin
    .from("send_job_items")
    .select("id, job_id, user_id, status, vk_cents")
    .eq("id", itemId)
    .maybeSingle();
  if (!item || !["pending", "on_hold_funds", "submitting"].includes(item.status)) return;

  const existing = await provider.findByItemId(itemId).catch(() => null);
  if (existing) {
    await recordSubmitted(itemId, existing.providerLetterId);
    return;
  }

  const { data: job } = await admin
    .from("send_jobs")
    .select("is_test")
    .eq("id", item.job_id)
    .single();
  await failItem(
    itemId,
    item.user_id,
    job?.is_test ?? false,
    item.vk_cents,
    "submit_exhausted",
    "Einlieferung nach mehreren Versuchen nicht möglich — Betrag wurde erstattet",
  );
  await maybeCompleteJob(item.job_id);
}

async function failItem(
  itemId: string,
  userId: string,
  isTest: boolean,
  refundCents: number,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("send_job_items")
    .update({ status: "failed", error_code: errorCode, error_message: errorMessage })
    .eq("id", itemId);
  await addEvent(itemId, "failed", 99, errorMessage, "system");

  if (!isTest && refundCents > 0) {
    const { error } = await admin.rpc("book_credit", {
      p_user_id: userId,
      p_type: "refund",
      p_amount_cents: refundCents,
      p_reference_type: "item_failed",
      p_reference_id: itemId,
      p_comment: `Erstattung: ${errorCode}`,
      p_created_by: "system",
    });
    if (error && !error.message.includes("duplicate key")) {
      console.error("item_refund_failed", { itemId, error: error.message });
    } else if (!error) {
      await admin
        .from("send_job_items")
        .update({ refunded_at: new Date().toISOString() })
        .eq("id", itemId);
    }
  }

  // Submit-time failures never pass through the polling path — complete the
  // job here so all-failed jobs don't stay "queued" forever.
  const { data: failedItem } = await admin
    .from("send_job_items")
    .select("job_id")
    .eq("id", itemId)
    .single();
  if (failedItem) await maybeCompleteJob(failedItem.job_id);
}

export async function addEvent(
  itemId: string,
  status: string | null,
  providerStatusId: number | null,
  details: string,
  source: "provider" | "system",
  eventType: "status_change" | "bze_tracking" | "system_note" = "status_change",
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("status_events").insert({
    item_id: itemId,
    event_type: eventType,
    status,
    provider_status_id: providerStatusId,
    details,
    source,
  });
  if (error) console.error("status_event_failed", { error: error.message });
}
