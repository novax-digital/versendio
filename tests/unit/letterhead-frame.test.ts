import { describe, expect, it } from "vitest";
import {
  emptyLetterDocument,
  parseLetterDocument,
  type LetterDocument,
} from "@/lib/shared/letter-document";
import { buildDateLine, formatLetterDate } from "@/lib/shared/placeholders";
import {
  CONTENT,
  DIN_CONTENT,
  LETTERHEAD,
  contentFrame,
  dividerMetrics,
} from "@/lib/shared/letter-style";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { ZONES } from "@/lib/shared/schablone";

const recipient = () => ({
  addressLines: ["Muster GmbH", "Frau Erika Mustermann", "Musterstraße 12", "10115 Berlin"],
  placeholders: { nachname: "Mustermann", firma: "Muster GmbH" },
});

const render = (document: LetterDocument) =>
  renderEditorLetter({
    document,
    senderLine: "Muster GmbH · Weg 1 · 10115 Berlin",
    recipient: recipient(),
  });

describe("content frame (marginStyle)", () => {
  it("stored v2 documents without marginStyle keep the classic frame (price freeze)", () => {
    const doc = parseLetterDocument({
      version: 2,
      blocks: [{ type: "text", id: "t", text: "Hallo" }],
    });
    expect(doc.theme.marginStyle).toBe("classic");
    expect(contentFrame(doc.theme)).toBe(CONTENT);
    // header/footer default to empty — rendering is unchanged.
    expect(doc.header).toEqual({ text: "", logoAlign: "left" });
    expect(doc.footer).toEqual({ text: "" });
  });

  it("new documents use the DIN 5008 frame aligned with the address block", () => {
    const doc = emptyLetterDocument();
    expect(doc.theme.marginStyle).toBe("din");
    const frame = contentFrame(doc.theme);
    expect(frame).toBe(DIN_CONTENT);
    // Body text aligns with the printed address (zone x23 + 2mm inset = 25mm).
    expect(frame.leftMm).toBe(ZONES.recipient.x + 2);
    expect(frame.rightMm).toBe(190); // 20mm right margin
    expect(frame.widthMm).toBe(165);
    // Body starts below the date line (92–95.5mm band); other vertical
    // pagination metrics are identical to the classic frame.
    expect(frame.bodyStartMm).toBe(100);
    expect(frame.followTopMm).toBe(CONTENT.followTopMm);
    expect(frame.bottomMm).toBe(CONTENT.bottomMm);
  });

  it("v1 documents stay on the classic frame after upgrade", () => {
    const doc = parseLetterDocument({
      version: 1,
      blocks: [{ type: "text", id: "t", text: "Hallo" }],
    });
    expect(doc.theme.legacyLayout).toBe(true);
    expect(doc.theme.marginStyle).toBe("classic");
  });

  it("divider width follows the active frame", () => {
    const din = emptyLetterDocument().theme;
    const classic = { ...din, marginStyle: "classic" as const };
    const block = { type: "divider", id: "d", widthPct: 100, thicknessPt: 0.75, color: "muted" } as const;
    expect(dividerMetrics(block, din).widthMm).toBe(DIN_CONTENT.widthMm);
    expect(dividerMetrics(block, classic).widthMm).toBe(CONTENT.widthMm);
  });

  it("a DIN-frame letter renders valid (no error rules)", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [
      { type: "subject", id: "s", text: "Einladung zum Sommerfest", align: "left", color: "accent" },
      { type: "text", id: "t", text: "Sehr geehrte Frau {{nachname}},\n\nwir laden Sie herzlich ein.", align: "left", sizeDeltaPt: 0, color: "default" },
      { type: "divider", id: "d", widthPct: 100, thicknessPt: 0.75, color: "muted" },
    ];
    const validation = await validateLetterPdf(await render(doc));
    expect(validation.pageCount).toBe(1);
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
  });
});

describe("header/footer (Briefpapier)", () => {
  it("header and footer render valid and never touch the blocked zones", async () => {
    const doc = emptyLetterDocument();
    doc.header = {
      text: "Muster GmbH\nEschenweg 1\n30655 Hannover\nTel. 0511 123456\ninfo@muster.de",
      logoAlign: "left",
    };
    doc.footer = {
      text: "Muster GmbH · Sitz Hannover · Amtsgericht Hannover HRB 12345\nIBAN DE00 0000 0000 0000 0000 00 · Geschäftsführer: Max Muster",
    };
    doc.blocks = [
      { type: "subject", id: "s", text: "Betreff", align: "left", color: "default" },
      { type: "text", id: "t", text: "Text", align: "left", sizeDeltaPt: 0, color: "default" },
    ];
    const validation = await validateLetterPdf(await render(doc));
    expect(validation.pageCount).toBe(1);
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
    expect(validation.addressZoneResult).not.toBe("fail");
  });

  it("an overlong header is clamped to the band and stays out of the DVF zone", async () => {
    const doc = emptyLetterDocument();
    doc.header = {
      text: Array.from({ length: 30 }, (_, i) => `Kopfzeile ${i + 1}`).join("\n"),
      logoAlign: "left",
    };
    const validation = await validateLetterPdf(await render(doc));
    // DVF violation would be a hard error — the clamp must prevent it.
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
  });

  it("header/footer never change pagination (fixed bands outside the body flow)", async () => {
    const base = emptyLetterDocument();
    base.blocks = Array.from({ length: 90 }, (_, i) => ({
      type: "text" as const,
      id: `p${i}`,
      text: `Absatz ${i + 1}`,
      align: "left" as const,
      sizeDeltaPt: 0,
      color: "default" as const,
    }));
    const plain = await validateLetterPdf(await render(base));

    const decorated = parseLetterDocument({
      ...base,
      header: { text: "Muster GmbH\nKontakt", logoAlign: "left" },
      footer: { text: "Fußzeile mit Firmenangaben" },
    });
    const withChrome = await validateLetterPdf(await render(decorated));
    expect(withChrome.pageCount).toBe(plain.pageCount);
    expect(withChrome.sheetCountSimplex).toBe(plain.sheetCountSimplex);
  });

  it("date line: formats, place prefix, and backward-compatible defaults", () => {
    const date = new Date(2026, 6, 13); // 13.07.2026
    expect(formatLetterDate(date, "short")).toBe("13.07.2026");
    expect(formatLetterDate(date, "long")).toBe("13. Juli 2026");
    expect(buildDateLine("short", true, "Hannover", date)).toBe("Hannover, 13.07.2026");
    expect(buildDateLine("long", true, "  ", date)).toBe("13. Juli 2026"); // blank city → no prefix
    expect(buildDateLine("short", false, "Hannover", date)).toBe("13.07.2026");
    // Stored documents without the new fields keep today's rendering.
    const doc = parseLetterDocument({ version: 2, blocks: [] });
    expect(doc.dateStyle).toBe("short");
    expect(doc.dateWithPlace).toBe(false);
  });

  it("footer band sits below the body flow and above the print-free margin", () => {
    const footerEndMm =
      LETTERHEAD.footer.topMm + LETTERHEAD.footer.maxLines * LETTERHEAD.footer.lineMm;
    expect(LETTERHEAD.footer.topMm).toBeGreaterThanOrEqual(CONTENT.bottomMm + 2);
    expect(footerEndMm).toBeLessThan(295); // 297 - 2mm margin
    const headerEndMm =
      LETTERHEAD.header.topMm + LETTERHEAD.header.maxLines * LETTERHEAD.header.lineMm;
    expect(headerEndMm).toBeLessThan(ZONES.senderLine.y); // above the sender zone
  });
});
