import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { downloadObject, BUCKETS } from "@/lib/server/storage";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { prependCoverLetter } from "@/lib/server/pdf/cover-letter";
import { sampleRecipient } from "@/lib/server/pdf/sample-recipient";
import { parseLetterDocument } from "@/lib/shared/letter-document";

/**
 * Renders a preview PDF for a letter (RLS-scoped). Editor letters are rendered
 * on demand with a sample recipient; uploads are streamed from storage (with an
 * optional sample cover page). Same render path used at send time.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: letter, error } = await supabase
    .from("letters")
    .select("id, source, storage_path, editor_document, use_cover_letter")
    .eq("id", id)
    .single();

  if (error || !letter) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const recipient = sampleRecipient();

  try {
    let bytes: Uint8Array | null = null;

    if (letter.source === "editor") {
      const doc = parseLetterDocument(letter.editor_document);
      const senderLine = await resolveSenderLine(supabase, profile.id, doc.senderAddressId);
      bytes = await renderEditorLetter({
        document: doc,
        senderLine,
        recipient,
        loadImage: async (path) => {
          // Ownership boundary — see uploadAssetAction (paths are <userId>/…).
          if (!path.startsWith(`${profile.id}/`)) return null;
          const imgBytes = await downloadObject(BUCKETS.assets, path);
          if (!imgBytes) return null;
          const mime = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
          return { bytes: imgBytes, mime };
        },
      });
    } else if (letter.storage_path) {
      const stored = await downloadObject(BUCKETS.letters, letter.storage_path);
      if (!stored) return NextResponse.json({ error: "not_found" }, { status: 404 });
      bytes =
        letter.use_cover_letter && recipient.addressLines.length > 0
          ? await prependCoverLetter(stored, await defaultSenderLine(supabase, profile.id), recipient.addressLines)
          : stored;
    }

    if (!bytes) return NextResponse.json({ error: "no_content" }, { status: 404 });

    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=vorschau.pdf",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("letter_preview_failed", { error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }
}

async function resolveSenderLine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  senderAddressId: string | null,
): Promise<string> {
  if (senderAddressId) {
    const { data } = await supabase
      .from("sender_addresses")
      .select("sender_line")
      .eq("id", senderAddressId)
      .single();
    if (data?.sender_line) return data.sender_line;
  }
  return defaultSenderLine(supabase, userId);
}

async function defaultSenderLine(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("sender_addresses")
    .select("sender_line")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  return data?.sender_line ?? "";
}
