import { A4, MARGINS } from "@/lib/shared/schablone";
import type { LetterBlock, LetterTheme } from "@/lib/shared/letter-document";

/**
 * Single source of truth for letter typography metrics — used by BOTH the
 * server PDF renderer and the browser canvas so the WYSIWYG estimate and the
 * printed letter agree. Changing anything here re-layouts letters and can
 * change sheet counts (= price); keep `legacyLayout` output frozen.
 */

export const PT_TO_MM = 25.4 / 72; // 0.3528 — 1 typographic point in mm

/** Content column on every page (clear of the 12mm strip + 2mm margins). */
export const CONTENT: {
  leftMm: number;
  rightMm: number;
  widthMm: number;
  /** Body start on page 1 (below the address block, which ends at 90mm). */
  bodyStartMm: number;
  /** Body start on follow-up pages. */
  followTopMm: number;
  /** Last usable line on every page (20mm bottom margin). */
  bottomMm: number;
} = {
  leftMm: MARGINS.leftStripMm + 3, // 15
  rightMm: A4.widthMm - MARGINS.rightMm - 3, // 205
  widthMm: A4.widthMm - MARGINS.rightMm - 3 - (MARGINS.leftStripMm + 3), // 190
  bodyStartMm: 95,
  followTopMm: MARGINS.topMm + 15, // 17
  bottomMm: A4.heightMm - 20, // 277
};

/** v1 renderer metrics, frozen: 4.6mm line advance at 11pt body size. */
export const LEGACY_LINE_MM_AT_11PT = 4.6;

export const MUTED_COLOR = "#64748B";

export function lineAdvanceMm(sizePt: number, theme: LetterTheme): number {
  if (theme.legacyLayout) return (LEGACY_LINE_MM_AT_11PT / 11) * sizePt;
  return sizePt * PT_TO_MM * theme.lineHeight;
}

export function subjectSizePt(theme: LetterTheme): number {
  // Legacy: subject rendered at body size (11pt bold). New docs: base + 1.
  return theme.legacyLayout ? theme.baseSizePt : theme.baseSizePt + 1;
}

export function headingSizePt(theme: LetterTheme, level: 1 | 2): number {
  return theme.baseSizePt + (level === 1 ? 6 : 3);
}

export type ResolvedTextStyle = {
  sizePt: number;
  bold: boolean;
  colorHex: string;
  align: "left" | "center" | "right";
  lineMm: number;
  /** Extra advance after the block, in mm. */
  spacingAfterMm: number;
};

export function blockColorHex(
  color: "default" | "accent" | "muted",
  theme: LetterTheme,
): string {
  if (color === "accent") return theme.accentColor;
  if (color === "muted") return MUTED_COLOR;
  return "#000000";
}

/** Resolves typography for subject/heading/text blocks against the theme. */
export function resolveTextStyle(
  block: Extract<LetterBlock, { type: "subject" | "heading" | "text" }>,
  theme: LetterTheme,
): ResolvedTextStyle {
  if (block.type === "subject") {
    const sizePt = subjectSizePt(theme);
    return {
      sizePt,
      bold: true,
      colorHex: blockColorHex(block.color, theme),
      align: block.align,
      lineMm: lineAdvanceMm(sizePt, theme),
      spacingAfterMm: 3,
    };
  }
  if (block.type === "heading") {
    const sizePt = headingSizePt(theme, block.level);
    return {
      sizePt,
      bold: true,
      colorHex: blockColorHex(block.color, theme),
      align: block.align,
      lineMm: lineAdvanceMm(sizePt, theme),
      spacingAfterMm: 2,
    };
  }
  // Defensive ?? so a not-yet-parsed document (missing zod defaults) can
  // never produce NaN metrics deep inside a render.
  const sizePt = theme.baseSizePt + (block.sizeDeltaPt ?? 0);
  return {
    sizePt,
    bold: false,
    colorHex: blockColorHex(block.color ?? "default", theme),
    align: block.align ?? "left",
    lineMm: lineAdvanceMm(sizePt, theme),
    spacingAfterMm: 0,
  };
}

/** Divider geometry within the content column (always left-anchored). */
export function dividerMetrics(block: Extract<LetterBlock, { type: "divider" }>) {
  return {
    widthMm: (CONTENT.widthMm * block.widthPct) / 100,
    thicknessMm: block.thicknessPt * PT_TO_MM,
    spacingMm: 2.5, // above and below
  };
}
