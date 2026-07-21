import "server-only";
import { A4, ZONES, MARGINS, type ZoneMm } from "@/lib/shared/schablone";

export type ZoneAnalysis = {
  available: boolean; // false when analysis could not run (parser error)
  dvfViolation: boolean; // text inside the DVF blocked zone (hard reject)
  marginViolation: boolean; // text inside the print-free margins/left strip
  recipientZoneHasText: boolean; // recipient block appears populated
};

type TextItemBox = { xMm: number; yMm: number; wMm: number; hMm: number };

const PT_TO_MM = 25.4 / 72;

function intersects(a: TextItemBox, z: ZoneMm): boolean {
  const ax2 = a.xMm + a.wMm;
  const ay2 = a.yMm + a.hMm;
  const zx2 = z.x + z.width;
  const zy2 = z.y + z.height;
  return a.xMm < zx2 && ax2 > z.x && a.yMm < zy2 && ay2 > z.y;
}

/**
 * Extracts positioned text from page 1 with pdf.js and reports whether any text
 * falls into the Schablone V3 blocked/margin zones. This is the real
 * Sperrflächen check (ADR-0006). Images are not covered — the DVF barcode area
 * is text-dominated, and the API remains the final authority. Falls back to
 * `available:false` if the parser cannot process the file, in which case the
 * caller recommends a cover letter rather than asserting the layout is clean.
 */
export async function analyzeAddressZones(bytes: Uint8Array): Promise<ZoneAnalysis> {
  const empty: ZoneAnalysis = {
    available: false,
    dvfViolation: false,
    marginViolation: false,
    recipientZoneHasText: false,
  };

  try {
    // Legacy build runs in Node without a worker/canvas. The worker MODULE must
    // still be imported statically: pdf.js's "fake worker" otherwise tries a
    // dynamic import of pdf.worker.mjs, which bundlers (Turbopack/webpack)
    // cannot resolve at runtime — the import below registers
    // globalThis.pdfjsWorker, which the fake-worker setup picks up first.
    // Without it EVERY analysis failed and uploads fell back to "zone unknown".
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error -- no type declarations for the worker entry; imported
    // solely for its globalThis.pdfjsWorker side effect.
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const loadingTask = pdfjs.getDocument({
      // Copy: pdf.js takes ownership of `data` and detaches its buffer. Passing
      // the caller's array directly would leave validateLetterPdf's input empty
      // for any later use (the upload path reuses these bytes to store the PDF).
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    });
    const doc = await loadingTask.promise;
    if (doc.numPages < 1) {
      await doc.destroy();
      return { ...empty, available: true };
    }

    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    // pdf.js y-origin is bottom-left; the Schablone uses top-left.
    const pageHeightPt = viewport.height;
    const textContent = await page.getTextContent();

    const result: ZoneAnalysis = {
      available: true,
      dvfViolation: false,
      marginViolation: false,
      recipientZoneHasText: false,
    };

    const leftStrip: ZoneMm = { x: 0, y: 0, width: MARGINS.leftStripMm, height: A4.heightMm };
    const topMargin: ZoneMm = { x: 0, y: 0, width: A4.widthMm, height: MARGINS.topMm };
    const rightMargin: ZoneMm = {
      x: A4.widthMm - MARGINS.rightMm,
      y: 0,
      width: MARGINS.rightMm,
      height: A4.heightMm,
    };
    const bottomMargin: ZoneMm = {
      x: 0,
      y: A4.heightMm - MARGINS.bottomMm,
      width: A4.widthMm,
      height: MARGINS.bottomMm,
    };
    const marginZones = [leftStrip, topMargin, rightMargin, bottomMargin];

    for (const item of textContent.items) {
      if (!("transform" in item) || !("str" in item) || item.str.trim() === "") continue;
      const transform = item.transform as number[];
      const xPt = transform[4];
      const yPtBottom = transform[5];
      const widthPt = "width" in item ? (item.width as number) : 0;
      const heightPt = "height" in item ? (item.height as number) : Math.abs(transform[3]) || 8;

      const box: TextItemBox = {
        xMm: xPt * PT_TO_MM,
        // convert bottom-left origin to top-left
        yMm: (pageHeightPt - yPtBottom - heightPt) * PT_TO_MM,
        wMm: widthPt * PT_TO_MM,
        hMm: heightPt * PT_TO_MM,
      };

      if (intersects(box, ZONES.dvfBlocked)) result.dvfViolation = true;
      if (marginZones.some((z) => intersects(box, z))) result.marginViolation = true;
      if (intersects(box, ZONES.recipient)) result.recipientZoneHasText = true;
    }

    await doc.destroy();
    return result;
  } catch (err) {
    console.error("zone_analysis_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return empty;
  }
}
