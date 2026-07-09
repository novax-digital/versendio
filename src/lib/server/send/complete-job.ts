import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/server/queue/enqueue";

/**
 * Marks a job completed(_with_errors) once every item is final; notifies the
 * user. Idempotent — safe to call after any terminal item transition (polling
 * finalization, submit-time failure, dead-job resolution, cancel).
 */
export async function maybeCompleteJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("send_jobs")
    .select("id, user_id, status, is_test")
    .eq("id", jobId)
    .single();
  if (
    !job ||
    job.status === "completed" ||
    job.status === "completed_with_errors" ||
    job.status === "canceled"
  ) {
    return;
  }

  const { data: counts } = await admin
    .from("send_job_items")
    .select("status")
    .eq("job_id", jobId);
  if (!counts || counts.length === 0) return;

  const finalStates = job.is_test
    ? ["checked", "sent", "failed", "canceled"]
    : ["sent", "failed", "canceled"];
  const allFinal = counts.every((c) => finalStates.includes(c.status));
  if (!allFinal) return;

  const hasFailures = counts.some((c) => c.status === "failed");
  const allCanceled = counts.every((c) => c.status === "canceled");
  const newStatus = allCanceled
    ? "canceled"
    : hasFailures
      ? "completed_with_errors"
      : "completed";

  await admin
    .from("send_jobs")
    .update({ status: newStatus, completed_at: new Date().toISOString() })
    .eq("id", jobId);

  if (!allCanceled) {
    await enqueueJob("send_email", {
      template: hasFailures ? "job_completed_with_errors" : "job_completed",
      userId: job.user_id,
      jobId,
    });
  }
}
