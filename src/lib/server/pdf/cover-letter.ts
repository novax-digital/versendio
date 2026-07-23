import "server-only";
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { A4 } from "@/lib/shared/schablone";
import { de } from "@/lib/i18n/de";
import { drawCoverFooter, drawCoverLabel, drawRecipientBlock, drawSenderLine } from "./render-shared";

export type CoverLetterOptions = {
  /**
   * Prints the "sent via versendio.de" notice at the bottom of the cover
   * page. Defaults to on; users opt out via profiles.cover_letter_footer.
   */
  footerNotice?: boolean;
};

function drawCoverContent(
  page: PDFPage,
  font: PDFFont,
  senderLine: string,
  addressLines: string[],
  opts: CoverLetterOptions,
) {
  drawSenderLine(page, font, senderLine);
  drawRecipientBlock(page, font, addressLines);
  drawCoverLabel(page, font);
  if (opts.footerNotice !== false) drawCoverFooter(page, font, de.letters.coverFooterText);
}

/**
 * Builds a single A4 cover page carrying only the sender line and recipient
 * address in the correct Schablone V3 zones, then prepends it to an existing
 * PDF. Used when an uploaded PDF has no reliable address block (ADR-0006 §2).
 */
export async function prependCoverLetter(
  originalBytes: Uint8Array,
  senderLine: string,
  addressLines: string[],
  opts: CoverLetterOptions = {},
): Promise<Uint8Array> {
  const original = await PDFDocument.load(originalBytes, { throwOnInvalidObject: false });
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);

  const cover = out.addPage([A4.widthPt, A4.heightPt]);
  drawCoverContent(cover, font, senderLine, addressLines, opts);

  const copied = await out.copyPages(original, original.getPageIndices());
  for (const page of copied) out.addPage(page);

  return out.save();
}

/** Standalone cover page (no original), e.g. for previews. */
export async function buildCoverPage(
  senderLine: string,
  addressLines: string[],
  opts: CoverLetterOptions = {},
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const page = out.addPage([A4.widthPt, A4.heightPt]);
  drawCoverContent(page, font, senderLine, addressLines, opts);
  return out.save();
}
