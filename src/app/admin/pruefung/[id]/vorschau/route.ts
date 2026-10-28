import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/server/audit";
import { renderReviewPreview } from "@/lib/server/send/admin-review";

/**
 * Admin preview of a job's letter as it would be sent now, with a sample
 * recipient in our own address fields. Uploaded PDFs can still carry real
 * recipient data in the customer's own pages, so every view is audit-logged.
 * Inline so it opens in the browser's PDF viewer.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requireAdmin();
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("send_jobs")
    .select("letter_id, sender_snapshot")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const { pdf } = await renderReviewPreview(job.letter_id, job.sender_snapshot);
    await writeAuditLog({
      actorUserId: actor.id,
      action: "send_job_preview",
      targetType: "send_job",
      targetId: id,
    });
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="pruefung-${id.slice(0, 8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("review_preview_failed", { error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }
}
