import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Writes an audit log entry (append-only table, service-role only).
 * `details` must never contain letter contents or postal addresses.
 */
export async function writeAuditLog(entry: {
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_user_id: entry.actorUserId,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    details: entry.details ?? null,
  });
  if (error) {
    console.error("audit_log_write_failed", { action: entry.action, error: error.message });
  }
}
