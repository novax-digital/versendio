/**
 * Deutsche Post Briefschablone V3 (BK Standard/BZL) geometry, in millimetres
 * from the top-left of a DIN A4 page (210 × 297 mm). Source:
 * docs/reference/epost/schablone-v3.md. Shared by PDF validation, the editor
 * renderer and the preview overlay so all three agree on one layout.
 */

export const A4 = {
  widthMm: 210,
  heightMm: 297,
  // Exact PDF points the API expects; 595.28 is rejected with W208.
  widthPt: 595.276,
  heightPt: 841.89,
} as const;

export const MM_PER_INCH = 25.4;
export const PT_PER_MM = 72 / MM_PER_INCH; // 2.8346…

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

/** A rectangle in mm, origin top-left (y grows downward). */
export type ZoneMm = { x: number; y: number; width: number; height: number };

/**
 * Address-block zones on page 1. The whole block sits at x=23mm, y=45..90mm,
 * 85mm wide. Sender line: 1 line @ 8pt. DVF zone: must stay empty (franking
 * barcode). Recipient block: max 6 lines @ 9pt.
 */
export const ZONES = {
  senderLine: { x: 23, y: 45, width: 85, height: 5.5 },
  dvfBlocked: { x: 23, y: 52, width: 85, height: 16 },
  recipient: { x: 23, y: 69, width: 85, height: 21 },
  addressBlock: { x: 23, y: 45, width: 85, height: 45 },
} as const satisfies Record<string, ZoneMm>;

/** Print-free margins (no ink allowed) — 2mm all around, 12mm left strip. */
export const MARGINS = {
  topMm: 2,
  rightMm: 2,
  bottomMm: 2,
  leftStripMm: 12,
} as const;

/** Fold mark position (Z-fold type B). We never draw it — the API adds it. */
export const FOLD_MARK_MM = 105;

/** Safety inset when placing our own text so it never touches a zone edge. */
export const ZONE_SAFETY_INSET_MM = 2;

/** Sending limits enforced by the pipeline (MASTERPROMPT §6.2). */
export const LIMITS = {
  maxSheets: 94,
  maxFileSizeBytes: 20 * 1024 * 1024,
  maxImageDpi: 300,
  recipientMaxLines: 6,
} as const;

/** Converts a mm zone to fractional percentages for HTML overlays. */
export function zoneToPercent(zone: ZoneMm) {
  return {
    left: (zone.x / A4.widthMm) * 100,
    top: (zone.y / A4.heightMm) * 100,
    width: (zone.width / A4.widthMm) * 100,
    height: (zone.height / A4.heightMm) * 100,
  };
}
