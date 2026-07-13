import { A4, MARGINS } from "@/lib/shared/schablone";
import type { LetterBlock, LetterTheme } from "@/lib/shared/letter-document";

/**
 * Single source of truth for letter typography metrics — used by BOTH the
 * server PDF renderer and the browser canvas so the WYSIWYG estimate and the
 * printed letter agree. Changing anything here re-layouts letters and can
 * change sheet counts (= price); keep `legacyLayout` output frozen.
 */

export const PT_TO_MM = 25.4 / 72; // 0.3528 — 1 typographic point in mm

export type ContentFrame = {
  leftMm: number;
  rightMm: number;
  widthMm: number;
  /** Body start on page 1 (below the address block, which ends at 90mm). */
  bodyStartMm: number;
  /** Body start on follow-up pages. */
  followTopMm: number;
  /** Last usable line on every page (20mm bottom margin). */
  bottomMm: number;
};

/**
 * Original content column (clear of the 12mm strip + 2mm margins). Kept
 * verbatim for `marginStyle: "classic"` documents — their stored pagination
 * (= booked price) must not change.
 */
export const CONTENT: ContentFrame = {
  leftMm: MARGINS.leftStripMm + 3, // 15
  rightMm: A4.widthMm - MARGINS.rightMm - 3, // 205
  widthMm: A4.widthMm - MARGINS.rightMm - 3 - (MARGINS.leftStripMm + 3), // 190
  bodyStartMm: 95,
  followTopMm: MARGINS.topMm + 15, // 17
  bottomMm: A4.heightMm - 20, // 277
};

/**
 * DIN 5008 content column: 25mm left / 20mm right. The body text aligns
 * exactly with the printed address block (Schablone zone x23 + 2mm inset).
 * Vertical metrics stay identical to CONTENT so only wrapping changes.
 */
export const DIN_CONTENT: ContentFrame = {
  leftMm: 25,
  rightMm: A4.widthMm - 20, // 190
  widthMm: A4.widthMm - 20 - 25, // 165
  // Below the date line (date band 92–95.5mm) with clear separation.
  bodyStartMm: 100,
  followTopMm: CONTENT.followTopMm,
  bottomMm: CONTENT.bottomMm,
};

/** Resolves the content column for a document's theme. */
export function contentFrame(theme: Pick<LetterTheme, "marginStyle">): ContentFrame {
  return theme.marginStyle === "din" ? DIN_CONTENT : CONTENT;
}

/**
 * Page-1 letterhead geometry (header band, footer band, logo box). Fixed
 * bands OUTSIDE the body flow: the header ends above the sender zone (y45,
 * minus safety), the footer sits below CONTENT.bottomMm and above the 2mm
 * print-free margin — so neither can ever change pagination or collide with
 * the Schablone zones (enforced by construction, the validator only sees text).
 */
export const LETTERHEAD = {
  header: { topMm: 12, sizePt: 8, lineMm: 8 * (25.4 / 72) * 1.3, maxLines: 8 }, // ends ≤ 42.6mm < 43
  footer: { topMm: 279, sizePt: 7.5, lineMm: 7.5 * (25.4 / 72) * 1.3, maxLines: 4 }, // ends ≤ 292.8mm < 295
  logo: { topMm: 10, maxWidthMm: 60, maxHeightMm: 30 },
  /** Horizontal gap between logo box and header text when both are present. */
  gapMm: 5,
} as const;

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
export function dividerMetrics(
  block: Extract<LetterBlock, { type: "divider" }>,
  theme: Pick<LetterTheme, "marginStyle">,
) {
  return {
    widthMm: (contentFrame(theme).widthMm * block.widthPct) / 100,
    thicknessMm: block.thicknessPt * PT_TO_MM,
    spacingMm: 2.5, // above and below
  };
}
