import { describe, expect, it } from "vitest";
import { A4, ZONES, MARGINS, LIMITS, mmToPt, zoneToPercent } from "@/lib/shared/schablone";

describe("Schablone V3 geometry", () => {
  it("uses the exact A4 point box the API demands (595.28 is rejected with W208)", () => {
    expect(A4.widthPt).toBe(595.276);
    expect(A4.heightPt).toBe(841.89);
  });

  it("converts mm to pt", () => {
    expect(mmToPt(0)).toBe(0);
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(mmToPt(210)).toBeCloseTo(595.276, 2);
  });

  it("keeps the DVF blocked zone between the sender line and the recipient block", () => {
    const senderBottom = ZONES.senderLine.y + ZONES.senderLine.height;
    expect(senderBottom).toBeLessThanOrEqual(ZONES.dvfBlocked.y);
    const dvfBottom = ZONES.dvfBlocked.y + ZONES.dvfBlocked.height;
    expect(dvfBottom).toBeLessThanOrEqual(ZONES.recipient.y);
  });

  it("keeps the whole address block clear of the 12mm left strip", () => {
    for (const zone of [ZONES.senderLine, ZONES.dvfBlocked, ZONES.recipient]) {
      expect(zone.x).toBeGreaterThanOrEqual(MARGINS.leftStripMm);
    }
  });

  it("keeps the address block inside the page width", () => {
    const right = ZONES.addressBlock.x + ZONES.addressBlock.width;
    expect(right).toBeLessThanOrEqual(A4.widthMm - MARGINS.rightMm);
  });

  it("spans the address block exactly from the sender line to the recipient bottom", () => {
    expect(ZONES.addressBlock.y).toBe(ZONES.senderLine.y);
    expect(ZONES.addressBlock.y + ZONES.addressBlock.height).toBe(
      ZONES.recipient.y + ZONES.recipient.height,
    );
  });

  it("enforces the documented sending limits", () => {
    expect(LIMITS.maxSheets).toBe(94);
    expect(LIMITS.maxFileSizeBytes).toBe(20 * 1024 * 1024);
    expect(LIMITS.recipientMaxLines).toBe(6);
  });

  it("maps zones to overlay percentages", () => {
    const p = zoneToPercent(ZONES.recipient);
    expect(p.left).toBeCloseTo((23 / 210) * 100, 5);
    expect(p.top).toBeCloseTo((69 / 297) * 100, 5);
    expect(p.width).toBeCloseTo((85 / 210) * 100, 5);
  });
});
