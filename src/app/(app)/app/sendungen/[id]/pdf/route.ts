import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { downloadObject, BUCKETS } from "@/lib/server/storage";
import { buildItemPdf } from "@/lib/server/send/process-item";
import { buildRecipientAddressLines, type RecipientAddress } from "@/lib/shared/address";

/**
 * Downloads the letter of one send-job item as PDF (RLS-scoped to the owner).
 * Prefers the exact stored PDF; once retention has cleaned it up, it is
 * reproduced on demand from the letter plus the item's frozen recipient/sender
 * snapshots — the same render path used at send time.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  const itemId = new URL(request.url).searchParams.get("item");
  if (!itemId) return NextResponse.json({ error: "missing_item" }, { status: 400 });

  const supabase = await createClient();

  // Ownership via RLS: the item must belong to this job and this user.
  const { data: item } = await supabase
    .from("send_job_items")
    .select("id, recipient_snapshot, rendered_pdf_path")
    .eq("id", itemId)
    .eq("job_id", id)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: job } = await supabase
    .from("send_jobs")
    .select("letter_id, sender_snapshot")
    .eq("id", id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    let bytes: Uint8Array | null = null;

    // Exact sent artifact while it still exists (wiped by the retention cron).
    if (item.rendered_pdf_path) {
      bytes = await downloadObject(BUCKETS.letters, item.rendered_pdf_path);
    }

    // Fallback: reproduce from the frozen snapshots.
    if (!bytes) {
      const recipient = item.recipient_snapshot as unknown as RecipientAddress;
      const sender = (job.sender_snapshot ?? {}) as { sender_line?: string; city?: string };
      const addressLines = buildRecipientAddressLines(recipient);
      bytes = await buildItemPdf(
        job.letter_id,
        recipient,
        sender.sender_line ?? "",
        sender.city ?? null,
        addressLines,
      );
    }

    if (!bytes) return NextResponse.json({ error: "no_content" }, { status: 404 });

    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="brief-${itemId.slice(0, 8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("sendung_pdf_failed", { error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }
}
