import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkCustomLimit } from "@/lib/server/rate-limit";
import { uploadObject, BUCKETS } from "@/lib/server/storage";
import { avvStoragePath } from "@/lib/server/avv";
import { avvRequestSchema } from "@/lib/shared/schemas/avv";
import { de } from "@/lib/i18n/de";

/**
 * Fills the countersigned AVV template with the customer's data and signature
 * and returns it as a download. Nothing is persisted — the signature only
 * exists in memory for this request.
 *
 * All coordinates are pdf-lib points with bottom-left origin, measured on the
 * template (595.2 x 841.92 pt, 8 pages):
 * - Page 1 customer block: x 83.6, first baseline y 630, line height 15.5;
 *   a placeholder note at x 80-230 / y 557-574 is masked with a white box.
 * - Page 8 customer signature field: line at y 513.6-524.7, x 62.4-252.1;
 *   date baseline y 528 at x 62.4, signature image sits on the line at x 130.
 */
// Deliberately OUTSIDE public/: the countersigned blank must not be
// downloadable without going through this route.
const TEMPLATE_PATH = path.join(process.cwd(), "assets", "avv", "AVV_Versendio_signed.pdf");
const LINE_X = 83.6;
const LINE_MAX_WIDTH = 448; // right edge ~532
const FIRST_BASELINE_Y = 630;
const LINE_HEIGHT = 15.5;

/** Shrink the font size until the line fits the block width (min 7.5 pt). */
function fittedSize(font: PDFFont, text: string, base: number): number {
  let size = base;
  while (size > 7.5 && font.widthOfTextAtSize(text, size) > LINE_MAX_WIDTH) {
    size -= 0.5;
  }
  return size;
}

export async function POST(request: Request) {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return NextResponse.json({ error: "blocked" }, { status: 403 });

  if (!(await checkCustomLimit(`avv:${profile.id}`, 10, 3600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = avvRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }

  const signatureBytes = Buffer.from(
    parsed.data.signature.slice("data:image/png;base64,".length),
    "base64",
  );
  if (signatureBytes.length === 0 || signatureBytes.length > 300_000) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }

  try {
    const doc = await PDFDocument.load(await readFile(TEMPLATE_PATH));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const black = rgb(0, 0, 0);

    // Page 1 — customer block. Mask the placeholder note first, then write
    // the four data lines.
    const page1 = doc.getPage(0);
    page1.drawRectangle({ x: 80, y: 556.9, width: 150, height: 17, color: rgb(1, 1, 1) });
    const lines = [
      parsed.data.company,
      `vertreten durch: ${parsed.data.representative}`,
      parsed.data.street,
      `${parsed.data.zip} ${parsed.data.city}`,
    ];
    lines.forEach((text, i) => {
      page1.drawText(text, {
        x: LINE_X,
        y: FIRST_BASELINE_Y - i * LINE_HEIGHT,
        size: fittedSize(font, text, 11),
        font,
        color: black,
      });
    });

    // Page 8 — date and signature on the customer line (left field).
    const page8 = doc.getPage(7);
    const dateStr = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date());
    page8.drawText(dateStr, { x: 62.4, y: 528, size: 11, font, color: black });

    const signature = await doc.embedPng(signatureBytes);
    // Keep the image inside the field (ends at x 252.1) and on the line.
    const scale = Math.min(28 / signature.height, 115 / signature.width);
    page8.drawImage(signature, {
      x: 130,
      y: 525,
      width: signature.width * scale,
      height: signature.height * scale,
    });
    // Who signed — mirrors the template's "Philipp Polley / CEO" note on the
    // provider side: small, right-aligned to the field end, just above the line.
    const signerNote = parsed.data.representative;
    const noteSize = 7;
    page8.drawText(signerNote, {
      x: 252.1 - font.widthOfTextAtSize(signerNote, noteSize),
      y: 518,
      size: noteSize,
      font,
      color: rgb(0.25, 0.25, 0.25),
    });
    // The template carries our countersignature and name but no date — the
    // contract is executed at generation time, so both sides get today.
    page8.drawText(dateStr, { x: 302.3, y: 528, size: 11, font, color: black });

    const bytes = await doc.save();

    // Persist for permanent re-download from the settings page. Non-fatal:
    // the direct download below still works if storage is unavailable.
    const stored = await uploadObject(BUCKETS.assets, avvStoragePath(profile.id), bytes, "application/pdf");
    if (stored.ok) {
      const admin = createAdminClient();
      const { error: stampError } = await admin
        .from("profiles")
        .update({ avv_signed_at: new Date().toISOString() })
        .eq("id", profile.id);
      if (stampError) {
        console.error("avv_stamp_failed", { error: stampError.message });
      }
    }

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${de.avv.downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("avv_generate_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
