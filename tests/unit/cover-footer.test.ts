import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCoverPage, prependCoverLetter } from "@/lib/server/pdf/cover-letter";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { A4 } from "@/lib/shared/schablone";
import { de } from "@/lib/i18n/de";

const sender = "Absender GmbH · Weg 1 · 10115 Berlin";
const address = ["Muster GmbH", "Musterstraße 12", "10115 Berlin"];

async function extractPageText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error -- no type declarations for the worker entry; imported
  // solely for its globalThis.pdfjsWorker side effect (see analyze-zones.ts).
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  await doc.destroy();
  return text;
}

describe("cover footer notice", () => {
  it("prints the versendio notice by default", async () => {
    const bytes = await buildCoverPage(sender, address);
    const text = await extractPageText(bytes);
    expect(text).toContain("versendio.de");
  });

  it("omits the notice when footerNotice is false", async () => {
    const bytes = await buildCoverPage(sender, address, { footerNotice: false });
    const text = await extractPageText(bytes);
    expect(text).not.toContain("versendio.de");
    // The structural cover content is unaffected by the opt-out.
    expect(text).toContain("Muster GmbH");
  });

  it("footer text matches the centralized string", () => {
    expect(de.letters.coverFooterText).toContain("versendio.de");
  });

  it("the footer never violates print-free margins or address zones", async () => {
    const original = await PDFDocument.create();
    original.addPage([A4.widthPt, A4.heightPt]);
    const withCover = await prependCoverLetter(await original.save(), sender, address, {
      footerNotice: true,
    });
    const validation = await validateLetterPdf(withCover);
    expect(validation.rules.some((r) => r.id === "margin_zone")).toBe(false);
    expect(validation.rules.some((r) => r.id === "dvf_zone")).toBe(false);
    expect(validation.addressZoneResult).toBe("ok");
  });
});
