import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { getNumberSetting } from "@/lib/server/settings";
import { processSubmitItem } from "@/lib/server/send/process-item";
import { processSendEmail, type SendEmailPayload } from "@/lib/server/send/job-emails";

export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;
// Submit retries stay short so all attempts land inside the 60-min duplicate
// failsafe window (ADR-0004 §5); other job types back off wider. With
// max_attempts=5 (DB default) attempts 1-4 consume these delays, the 5th dies.
const SUBMIT_BACKOFF_MIN = [1, 5, 15];
const DEFAULT_BACKOFF_MIN = [1, 5, 25, 60];

type QueueJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

/**
 * Queue worker (ADR-0004): claims small batches via FOR UPDATE SKIP LOCKED,
 * processes within a time budget, retries with backoff. Runs every minute.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const started = Date.now();

  // Recover jobs whose lock expired (crashed invocation).
  await admin.rpc("reset_stuck_jobs", { p_timeout_minutes: 10 });

  const batchSize = await getNumberSetting("queue_batch_size", 10);
  const { data: jobs, error } = await admin.rpc("claim_jobs", {
    p_types: ["submit_item", "send_email", "cleanup_storage", "auto_topup"],
    p_limit: batchSize,
    p_worker_id: workerId,
  });
  if (error) {
    console.error("claim_jobs_failed", { error: error.message });
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  let done = 0;
  let failed = 0;
  let requeued = 0;

  for (const job of (jobs ?? []) as QueueJob[]) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      // Out of budget: release unprocessed job back to pending (attempt not consumed).
      await admin
        .from("job_queue")
        .update({ status: "pending", locked_at: null, locked_by: null, attempts: job.attempts - 1 })
        .eq("id", job.id);
      requeued++;
      continue;
    }

    try {
      const outcome = await processJob(job);
      if (outcome === "retry") {
        await scheduleRetry(job, "retry_requested");
        requeued++;
      } else {
        await admin.from("job_queue").update({ status: "done" }).eq("id", job.id);
        done++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      await scheduleRetry(job, message);
      failed++;
    }
  }

  return NextResponse.json({ claimed: jobs?.length ?? 0, done, failed, requeued });
}

async function processJob(job: QueueJob): Promise<"done" | "retry"> {
  switch (job.type) {
    case "submit_item": {
      const itemId = String(job.payload.itemId ?? "");
      if (!itemId) return "done";
      const result = await processSubmitItem(itemId);
      // retry → backoff; every other outcome is handled domain-side already.
      return result.outcome === "retry" ? "retry" : "done";
    }
    case "send_email": {
      await processSendEmail(job.payload as unknown as SendEmailPayload);
      return "done";
    }
    case "cleanup_storage": {
      const path = String(job.payload.path ?? "");
      const bucket = String(job.payload.bucket ?? "");
      if (path && bucket) {
        const admin = createAdminClient();
        await admin.storage.from(bucket).remove([path]);
      }
      return "done";
    }
    case "auto_topup": {
      const userId = String(job.payload.userId ?? "");
      if (userId) {
        const { processAutoTopup } = await import("@/lib/server/billing/auto-topup");
        await processAutoTopup(userId);
      }
      return "done";
    }
    default:
      console.error("unknown_queue_job_type", { type: job.type });
      return "done";
  }
}

async function scheduleRetry(job: QueueJob, reason: string): Promise<void> {
  const admin = createAdminClient();
  const schedule = job.type === "submit_item" ? SUBMIT_BACKOFF_MIN : DEFAULT_BACKOFF_MIN;
  const attempt = job.attempts; // already incremented by claim_jobs
  const maxAttempts = job.type === "submit_item" ? schedule.length + 1 : job.max_attempts;

  if (attempt >= maxAttempts) {
    await admin
      .from("job_queue")
      .update({ status: "dead", last_error: reason })
      .eq("id", job.id);
    // A dead submit job must not strand its item with money debited: resolve
    // terminally — one provider reconciliation, then fail+refund (idempotent).
    if (job.type === "submit_item") {
      const itemId = String(job.payload.itemId ?? "");
      if (itemId) {
        const { resolveDeadSubmit } = await import("@/lib/server/send/process-item");
        await resolveDeadSubmit(itemId).catch((err) => {
          console.error("dead_submit_resolution_failed", {
            itemId,
            error: err instanceof Error ? err.message : "?",
          });
        });
      }
    }
    return;
  }

  const delayMin = schedule[Math.min(attempt - 1, schedule.length - 1)];
  const jitterMs = Math.floor(Math.random() * 30_000);
  const runAt = new Date(Date.now() + delayMin * 60_000 + jitterMs).toISOString();
  await admin
    .from("job_queue")
    .update({ status: "pending", run_at: runAt, locked_at: null, locked_by: null, last_error: reason })
    .eq("id", job.id);
}
