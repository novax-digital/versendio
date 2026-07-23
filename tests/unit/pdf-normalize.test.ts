import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { normalizePdfToA4 } from "@/lib/server/pdf/normalize";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { analyzeAddressZones } from "@/lib/server/pdf/analyze-zones";
import { A4, mmToPt } from "@/lib/shared/schablone";

async function makePdf(pages: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of pages) doc.addPage([w, h]);
  return doc.save();
}

async function pageSizes(bytes: Uint8Array): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => [p.getSize().width, p.getSize().height]);
}

describe("normalizePdfToA4", () => {
  it("returns exact-A4 input untouched (no re-save)", async () => {
    const bytes = await makePdf([[A4.widthPt, A4.heightPt]]);
    const result = await normalizePdfToA4(bytes);
    expect(result.adjusted).toBe(false);
    expect(result.bytes).toBe(bytes);
  });

  it("rescales the rounded 595.28 box to the exact A4 values", async () => {
    const bytes = await makePdf([
      [595.28, 841.89],
      [595.28, 841.89],
    ]);
    const result = await normalizePdfToA4(bytes);
    expect(result.adjusted).toBe(true);
    for (const [w, h] of await pageSizes(result.bytes)) {
      expect(Math.abs(w - A4.widthPt)).toBeLessThanOrEqual(0.003);
      expect(Math.abs(h - A4.heightPt)).toBeLessThanOrEqual(0.003);
    }
    const validation = await validateLetterPdf(result.bytes, { a4Normalized: result.adjusted });
    expect(validation.rules.some((r) => r.id === "a4")).toBe(false);
    expect(validation.rules.some((r) => r.id === "a4_adjusted" && r.severity === "ok")).toBe(true);
  });

  it("rescales a 209×296 mm export and keeps content positions proportional", async () => {
    const width = mmToPt(209);
    const height = mmToPt(296);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([width, height]);
    // Draw at the pre-scale position that must land at 65 mm / 75 mm from
    // top-left after normalization — the middle of the recipient zone.
    page.drawText("Muster GmbH", {
      x: mmToPt(65) * (width / A4.widthPt),
      y: (A4.heightPt - mmToPt(75)) * (height / A4.heightPt),
      size: 9,
      font,
    });
    const result = await normalizePdfToA4(await doc.save());
    expect(result.adjusted).toBe(true);

    const zones = await analyzeAddressZones(result.bytes);
    expect(zones.available).toBe(true);
    expect(zones.recipientZoneHasText).toBe(true);
    expect(zones.marginViolation).toBe(false);
    expect(zones.dvfViolation).toBe(false);
  });

  it("shifts a non-zero MediaBox origin into (0,0) before scaling", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595.28, 841.89]);
    page.setMediaBox(20, 30, 595.28, 841.89);
    // Content coordinates are absolute: 65/75 mm relative to the box origin.
    page.drawText("Muster GmbH", {
      x: 20 + mmToPt(65),
      y: 30 + A4.heightPt - mmToPt(75),
      size: 9,
      font,
    });
    const result = await normalizePdfToA4(await doc.save());
    expect(result.adjusted).toBe(true);

    const [[w, h]] = await pageSizes(result.bytes);
    expect(Math.abs(w - A4.widthPt)).toBeLessThanOrEqual(0.003);
    expect(Math.abs(h - A4.heightPt)).toBeLessThanOrEqual(0.003);
    const zones = await analyzeAddressZones(result.bytes);
    expect(zones.recipientZoneHasText).toBe(true);
  });

  it("leaves US Letter untouched so validation reports the format error", async () => {
    const bytes = await makePdf([[612, 792]]);
    const result = await normalizePdfToA4(bytes);
    expect(result.adjusted).toBe(false);
    expect(result.bytes).toBe(bytes);
    const validation = await validateLetterPdf(result.bytes);
    expect(validation.rules.some((r) => r.id === "a4" && r.severity === "error")).toBe(true);
  });

  it("adjusts only documents where every page is exact or fixable", async () => {
    // One exact page + one slightly-off page → fix the off page.
    const mixed = await normalizePdfToA4(
      await makePdf([
        [A4.widthPt, A4.heightPt],
        [595.28, 841.89],
      ]),
    );
    expect(mixed.adjusted).toBe(true);
    for (const [w, h] of await pageSizes(mixed.bytes)) {
      expect(Math.abs(w - A4.widthPt)).toBeLessThanOrEqual(0.003);
      expect(Math.abs(h - A4.heightPt)).toBeLessThanOrEqual(0.003);
    }

    // One fixable page + one true mismatch → leave the whole document alone.
    const partly = await makePdf([
      [595.28, 841.89],
      [612, 792],
    ]);
    const untouched = await normalizePdfToA4(partly);
    expect(untouched.adjusted).toBe(false);
    expect(untouched.bytes).toBe(partly);
  });

  it("passes unparseable input through unchanged", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await normalizePdfToA4(garbage);
    expect(result.adjusted).toBe(false);
    expect(result.bytes).toBe(garbage);
  });

  it("skips documents over the hard page cap (validation rejects them anyway)", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 189; i++) doc.addPage([595.28, 841.89]);
    const bytes = await doc.save();
    const result = await normalizePdfToA4(bytes);
    expect(result.adjusted).toBe(false);
    expect(result.bytes).toBe(bytes);
  });

  it("refuses pages whose CropBox hides part of the MediaBox", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]);
    // A deliberately smaller visible window — rescaling to a full A4 box
    // would reveal the cropped-away content.
    page.setCropBox(50, 50, 400, 700);
    const bytes = await doc.save();
    const result = await normalizePdfToA4(bytes);
    expect(result.adjusted).toBe(false);
    expect(result.bytes).toBe(bytes);
  });
});
