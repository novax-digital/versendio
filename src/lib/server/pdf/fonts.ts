import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import { LETTER_FONTS, type LetterFontId } from "@/lib/shared/letter-fonts";
import { sanitizeText } from "./render-shared";

/**
 * Loads and embeds the letter fonts (public/fonts TTFs, OFL-licensed) into a
 * PDF. Serverless note: next.config.ts outputFileTracingIncludes must list
 * public/fonts for every bundle that renders letters (editor actions, preview
 * route, cron queue worker).
 *
 * Module-level byte cache: safe in serverless (rebuilds by re-reading the
 * files on a cold start).
 */

const fontBytesCache = new Map<string, Uint8Array>();

async function loadFontBytes(file: string): Promise<Uint8Array> {
  const cached = fontBytesCache.get(file);
  if (cached) return cached;
  const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "fonts", file)));
  fontBytesCache.set(file, bytes);
  return bytes;
}

export type EmbeddedFamily = {
  regular: PDFFont;
  bold: PDFFont;
  /** True when the PDF standard font is used (WinAnsi — needs sanitizeText). */
  isStandard: boolean;
};

/**
 * Embeds the requested family (regular + bold) with subsetting. Never throws:
 * a missing/corrupt font file falls back to Helvetica so the queue worker can
 * always render — the letter then prints in the standard font.
 */
export async function embedLetterFont(
  pdf: PDFDocument,
  family: LetterFontId,
): Promise<EmbeddedFamily> {
  const meta = LETTER_FONTS[family];
  if (meta.files) {
    try {
      pdf.registerFontkit(fontkit);
      const [regularBytes, boldBytes] = await Promise.all([
        loadFontBytes(meta.files.regular),
        loadFontBytes(meta.files.bold),
      ]);
      // Ligatures off to match the canvas (font-variant-ligatures: none) so
      // measured line widths agree between browser and PDF.
      const options = { subset: true, features: { liga: false } };
      return {
        regular: await pdf.embedFont(regularBytes, options),
        bold: await pdf.embedFont(boldBytes, options),
        isStandard: false,
      };
    } catch (err) {
      console.error("letter_font_embed_failed", {
        family,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    isStandard: true,
  };
}

type CoverageFont = { hasGlyphForCodePoint: (cp: number) => boolean };
const coverageCache = new Map<string, CoverageFont>();

async function coverageFont(file: string): Promise<CoverageFont | null> {
  const cached = coverageCache.get(file);
  if (cached) return cached;
  try {
    const bytes = await loadFontBytes(file);
    const font = fontkit.create(Buffer.from(bytes)) as unknown as CoverageFont;
    coverageCache.set(file, font);
    return font;
  } catch {
    return null;
  }
}

/**
 * Returns the distinct characters in `text` the chosen family cannot print.
 * Embedded fonts silently render missing glyphs as tofu (fontkit maps them to
 * .notdef without throwing); Helvetica silently degrades to "?" via
 * sanitizeText — both cases must be surfaced as a save-time warning instead.
 */
export async function findUnsupportedChars(
  family: LetterFontId,
  text: string,
): Promise<string[]> {
  const missing = new Set<string>();
  const meta = LETTER_FONTS[family];
  if (!meta.files) {
    // Standard font: anything sanitizeText rewrites to "?" is unsupported —
    // except a literal "?" itself, which of course prints fine.
    for (const ch of text) {
      if (ch === "\n" || ch === "\t" || ch === "\r" || ch === "?") continue;
      if (sanitizeText(ch) === "?") missing.add(ch);
    }
    return [...missing];
  }
  const font = await coverageFont(meta.files.regular);
  if (!font) return [];
  for (const ch of text) {
    if (ch === "\n" || ch === "\t" || ch === "\r") continue;
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !font.hasGlyphForCodePoint(cp)) missing.add(ch);
  }
  return [...missing];
}
