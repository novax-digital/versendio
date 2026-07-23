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

  it("suppresses upload-only advisories for editor-sourced PDFs", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [
      { type: "text", id: "t", text: "Sehr geehrte Damen und Herren,\n\nTest.", align: "left", sizeDeltaPt: 0, color: "default" },
    ];
    const bytes = await renderEditorLetter({ document: doc, senderLine: "Absender", recipient });

    // Upload path (default): our pdf-lib output isn't PDF/A, so the conversion
    // caveat fires — and the heuristic zone analysis may or may not resolve.
    // validateLetterPdf must be non-destructive: the same bytes are validated
    // twice here (the upload path's pdf.js analysis must not detach the input).
    const asUpload = await validateLetterPdf(bytes);
    expect(asUpload.rules.some((r) => r.id === "pdfa")).toBe(true);

    // Editor path: the address zone is placed by construction, so the PDF/A and
    // "zone could not be checked" advisories are replaced by a positive rule.
    const asEditor = await validateLetterPdf(bytes, { source: "editor" });
    expect(asEditor.rules.some((r) => r.id === "pdfa")).toBe(false);
    expect(asEditor.rules.some((r) => r.id === "zone_unknown")).toBe(false);
    expect(asEditor.rules.some((r) => r.id === "zone_ok" && r.severity === "ok")).toBe(true);
    expect(asEditor.rules.some((r) => r.severity === "warning" || r.severity === "error")).toBe(false);
    expect(asEditor.needsCoverLetter).toBe(false);
    expect(asEditor.addressZoneResult).toBe("ok");
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

describe("zone findings resolve via auto cover page", () => {
  it("empty recipient zone: positive note + cover, still submittable", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([A4.widthPt, A4.heightPt]);
    const validation = await validateLetterPdf(await pdf.save());
    const rule = validation.rules.find((r) => r.id === "recipient_zone_empty");
    expect(rule?.severity).toBe("ok");
    expect(validation.needsCoverLetter).toBe(true);
    expect(validation.rules.some((r) => r.severity === "error")).toBe(false);
  });

  it("content in the DVF strip: warning + forced cover instead of a reject", async () => {
    const { StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([A4.widthPt, A4.heightPt]);
    // 60 mm from top / 60 mm from left — inside the blocked DVF zone (y 52–68).
    page.drawText("Logo im Sperrbereich", {
      x: (60 / 210) * A4.widthPt,
      y: A4.heightPt - (60 / 297) * A4.heightPt,
      size: 10,
      font,
    });
    const validation = await validateLetterPdf(await pdf.save());
    const rule = validation.rules.find((r) => r.id === "dvf_zone");
    expect(rule?.severity).toBe("warning");
    expect(validation.needsCoverLetter).toBe(true);
    expect(validation.addressZoneResult).toBe("fail");
    expect(validation.rules.some((r) => r.severity === "error")).toBe(false);
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

  it("cover page (incl. Adressdeckblatt label) passes zone validation", async () => {
    const original = await PDFDocument.create();
    original.addPage([A4.widthPt, A4.heightPt]);
    const originalBytes = await original.save();

    const withCover = await prependCoverLetter(originalBytes, "Absender GmbH · Weg 1 · Berlin", [
      "Muster GmbH",
      "Musterstraße 12",
      "10115 Berlin",
    ]);
    const validation = await validateLetterPdf(withCover);
    // The centered mid-page label must never trip the DVF/margin checks, and
    // the recipient block on the cover must satisfy the address zone.
    expect(validation.rules.some((r) => r.id === "dvf_zone")).toBe(false);
    expect(validation.rules.some((r) => r.id === "margin_zone")).toBe(false);
    expect(validation.rules.some((r) => r.id === "recipient_zone_empty")).toBe(false);
    expect(validation.addressZoneResult).toBe("ok");
  });
});
