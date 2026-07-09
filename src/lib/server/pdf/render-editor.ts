import "server-only";
import { PDFDocument, StandardFonts, type PDFImage } from "pdf-lib";
import { A4, ZONES, MARGINS, mmToPt } from "@/lib/shared/schablone";
import type { LetterDocument } from "@/lib/shared/letter-document";
import { resolvePlaceholders, type PlaceholderContext } from "@/lib/shared/placeholders";
import {
  drawRecipientBlock,
  drawSenderLine,
  topMmToBaselinePt,
  wrapText,
  sanitizeText,
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

const CONTENT_LEFT_MM = MARGINS.leftStripMm + 3; // clear of the 12mm strip
const CONTENT_RIGHT_MM = A4.widthMm - MARGINS.rightMm - 3;
const CONTENT_WIDTH_MM = CONTENT_RIGHT_MM - CONTENT_LEFT_MM;
const BODY_START_MM = 95; // below the address block (ends at 90mm)
const BODY_BOTTOM_MM = A4.heightMm - 20; // 20mm bottom margin
const BODY_SIZE = 11;
const BODY_LINE_MM = 4.6;

/**
 * Renders an editor letter to a validated A4 PDF (ADR-0006). Same output
 * contract as uploads. Placeholders are resolved against the recipient.
 * Multi-page: body overflow continues on follow-up A4 pages (no address block).
 */
export async function renderEditorLetter(input: EditorRenderInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([A4.widthPt, A4.heightPt]);

  // Logo (optional), above the address block.
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
          x: mmToPt(CONTENT_LEFT_MM),
          y: A4.heightPt - mmToPt(10) - hPt * finalScale,
          width: wPt * finalScale,
          height: hPt * finalScale,
        });
      }
    }
  }

  // Mandatory sender line + recipient address block (Schablone zones).
  drawSenderLine(page, font, input.senderLine);
  drawRecipientBlock(page, font, input.recipient.addressLines);

  // Date, right-aligned, just below the address block.
  if (input.document.showDate) {
    const dateStr = new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date());
    const size = 10;
    const w = font.widthOfTextAtSize(dateStr, size);
    page.drawText(dateStr, {
      x: mmToPt(CONTENT_RIGHT_MM) - w,
      y: topMmToBaselinePt(ZONES.addressBlock.y + ZONES.addressBlock.height + 2, size),
      size,
      font,
      color: BLACK,
    });
  }

  // Body blocks.
  const ctx = input.recipient.placeholders;
  const maxWidthPt = mmToPt(CONTENT_WIDTH_MM);
  const xPt = mmToPt(CONTENT_LEFT_MM);
  let cursorMm = BODY_START_MM;

  const newPage = () => {
    page = pdf.addPage([A4.widthPt, A4.heightPt]);
    cursorMm = MARGINS.topMm + 15;
  };
  const ensureSpace = (neededMm: number) => {
    if (cursorMm + neededMm > BODY_BOTTOM_MM) newPage();
  };

  for (const block of input.document.blocks) {
    if (block.type === "spacer") {
      cursorMm += block.heightMm;
      if (cursorMm > BODY_BOTTOM_MM) newPage();
      continue;
    }
    if (block.type === "subject") {
      const text = resolvePlaceholders(block.text, ctx).trim();
      if (!text) continue;
      ensureSpace(BODY_LINE_MM + 3);
      page.drawText(sanitizeText(text), {
        x: xPt,
        y: topMmToBaselinePt(cursorMm, BODY_SIZE),
        size: BODY_SIZE,
        font: fontBold,
        color: BLACK,
      });
      cursorMm += BODY_LINE_MM + 3;
      continue;
    }
    if (block.type === "text") {
      const text = resolvePlaceholders(block.text, ctx);
      const lines = wrapText(text, font, BODY_SIZE, maxWidthPt);
      for (const line of lines) {
        ensureSpace(BODY_LINE_MM);
        if (line !== "") {
          page.drawText(line, {
            x: xPt,
            y: topMmToBaselinePt(cursorMm, BODY_SIZE),
            size: BODY_SIZE,
            font,
            color: BLACK,
          });
        }
        cursorMm += BODY_LINE_MM;
      }
      continue;
    }
    if (block.type === "image" && input.loadImage) {
      const image = await input.loadImage(block.storagePath);
      if (!image) continue;
      const embedded = await embedImage(pdf, image);
      if (!embedded) continue;
      const wPt = mmToPt(Math.min(block.widthMm, CONTENT_WIDTH_MM));
      const hPt = (embedded.height / embedded.width) * wPt;
      ensureSpace(hPt / mmToPt(1) + 2);
      let imgX = xPt;
      if (block.align === "center") imgX = xPt + (maxWidthPt - wPt) / 2;
      if (block.align === "right") imgX = xPt + (maxWidthPt - wPt);
      page.drawImage(embedded, {
        x: imgX,
        y: topMmToBaselinePt(cursorMm, 0) - hPt,
        width: wPt,
        height: hPt,
      });
      cursorMm += hPt / mmToPt(1) + 2;
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
