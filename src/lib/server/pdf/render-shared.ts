import "server-only";
import { type PDFFont, type PDFPage, rgb } from "pdf-lib";
import { A4, ZONES, ZONE_SAFETY_INSET_MM, mmToPt } from "@/lib/shared/schablone";

export const BLACK = rgb(0, 0, 0);

/** Converts a top-left mm y to a pdf-lib bottom-left pt y for a given text height. */
export function topMmToBaselinePt(yTopMm: number, fontSizePt: number): number {
  // Baseline sits ~font ascent below the top; approximate ascent as 0.8em.
  const yTopPt = A4.heightPt - mmToPt(yTopMm);
  return yTopPt - fontSizePt * 0.8;
}

/** Draws the mandatory single-line sender line inside its Schablone zone. */
export function drawSenderLine(page: PDFPage, font: PDFFont, senderLine: string) {
  const size = 8;
  const x = mmToPt(ZONES.senderLine.x + ZONE_SAFETY_INSET_MM);
  const y = topMmToBaselinePt(ZONES.senderLine.y + 1.5, size);
  const maxWidth = mmToPt(ZONES.senderLine.width - 2 * ZONE_SAFETY_INSET_MM);
  page.drawText(clampToWidth(senderLine, font, size, maxWidth), {
    x,
    y,
    size,
    font,
    color: BLACK,
  });
}

/** Draws up to 6 recipient lines inside the recipient zone (9pt). */
export function drawRecipientBlock(page: PDFPage, font: PDFFont, lines: string[]) {
  const size = 9;
  const lineHeightMm = 3.5;
  const startYMm = ZONES.recipient.y + ZONE_SAFETY_INSET_MM;
  const x = mmToPt(ZONES.recipient.x + ZONE_SAFETY_INSET_MM);
  const maxWidth = mmToPt(ZONES.recipient.width - 2 * ZONE_SAFETY_INSET_MM);
  lines.slice(0, 6).forEach((line, i) => {
    const y = topMmToBaselinePt(startYMm + i * lineHeightMm, size);
    page.drawText(clampToWidth(line, font, size, maxWidth), { x, y, size, font, color: BLACK });
  });
}

/** Truncates text with an ellipsis so it never exceeds maxWidth. */
export function clampToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const sanitized = sanitizeText(text);
  return clampPrepared(sanitized, font, size, maxWidth);
}

function clampPrepared(sanitized: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) return sanitized;
  let result = sanitized;
  while (result.length > 1 && font.widthOfTextAtSize(result + "…", size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + "…";
}

/**
 * Word-wraps text to a max width, returning lines. `sanitize=false` keeps the
 * raw text (embedded full-Unicode fonts); the standard fonts require the
 * WinAnsi sanitize pass. Measurement and drawing must use the same strings —
 * callers draw exactly the returned lines.
 */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  sanitize = true,
): string[] {
  const lines: string[] = [];
  const prepared = sanitize ? sanitizeText(text) : text.replaceAll("\t", "  ").replaceAll("\r", "");
  for (const paragraph of prepared.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // Hard-break a single word too long for the line.
        if (font.widthOfTextAtSize(word, size) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          current = chunk;
        } else {
          current = word;
        }
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Common Unicode punctuation → WinAnsi-safe equivalents so pretty quotes/dashes
// render cleanly instead of "?". Keys use escapes to stay ASCII-clean in source.
const TRANSLITERATE: Record<string, string> = {
  "–": "-", // en dash
  "‘": "'", // left single quote
  "’": "'", // right single quote
  " ": " ", // non-breaking space
};
// Characters above U+00FF that Helvetica's WinAnsi encoding still supports.
const WINANSI_EXTRAS = new Set([
  "€", // euro
  "•", // bullet
  "…", // ellipsis
  "„", // low double quote
  "“", // left double quote
  "”", // right double quote
  "—", // em dash
]);

/**
 * Standard-14 Helvetica covers WinAnsi only. Transliterate common typographic
 * characters and replace anything else outside WinAnsi so drawText never throws
 * on exotic input. German (umlauts, ß, €, ·) is within range and preserved.
 * Full-Unicode fidelity via an embedded font is tracked in docs/IDEAS.md.
 */
export function sanitizeText(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch] ?? ch;
    const code = mapped.codePointAt(0) ?? 0;
    if (mapped === "\n" || mapped === "\t") {
      out += mapped;
    } else if (code >= 0x20 && code <= 0xff) {
      out += mapped;
    } else if (WINANSI_EXTRAS.has(mapped)) {
      out += mapped;
    } else {
      out += "?";
    }
  }
  return out;
}

export { mmToPt };
