import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/server/queue/cron-auth";
import { serverEnv } from "@/lib/server/env";
import { BUCKETS } from "@/lib/server/storage";
import { writeAuditLog } from "@/lib/server/audit";
import { enqueueJob } from "@/lib/server/queue/enqueue";

export const maxDuration = 300;

/**
 * Daily maintenance (ADR-0009 §3): PDF retention, import cleanup, queue/rate
 * table pruning, ledger integrity check.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const env = serverEnv();
  const report: Record<string, number> = {};

  // 1) Retention: delete rendered item PDFs LETTER_RETENTION_DAYS after final status.
  const cutoff = new Date(Date.now() - env.LETTER_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: expired } = await admin
    .from("send_job_items")
    .select("id, rendered_pdf_path")
    .in("status", ["sent", "failed", "canceled", "checked"])
    .not("rendered_pdf_path", "is", null)
    .lt("updated_at", cutoff)
    .limit(500);
  let removed = 0;
  for (const item of expired ?? []) {
    if (!item.rendered_pdf_path) continue;
    const { error } = await admin.storage.from(BUCKETS.letters).remove([item.rendered_pdf_path]);
    if (!error) {
      await admin
        .from("send_job_items")
        .update({ rendered_pdf_path: null })
        .eq("id", item.id);
      removed++;
    }
  }
  report.retention_pdfs_removed = removed;

  // 2) Import files older than 24h.
  const importCutoff = Date.now() - 86_400_000;
  const { data: users } = await admin.from("profiles").select("id").limit(1000);
  let importsRemoved = 0;
  for (const user of users ?? []) {
    const { data: files } = await admin.storage.from(BUCKETS.imports).list(user.id, { limit: 100 });
    const stale = (files ?? [])
      .filter((f) => f.created_at && Date.parse(f.created_at) < importCutoff)
      .map((f) => `${user.id}/${f.name}`);
    if (stale.length > 0) {
      const { error } = await admin.storage.from(BUCKETS.imports).remove(stale);
      if (!error) importsRemoved += stale.length;
    }
  }
  report.imports_removed = importsRemoved;

  // 3) Prune rate-limit windows (>24h) and finished queue jobs.
  await admin.from("rate_limits").delete().lt("window_start", new Date(importCutoff).toISOString());
  await admin
    .from("job_queue")
    .delete()
    .eq("status", "done")
    .lt("updated_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  await admin
    .from("job_queue")
    .delete()
    .eq("status", "dead")
    .lt("updated_at", new Date(Date.now() - 90 * 86_400_000).toISOString());

  // 4) Held items (on_hold_funds): retry daily — the debit re-attempt inside
  //    processSubmitItem succeeds once the user topped up. (Phase 6 will also
  //    re-enqueue immediately on top-up; this sweep is the safety net.)
  const { data: heldItems } = await admin
    .from("send_job_items")
    .select("id")
    .eq("status", "on_hold_funds")
    .limit(200);
  // enqueueJob is a no-op when a live submit job already exists (unique index).
  const heldIds = (heldItems ?? []).map((i) => i.id);
  for (const itemId of heldIds) {
    await enqueueJob("submit_item", { itemId });
  }
  report.held_items_requeued = heldIds.length;

  // 5) Refund reconciliation: failed items whose refund booking was lost to a
  //    transient error (idempotent via the ledger reference index).
  const { data: unrefunded } = await admin
    .from("send_job_items")
    .select("id, user_id, vk_cents, error_code, send_jobs!inner(is_test)")
    .eq("status", "failed")
    .is("refunded_at", null)
    .gt("vk_cents", 0)
    .limit(200);
  let refundsRecovered = 0;
  for (const item of unrefunded ?? []) {
    const isTest = (item.send_jobs as unknown as { is_test: boolean } | null)?.is_test ?? false;
    if (isTest) continue;
    const { error } = await admin.rpc("book_credit", {
      p_user_id: item.user_id,
      p_type: "refund",
      p_amount_cents: item.vk_cents,
      p_reference_type: "item_failed",
      p_reference_id: item.id,
      p_comment: `Erstattung (Nachbuchung): ${item.error_code ?? "99"}`,
      p_created_by: "system",
    });
    if (!error || error.message.includes("duplicate key")) {
      await admin
        .from("send_job_items")
        .update({ refunded_at: new Date().toISOString() })
        .eq("id", item.id);
      refundsRecovered++;
    }
  }
  report.refunds_recovered = refundsRecovered;

  // 6) Ledger integrity: SUM(ledger) must equal the denormalized balance.
  const { data: mismatches } = await admin.rpc("check_ledger_integrity");
  const mismatchCount = Array.isArray(mismatches) ? mismatches.length : 0;
  report.ledger_mismatches = mismatchCount;
  if (mismatchCount > 0) {
    console.error("ledger_integrity_mismatch", { count: mismatchCount });
    await writeAuditLog({
      actorUserId: null,
      action: "ledger_integrity_alert",
      details: { count: mismatchCount },
    });
  }

  return NextResponse.json(report);
}
