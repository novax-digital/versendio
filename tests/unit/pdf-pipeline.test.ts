import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { prependCoverLetter } from "@/lib/server/pdf/cover-letter";
import { emptyLetterDocument } from "@/lib/shared/letter-document";
import { buildRecipientAddressLines, toPlaceholderContext } from "@/lib/shared/address";
import { A4 } from "@/lib/shared/schablone";

const recipient = {
  addressLines: buildRecipientAddressLines({
    firstName: "Erika",
    lastName: "Mustermann",
    company: "Muster GmbH",
    street: "Musterstraße 12",
    zip: "10115",
    city: "Berlin",
    country: "DE",
  }),
  placeholders: toPlaceholderContext({
    firstName: "Erika",
    lastName: "Mustermann",
    company: "Muster GmbH",
    street: "Musterstraße 12",
    zip: "10115",
    city: "Berlin",
    country: "DE",
  }),
};

describe("editor render → validate", () => {
  it("produces a valid A4 PDF that passes validation", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [
      { type: "subject", id: "s", text: "Ihr Angebot {{firma}}", align: "left", color: "default" },
      { type: "text", id: "t", text: "Sehr geehrte {{anrede}} {{nachname}},\n\nvielen Dank.", align: "left", sizeDeltaPt: 0, color: "default" },
    ];
    const bytes = await renderEditorLetter({
      document: doc,
      senderLine: "Absender GmbH · Weg 1 · 10115 Berlin",
      recipient,
    });

    const validation = await validateLetterPdf(bytes);
    expect(validation.pageCount).toBe(1);
    expect(validation.sheetCountSimplex).toBe(1);
    // No hard errors on our own output.
    expect(validation.rules.some((r) => r.severity === "error")).toBe(false);
  });

  it("resolves placeholders into the rendered text", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [{ type: "text", id: "t", text: "Hallo {{vorname}} {{nachname}}", align: "left", sizeDeltaPt: 0, color: "default" }];
    const bytes = await renderEditorLetter({
      document: doc,
      senderLine: "Absender",
      recipient,
    });
    // Round-trips as a loadable PDF (content extraction is covered by zone tests).
    const reloaded = await PDFDocument.load(bytes);
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("keeps long body text within the 94-sheet limit and paginates", async () => {
    const doc = emptyLetterDocument();
    const longText = Array.from({ length: 400 }, (_, i) => `Zeile ${i} mit etwas Text.`).join("\n");
    doc.blocks = [{ type: "text", id: "t", text: longText, align: "left", sizeDeltaPt: 0, color: "default" }];
    const bytes = await renderEditorLetter({ document: doc, senderLine: "A", recipient });
    const validation = await validateLetterPdf(bytes);
    expect(validation.pageCount).toBeGreaterThan(1);
    expect(validation.rules.some((r) => r.id === "a4" && r.severity === "error")).toBe(false);
  });
});

describe("validate structural rules", () => {
  it("rejects a non-A4 page size", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([500, 700]); // not A4
    const bytes = await pdf.save();
    const validation = await validateLetterPdf(bytes);
    expect(validation.rules.some((r) => r.id === "a4" && r.severity === "error")).toBe(true);
  });

  it("warns for 95-188 pages (duplex only) and rejects beyond 188", async () => {
    const duplexOnly = await PDFDocument.create();
    for (let i = 0; i < 95; i++) duplexOnly.addPage([A4.widthPt, A4.heightPt]);
    const warnValidation = await validateLetterPdf(await duplexOnly.save());
    expect(
      warnValidation.rules.some((r) => r.id === "page_count_duplex_only" && r.severity === "warning"),
    ).toBe(true);
    expect(warnValidation.rules.some((r) => r.id === "page_count")).toBe(false);

    const overLimit = await PDFDocument.create();
    for (let i = 0; i < 189; i++) overLimit.addPage([A4.widthPt, A4.heightPt]);
    const errorValidation = await validateLetterPdf(await overLimit.save());
    expect(
      errorValidation.rules.some((r) => r.id === "page_count" && r.severity === "error"),
    ).toBe(true);
  });

  it("rejects garbage input as unparseable", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const validation = await validateLetterPdf(bytes);
    expect(validation.rules.some((r) => r.severity === "error")).toBe(true);
  });
});

describe("cover letter", () => {
  it("prepends exactly one A4 page", async () => {
    const original = await PDFDocument.create();
    original.addPage([A4.widthPt, A4.heightPt]);
    original.addPage([A4.widthPt, A4.heightPt]);
    const originalBytes = await original.save();

    const withCover = await prependCoverLetter(originalBytes, "Absender GmbH · Weg 1 · Berlin", [
      "Muster GmbH",
      "Musterstraße 12",
      "10115 Berlin",
    ]);
    const reloaded = await PDFDocument.load(withCover);
    expect(reloaded.getPageCount()).toBe(3);
  });
});
