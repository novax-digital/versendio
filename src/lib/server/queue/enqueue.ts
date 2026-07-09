import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type QueueJobType =
  | "submit_item"
  | "sync_status"
  | "send_email"
  | "cleanup_storage"
  | "auto_topup"
  | "release_queued";

/** Inserts a queue job (service-role only table, ADR-0004). */
export async function enqueueJob(
  type: QueueJobType,
  payload: Record<string, unknown>,
  runAt?: Date,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("job_queue").insert({
    type,
    payload,
    run_at: (runAt ?? new Date()).toISOString(),
  });
  if (error) {
    console.error("enqueue_failed", { type, error: error.message });
  }
}
