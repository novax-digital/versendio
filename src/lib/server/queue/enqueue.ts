import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type QueueJobType =
  | "submit_item"
  | "sync_status"
  | "send_email"
  | "cleanup_storage"
  | "auto_topup"
  | "release_queued";

/**
 * Inserts a queue job (service-role only table, ADR-0004).
 *
 * `submit_item` carries a partial unique index on the item id for live jobs:
 * several call sites (top-up webhook, admin credit booking, maintenance sweep)
 * may try to release the same held item, and a duplicate row could be claimed
 * by a second concurrent worker. A unique violation therefore means "already
 * queued" and is a no-op, not an error.
 */
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
    if (error.code === "23505") return; // already queued
    console.error("enqueue_failed", { type, error: error.message });
  }
}
