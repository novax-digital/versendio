import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLetterProvider } from "@/lib/server/providers";
import type { ProviderStatusInfo } from "@/lib/server/providers/types";
import { getNumberSetting } from "@/lib/server/settings";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { addEvent } from "./process-item";
import { maybeCompleteJob } from "./complete-job";

/**
 * Throttled status polling (ADR-0004 §3): one bulk `listOpenLetters` call per
 * run, plus bounded individual lookups for items that dropped out of the open
 * list (they may have jumped to final 4/99). The E-Post API monitors query
 * frequency — never poll per item unboundedly.
 */
export async function syncStatuses(): Promise<{ updated: number; finalized: number }> {
  const admin = createAdminClient();
  const provider = getLetterProvider();
  const maxIndividual = await getNumberSetting("status_sync_max_queries_per_run", 50);

  let updated = 0;
  let finalized = 0;

  // 1) Bulk: all open letters in one call.
  const openInfos = await provider.listOpenLetters().catch((err) => {
    console.error("status_sync_bulk_failed", { error: err instanceof Error ? err.message : "?" });
    return [] as ProviderStatusInfo[];
  });
  const byItemId = new Map<string, ProviderStatusInfo>();
  for (const info of openInfos) {
    if (info.custom1) byItemId.set(info.custom1, info);
  }

  // 2) Our non-final items, oldest sync first.
  const { data: items } = await admin
    .from("send_job_items")
    .select(
      "id, job_id, user_id, status, provider_status_id, provider_letter_id, vk_cents, refunded_at, send_jobs!inner(is_test)",
    )
    .in("status", ["submitted", "accepted", "checked", "print_center"])
    .order("last_status_sync_at", { ascending: true, nullsFirst: true })
    .limit(500);

  let individualBudget = maxIndividual;
  const touchedJobs = new Set<string>();
  // job_id → transition counts of this run, for the per-job digest mail.
  const digestByJob = new Map<string, { userId: string; counts: Record<string, number> }>();

  // Every polled item is already past submission, so its job must not still
  // claim "queued". Normally process-item flips this at submit time; this
  // guarded catch-up covers jobs submitted before that transition existed.
  const activeJobIds = [...new Set((items ?? []).map((i) => i.job_id))];
  if (activeJobIds.length > 0) {
    await admin
      .from("send_jobs")
      .update({ status: "processing" })
      .in("id", activeJobIds)
      .eq("status", "queued");
  }

  for (const item of items ?? []) {
    if (!item.provider_letter_id) continue;
    // Test items are final at "checked" — stop polling them.
    const isTest = (item.send_jobs as unknown as { is_test: boolean } | null)?.is_test ?? false;
    if (isTest && item.status === "checked") continue;

    let info = byItemId.get(item.id) ?? null;
    if (!info) {
      // Not in the open list: either final now, or the bulk call failed.
      if (individualBudget <= 0) continue;
      individualBudget--;
      info = await provider.getStatus(item.provider_letter_id).catch(() => null);
    }
    if (!info) {
      await admin
        .from("send_job_items")
        .update({ last_status_sync_at: new Date().toISOString() })
        .eq("id", item.id);
      continue;
    }

    const applied = await applyStatus(item, info);
    if (applied.changed) {
      updated++;
      // Aggregate per job for the status-digest mail (one mail per job per
      // run, never per item). Test jobs are excluded: their statuses are
      // clamped and the completion mail already fires at "checked".
      if (!isTest) {
        const digest = digestByJob.get(item.job_id) ?? {
          userId: item.user_id,
          counts: {} as Record<string, number>,
        };
        digest.counts[applied.newStatus] = (digest.counts[applied.newStatus] ?? 0) + 1;
        digestByJob.set(item.job_id, digest);
      }
    }
    if (applied.final) {
      finalized++;
      touchedJobs.add(item.job_id);
    }
  }

  // 3) Complete jobs whose items are all final.
  for (const jobId of touchedJobs) {
    await maybeCompleteJob(jobId);
  }

  // 4) Status-digest mails for jobs that are still in flight. Jobs completed
  // above already notify via job_completed(_with_errors) — mailing both would
  // duplicate. Enqueued after all DB writes persisted (at-most-once: a crash
  // earlier re-runs with changed=false and never re-mails).
  const digestJobIds = [...digestByJob.keys()];
  if (digestJobIds.length > 0) {
    const { data: jobRows } = await admin
      .from("send_jobs")
      .select("id, status")
      .in("id", digestJobIds);
    const inFlight = new Set(
      (jobRows ?? [])
        .filter((j) => j.status === "queued" || j.status === "processing")
        .map((j) => j.id),
    );
    for (const [jobId, digest] of digestByJob) {
      if (!inFlight.has(jobId)) continue;
      await enqueueJob("send_email", {
        template: "job_status_update",
        userId: digest.userId,
        jobId,
        statusCounts: digest.counts,
      }).catch(() => {});
    }
  }

  return { updated, finalized };
}

type SyncItem = {
  id: string;
  job_id: string;
  user_id: string;
  status: string;
  provider_status_id: number | null;
  vk_cents: number;
  refunded_at: string | null;
};

async function applyStatus(
  item: SyncItem,
  info: ProviderStatusInfo,
): Promise<{ changed: boolean; final: boolean; newStatus: string }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Is the parent job a test run? Tests are final at status 2 (checked).
  const { data: job } = await admin
    .from("send_jobs")
    .select("is_test")
    .eq("id", item.job_id)
    .single();
  const isTest = job?.is_test ?? false;

  const changed = info.providerStatusId !== item.provider_status_id;
  const isFinal = info.status === "sent" || info.status === "failed" || (isTest && info.providerStatusId >= 2);
  // Test runs stop at "checked" (no print) — clamp so the UI never shows a
  // test letter as physically sent and polling stops.
  const persistedStatus =
    isTest && info.status !== "failed" && info.providerStatusId >= 2 ? "checked" : info.status;

  // Compare-and-set on the PREVIOUS provider_status_id: the transition's side
  // effects (timeline events, digest count, refund) may only run when THIS
  // call actually persisted the change. A transient write failure re-runs next
  // tick with the old value; a concurrent run loses the CAS and stays silent —
  // either way the digest mail fires at most once per real transition.
  let write = admin
    .from("send_job_items")
    .update({
      status: persistedStatus,
      provider_status_id: info.providerStatusId,
      frankier_id: info.frankierId,
      error_code: info.status === "failed" ? (info.errorCode ?? "E99") : null,
      error_message: info.status === "failed" ? info.errorMessage : null,
      last_status_sync_at: now,
    })
    .eq("id", item.id);
  write =
    item.provider_status_id === null
      ? write.is("provider_status_id", null)
      : write.eq("provider_status_id", item.provider_status_id);
  const { data: updatedRows, error: writeErr } = await write.select("id");
  if (writeErr || (updatedRows?.length ?? 0) === 0) {
    if (writeErr) {
      console.error("status_sync_write_failed", { itemId: item.id, error: writeErr.message });
    }
    return { changed: false, final: false, newStatus: persistedStatus };
  }

  if (changed) {
    await addEvent(item.id, info.status, info.providerStatusId, info.details ?? "", "provider");
    if (info.destinationAreaStatus) {
      await addEvent(
        item.id,
        null,
        null,
        `${info.destinationAreaStatus}${info.destinationAreaStatusDate ? ` (${info.destinationAreaStatusDate})` : ""}`,
        "provider",
        "bze_tracking",
      );
    }
    if (info.registeredStatus) {
      await addEvent(item.id, null, null, `Einschreiben: ${info.registeredStatus}`, "provider", "system_note");
    }
  }

  // Final failure → automatic refund (idempotent via reference index).
  if (info.status === "failed" && !isTest && !item.refunded_at && item.vk_cents > 0) {
    const { error } = await admin.rpc("book_credit", {
      p_user_id: item.user_id,
      p_type: "refund",
      p_amount_cents: item.vk_cents,
      p_reference_type: "item_failed",
      p_reference_id: item.id,
      p_comment: `Erstattung: Sendung fehlgeschlagen (${info.errorCode ?? "99"})`,
      p_created_by: "system",
    });
    if (!error) {
      await admin.from("send_job_items").update({ refunded_at: now }).eq("id", item.id);
    } else if (!error.message.includes("duplicate key")) {
      console.error("sync_refund_failed", { itemId: item.id, error: error.message });
    }
  }

  return { changed, final: isFinal, newStatus: persistedStatus };
}
