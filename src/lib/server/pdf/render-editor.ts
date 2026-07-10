import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import { A4, ZONES, mmToPt } from "@/lib/shared/schablone";
import type { LetterDocument } from "@/lib/shared/letter-document";
import { CONTENT, dividerMetrics, resolveTextStyle } from "@/lib/shared/letter-style";
import { resolvePlaceholders, type PlaceholderContext } from "@/lib/shared/placeholders";
import { embedLetterFont } from "./fonts";
import {
  drawRecipientBlock,
  drawSenderLine,
  sanitizeText,
  topMmToBaselinePt,
  wrapText,
  BLACK,
} from "./render-shared";

export type RecipientRender = {
  addressLines: string[];
  placeholders: PlaceholderContext;
};

export type EditorRenderInput = {
  document: LetterDocument;
  senderLine: string;
  recipient: RecipientRender;
  // Resolves an image storage path to raw bytes + mime (logos, image blocks).
  loadImage?: (storagePath: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
};

function hexToRgb(hex: string) {
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}

/**
 * Renders an editor letter to a validated A4 PDF (ADR-0006). Same output
 * contract as uploads. Placeholders are resolved against the recipient.
 * Multi-page: body overflow continues on follow-up A4 pages (no address block).
 *
 * Geometry enforcement lives HERE, not in the validator: analyze-zones only
 * sees text, so dividers/images must be clamped into the content column by
 * construction (12mm strip / 2mm margins / DVF zone stay clean).
 */
export async function renderEditorLetter(input: EditorRenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const theme = input.document.theme;
  const family = await embedLetterFont(pdf, theme.fontFamily);
  // The Schablone zones (sender line, recipient) always use Helvetica — their
  // metrics are prescribed and independent of the letter's display font.
  const zoneFont = family.isStandard
    ? family.regular
    : await pdf.embedFont(StandardFonts.Helvetica);

  let page = pdf.addPage([A4.widthPt, A4.heightPt]);

  // Logo (optional), above the address block. Bounded 60×30mm at y=10mm —
  // safely above the sender zone (y45).
  if (input.document.logoStoragePath && input.loadImage) {
    const image = await input.loadImage(input.document.logoStoragePath);
    if (image) {
      const embedded = await embedImage(pdf, image);
      if (embedded) {
        const maxWmm = 60;
        const scale = Math.min(1, mmToPt(maxWmm) / embedded.width);
        const wPt = embedded.width * scale;
        const hPt = embedded.height * scale;
        const maxHpt = mmToPt(30);
        const finalScale = hPt > maxHpt ? maxHpt / hPt : 1;
        page.drawImage(embedded, {
          x: mmToPt(CONTENT.leftMm),
          y: A4.heightPt - mmToPt(10) - hPt * finalScale,
          width: wPt * finalScale,
          height: hPt * finalScale,
        });
      }
    }
  }

  // Mandatory sender line + recipient address block (Schablone zones).
  drawSenderLine(page, zoneFont, input.senderLine);
  drawRecipientBlock(page, zoneFont, input.recipient.addressLines);

  // Date, right-aligned, just below the address block.
  if (input.document.showDate) {
    const dateStr = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date());
    const size = 10;
    const w = family.regular.widthOfTextAtSize(dateStr, size);
    page.drawText(dateStr, {
      x: mmToPt(CONTENT.rightMm) - w,
      y: topMmToBaselinePt(ZONES.addressBlock.y + ZONES.addressBlock.height + 2, size),
      size,
      font: family.regular,
      color: BLACK,
    });
  }

  // Body blocks.
  const ctx = input.recipient.placeholders;
  const maxWidthPt = mmToPt(CONTENT.widthMm);
  const leftPt = mmToPt(CONTENT.leftMm);
  let cursorMm = CONTENT.bodyStartMm;
  // Spacer advances are deferred until the next drawable block so a trailing
  // spacer never produces a paid blank page; a spacer never spans pages.
  let pendingSpacerMm = 0;

  const newPage = () => {
    page = pdf.addPage([A4.widthPt, A4.heightPt]);
    cursorMm = CONTENT.followTopMm;
  };
  const applyPendingSpace = () => {
    if (pendingSpacerMm > 0) {
      cursorMm += pendingSpacerMm;
      pendingSpacerMm = 0;
      if (cursorMm > CONTENT.bottomMm) newPage();
    }
  };
  const ensureSpace = (neededMm: number) => {
    if (cursorMm + neededMm > CONTENT.bottomMm) newPage();
  };
  const drawAlignedLine = (
    line: string,
    font: PDFFont,
    sizePt: number,
    align: "left" | "center" | "right",
    color: ReturnType<typeof hexToRgb>,
  ) => {
    if (line === "") return;
    const w = Math.min(font.widthOfTextAtSize(line, sizePt), maxWidthPt);
    let x = leftPt;
    if (align === "center") x = leftPt + (maxWidthPt - w) / 2;
    if (align === "right") x = leftPt + (maxWidthPt - w);
    // Clamp so ink never enters the 12mm strip or the right margin.
    x = Math.max(leftPt, Math.min(x, leftPt + maxWidthPt - w));
    page.drawText(line, {
      x,
      y: topMmToBaselinePt(cursorMm, sizePt),
      size: sizePt,
      font,
      color,
    });
  };

  const legacy = theme.legacyLayout;

  for (const block of input.document.blocks) {
    if (block.type === "spacer") {
      if (legacy) {
        // v1 semantics, bit-identical: apply immediately; a spacer crossing
        // the boundary resets to the follow-page top (even mid-chain).
        cursorMm += block.heightMm;
        if (cursorMm > CONTENT.bottomMm) newPage();
      } else {
        // New docs: defer so a trailing spacer never adds a paid blank page.
        pendingSpacerMm += block.heightMm;
      }
      continue;
    }

    if (block.type === "subject" || block.type === "heading" || block.type === "text") {
      const text = resolvePlaceholders(block.text, ctx);
      if ((block.type === "subject" || block.type === "heading") && !text.trim()) continue;
      const style = resolveTextStyle(block, theme);
      const font = style.bold ? family.bold : family.regular;
      const color = style.colorHex === "#000000" ? BLACK : hexToRgb(style.colorHex);

      if (legacy && block.type === "subject") {
        // v1 drew the subject as ONE verbatim line (no wrap, no whitespace
        // collapse) and reserved line + spacing in a single check.
        ensureSpace(style.lineMm + style.spacingAfterMm);
        page.drawText(sanitizeText(text), {
          x: leftPt,
          y: topMmToBaselinePt(cursorMm, style.sizePt),
          size: style.sizePt,
          font,
          color,
        });
        cursorMm += style.lineMm + style.spacingAfterMm;
        continue;
      }

      const lines = wrapText(text, font, style.sizePt, maxWidthPt, family.isStandard);
      if (lines.length === 0) continue;
      applyPendingSpace();
      lines.forEach((line, i) => {
        // First line of subject/heading keeps its trailing spacing attached
        // so a title is never orphaned at the very bottom of a page.
        ensureSpace(i === 0 ? style.lineMm + style.spacingAfterMm : style.lineMm);
        drawAlignedLine(line, font, style.sizePt, style.align, color);
        cursorMm += style.lineMm;
      });
      cursorMm += style.spacingAfterMm;
      continue;
    }

    if (block.type === "divider") {
      const metrics = dividerMetrics(block);
      applyPendingSpace();
      ensureSpace(metrics.spacingMm * 2 + metrics.thicknessMm);
      const y = A4.heightPt - mmToPt(cursorMm + metrics.spacingMm);
      page.drawLine({
        start: { x: leftPt, y },
        end: { x: leftPt + mmToPt(Math.min(metrics.widthMm, CONTENT.widthMm)), y },
        thickness: mmToPt(metrics.thicknessMm),
        color: block.color === "accent" ? hexToRgb(theme.accentColor) : hexToRgb("#94A3B8"),
      });
      cursorMm += metrics.spacingMm * 2 + metrics.thicknessMm;
      continue;
    }

    if (block.type === "image" && input.loadImage) {
      const image = await input.loadImage(block.storagePath);
      if (!image) continue;
      const embedded = await embedImage(pdf, image);
      if (!embedded) continue;
      applyPendingSpace();
      let wMm = Math.min(block.widthMm, CONTENT.widthMm);
      let hMm = (embedded.height / embedded.width) * wMm;
      // Clamp to a full page's content height so an image can never paint
      // into the bottom margin (scale down preserving aspect ratio).
      const pageCapacityMm = CONTENT.bottomMm - CONTENT.followTopMm;
      if (hMm > pageCapacityMm) {
        const s = pageCapacityMm / hMm;
        hMm *= s;
        wMm *= s;
      }
      ensureSpace(hMm + 2);
      const wPt = mmToPt(wMm);
      const hPt = mmToPt(hMm);
      let imgX = leftPt;
      if (block.align === "center") imgX = leftPt + (maxWidthPt - wPt) / 2;
      if (block.align === "right") imgX = leftPt + (maxWidthPt - wPt);
      page.drawImage(embedded, {
        x: imgX,
        y: A4.heightPt - mmToPt(cursorMm) - hPt,
        width: wPt,
        height: hPt,
      });
      cursorMm += hMm + 2;
    }
  }

  return pdf.save();
}

async function embedImage(
  pdf: PDFDocument,
  image: { bytes: Uint8Array; mime: string },
): Promise<PDFImage | null> {
  try {
    if (image.mime === "image/png") return await pdf.embedPng(image.bytes);
    if (image.mime === "image/jpeg" || image.mime === "image/jpg")
      return await pdf.embedJpg(image.bytes);
    return null;
  } catch (err) {
    console.error("image_embed_failed", { error: err instanceof Error ? err.message : "unknown" });
    return null;
  }
}
