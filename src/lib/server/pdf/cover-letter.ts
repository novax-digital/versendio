import "server-only";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { A4 } from "@/lib/shared/schablone";
import { drawCoverLabel, drawRecipientBlock, drawSenderLine } from "./render-shared";

/**
 * Builds a single A4 cover page carrying only the sender line and recipient
 * address in the correct Schablone V3 zones, then prepends it to an existing
 * PDF. Used when an uploaded PDF has no reliable address block (ADR-0006 §2).
 */
export async function prependCoverLetter(
  originalBytes: Uint8Array,
  senderLine: string,
  addressLines: string[],
): Promise<Uint8Array> {
  const original = await PDFDocument.load(originalBytes, { throwOnInvalidObject: false });
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  const cover = out.addPage([A4.widthPt, A4.heightPt]);
  drawSenderLine(cover, font, senderLine);
  drawRecipientBlock(cover, font, addressLines);
  drawCoverLabel(cover, font);

  const copied = await out.copyPages(original, original.getPageIndices());
  for (const page of copied) out.addPage(page);

  return out.save();
}

/** Standalone cover page (no original), e.g. for previews. */
export async function buildCoverPage(
  senderLine: string,
  addressLines: string[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const page = out.addPage([A4.widthPt, A4.heightPt]);
  drawSenderLine(page, font, senderLine);
  drawRecipientBlock(page, font, addressLines);
  drawCoverLabel(page, font);
  return out.save();
}
