import "server-only";
import { PDFDocument } from "pdf-lib";
import { A4, LIMITS, mmToPt } from "@/lib/shared/schablone";

/**
 * Float tolerance for "already exact A4". The E-Post API rejects boxes that
 * are even fractionally off (595.28 → W208, a 0.004pt delta), so this covers
 * serialization noise only.
 */
export const A4_EXACT_TOLERANCE_PT = 0.003;

/**
 * Maximum per-dimension deviation we silently fix by rescaling. 10 mm covers
 * rounded exports (595.28pt), 209×296mm generators and slightly-off scans
 * while keeping the non-uniform distortion under ~5% — visually negligible.
 * Anything larger (US Letter, A5, landscape) is a genuine format mismatch the
 * user must resolve, not noise we should paper over.
 */
const NORMALIZE_TOLERANCE_PT = mmToPt(10);

export type NormalizeResult = {
  bytes: Uint8Array;
  /** True when at least one page was rescaled to the exact A4 box. */
  adjusted: boolean;
};

/**
 * Rescales pages whose box deviates only slightly from DIN A4 to the exact
 * box the E-Post API requires ([595.276, 841.89]). Runs BEFORE validation so
 * the zone analysis sees the final geometry and the stored PDF is the one
 * that will actually be dispatched.
 *
 * Unparseable/encrypted input and deviations beyond the tolerance are left
 * untouched — validateLetterPdf reports those cases with the right message.
 * Already-exact PDFs are returned byte-identical (no pdf-lib re-save).
 */
export async function normalizePdfToA4(bytes: Uint8Array): Promise<NormalizeResult> {
  let doc: PDFDocument;
  try {
    // No ignoreEncryption here: an encrypted PDF must fall through unchanged
    // so validation shows its dedicated message instead of a broken re-save.
    doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false, updateMetadata: false });
  } catch {
    return { bytes, adjusted: false };
  }

  const pages = doc.getPages();
  // Documents over the hard page cap are rejected by validation anyway —
  // never spend per-page rescale + full re-serialize work on them (a sub-20MB
  // PDF can hold tens of thousands of near-A4 pages).
  if (pages.length === 0 || pages.length > LIMITS.maxSheets * 2) {
    return { bytes, adjusted: false };
  }

  const toAdjust: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const { width, height } = page.getSize();
    const dw = Math.abs(width - A4.widthPt);
    const dh = Math.abs(height - A4.heightPt);
    if (dw <= A4_EXACT_TOLERANCE_PT && dh <= A4_EXACT_TOLERANCE_PT) continue;
    if (dw > NORMALIZE_TOLERANCE_PT || dh > NORMALIZE_TOLERANCE_PT || width <= 0 || height <= 0) {
      // At least one page is a real format mismatch — don't half-fix the
      // document; validation rejects it with the format message.
      return { bytes, adjusted: false };
    }
    // A CropBox smaller than the MediaBox hides content by design; forcing
    // both to the full A4 box would reveal it. Such pages are not "slightly
    // off A4" — leave the document to the regular format error.
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    if (
      Math.abs(crop.x - media.x) > 0.01 ||
      Math.abs(crop.y - media.y) > 0.01 ||
      Math.abs(crop.width - media.width) > 0.01 ||
      Math.abs(crop.height - media.height) > 0.01
    ) {
      return { bytes, adjusted: false };
    }
    toAdjust.push(i);
  }
  if (toAdjust.length === 0) return { bytes, adjusted: false };

  for (const i of toAdjust) {
    const page = pages[i];
    const box = page.getMediaBox();
    // Content coordinates are absolute; a non-zero box origin must be shifted
    // into (0,0) before scaling. translateContent is the inner wrap (applied
    // to content first), scaleContent the outer one. Known limitation:
    // annotations are scaled but not translated — acceptable, annotations
    // (links/comments) are invisible on the printed letter anyway.
    if (box.x !== 0 || box.y !== 0) page.translateContent(-box.x, -box.y);
    const sx = A4.widthPt / box.width;
    const sy = A4.heightPt / box.height;
    page.scaleContent(sx, sy);
    page.scaleAnnotations(sx, sy);
    // Write the exact target values instead of scaling the old ones — float
    // products like width*(A4/width) can serialize as 595.27600000001, which
    // the API rejects. All box variants must agree or viewers/printers would
    // keep clipping to the old CropBox.
    page.setMediaBox(0, 0, A4.widthPt, A4.heightPt);
    page.setCropBox(0, 0, A4.widthPt, A4.heightPt);
    page.setBleedBox(0, 0, A4.widthPt, A4.heightPt);
    page.setTrimBox(0, 0, A4.widthPt, A4.heightPt);
    page.setArtBox(0, 0, A4.widthPt, A4.heightPt);
  }

  return { bytes: await doc.save(), adjusted: true };
}
