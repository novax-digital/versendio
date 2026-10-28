import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fraud response shared by the admin review ("Stoppen + Konto sperren") and
 * the Stripe fraud webhooks: block the account, switch off auto top-up (no
 * further charges on a possibly stolen card) and cancel+refund every job
 * that still has unsubmitted items. Idempotent. Already-submitted letters
 * are beyond reach (the E-Post API has no recall). Returns the number of
 * jobs that had items canceled.
 */
export async function blockAccountAndStopSends(userId: string, actor: string): Promise<number> {
  const admin = createAdminClient();

  const { error: blockError } = await admin
    .from("profiles")
    .update({ status: "blocked" })
    .eq("id", userId)
    .eq("status", "active");
  if (blockError) throw new Error(`block_failed: ${blockError.message}`);

  const { error: topupError } = await admin
    .from("billing_accounts")
    .update({ auto_topup_enabled: false })
    .eq("user_id", userId);
  if (topupError) console.error("block_auto_topup_off_failed", { error: topupError.message });

  const { data: open } = await admin
    .from("send_job_items")
    .select("job_id")
    .eq("user_id", userId)
    .in("status", ["pending", "on_hold_funds"])
    .limit(5000);
  const jobIds = [...new Set((open ?? []).map((r) => r.job_id as string))];

  let stopped = 0;
  for (const jobId of jobIds) {
    const { error } = await admin.rpc("cancel_pending_job_items", {
      p_job_id: jobId,
      p_actor: actor,
    });
    if (error) {
      console.error("block_cancel_job_failed", { jobId, error: error.message });
    } else {
      stopped++;
    }
  }
  return stopped;
}
