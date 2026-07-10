import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  emptyLetterDocument,
  parseLetterDocument,
  type LetterDocument,
} from "@/lib/shared/letter-document";
import { CONTENT, LEGACY_LINE_MM_AT_11PT, lineAdvanceMm, resolveTextStyle, subjectSizePt } from "@/lib/shared/letter-style";
import { renderEditorLetter } from "@/lib/server/pdf/render-editor";
import { findUnsupportedChars } from "@/lib/server/pdf/fonts";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { buildRecipientAddressLines, toPlaceholderContext } from "@/lib/shared/address";

const recipient = () => {
  const addr = {
    salutation: "Frau",
    firstName: "Erika",
    lastName: "Mustermann",
    company: null,
    street: "Musterstraße 12",
    zip: "10115",
    city: "Berlin",
    country: "DE",
  };
  return {
    addressLines: buildRecipientAddressLines(addr),
    placeholders: toPlaceholderContext(addr),
  };
};

const render = (document: LetterDocument) =>
  renderEditorLetter({ document, senderLine: "Muster GmbH · Weg 1 · 10115 Berlin", recipient: recipient() });

describe("letter document v1 → v2 migration", () => {
  const v1Doc = {
    version: 1,
    logoStoragePath: null,
    showDate: true,
    senderAddressId: null,
    blocks: [
      { type: "subject", id: "s", text: "Ihre Rechnung" },
      { type: "text", id: "t", text: "Sehr geehrte Damen und Herren,\nvielen Dank." },
      { type: "spacer", id: "sp", heightMm: 10 },
    ],
  };

  it("upgrades v1 documents with frozen legacy metrics", () => {
    const doc = parseLetterDocument(v1Doc);
    expect(doc.version).toBe(2);
    expect(doc.theme.legacyLayout).toBe(true);
    expect(doc.theme.fontFamily).toBe("helvetica");
    // Legacy metrics reproduce the v1 renderer exactly: 4.6mm line advance,
    // subject at body size — pagination (and price) must not change.
    expect(lineAdvanceMm(11, doc.theme)).toBeCloseTo(LEGACY_LINE_MM_AT_11PT, 10);
    expect(subjectSizePt(doc.theme)).toBe(11);
    expect(doc.blocks).toHaveLength(3);
  });

  it("parses v2 documents unchanged and rejects garbage", () => {
    const v2 = emptyLetterDocument();
    expect(parseLetterDocument(v2)).toEqual(v2);
    expect(() => parseLetterDocument({ version: 3 })).toThrow();
    expect(() => parseLetterDocument(null)).toThrow();
  });

  it("keeps v1 pagination identical after the upgrade (differential vs v1 math)", async () => {
    // 120 one-line paragraphs — enough for 3 pages under v1 metrics.
    const lines = Array.from({ length: 120 }, (_, i) => `Zeile ${i + 1}`).join("\n");
    const doc = parseLetterDocument({
      version: 1,
      logoStoragePath: null,
      showDate: false,
      senderAddressId: null,
      blocks: [{ type: "text", id: "t", text: lines }],
    });

    // Reference implementation of the v1 cursor math (render-editor.ts@v1).
    let cursor = CONTENT.bodyStartMm;
    let pages = 1;
    for (let i = 0; i < 120; i++) {
      if (cursor + LEGACY_LINE_MM_AT_11PT > CONTENT.bottomMm) {
        pages += 1;
        cursor = CONTENT.followTopMm;
      }
      cursor += LEGACY_LINE_MM_AT_11PT;
    }

    const pdf = await PDFDocument.load(await render(doc));
    expect(pdf.getPageCount()).toBe(pages);
  });

  it("does not add a blank page for a trailing spacer", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [
      { type: "text", id: "t", text: "Kurzer Brief", align: "left", sizeDeltaPt: 0, color: "default" },
      { type: "spacer", id: "sp", heightMm: 120 },
      { type: "spacer", id: "sp2", heightMm: 120 },
    ];
    const pdf = await PDFDocument.load(await render(doc));
    expect(pdf.getPageCount()).toBe(1);
  });
});

describe("styled rendering (v2)", () => {
  it.each(["helvetica", "lato", "poppins", "ptserif"] as const)(
    "renders a styled letter with %s and passes validation",
    async (fontFamily) => {
      const doc = emptyLetterDocument();
      doc.theme = { ...doc.theme, fontFamily, accentColor: "#0E9F6E" };
      doc.blocks = [
        { type: "subject", id: "s", text: "Einladung zum Sommerfest", align: "left", color: "accent" },
        { type: "heading", id: "h", text: "Alle Details auf einen Blick", level: 1, align: "center", color: "default" },
        { type: "divider", id: "d", widthPct: 60, thicknessPt: 1, color: "accent" },
        { type: "text", id: "t", text: "Sehr geehrte Frau {{nachname}},\nwir freuen uns auf Sie.", align: "left", sizeDeltaPt: 1, color: "default" },
      ];
      const bytes = await render(doc);
      const validation = await validateLetterPdf(bytes);
      expect(validation.pageCount).toBe(1);
      expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
    },
  );

  it("clamps an overlong centered heading into the content column", async () => {
    const doc = emptyLetterDocument();
    doc.blocks = [
      {
        type: "heading",
        id: "h",
        text: "Sehr lange Überschrift ".repeat(20),
        level: 1,
        align: "center",
        color: "default",
      },
    ];
    const bytes = await render(doc);
    const validation = await validateLetterPdf(bytes);
    // Wrapped instead of overflowing: no error rules, still submittable.
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
  });

  it("scales an oversized image into the page capacity", async () => {
    // 1×4 px PNG at 180mm width → 720mm tall: must be clamped to one page's
    // capacity (never painted into the bottom margin) and moved to page 2.
    const png = buildTallPng(1, 4);
    const doc = emptyLetterDocument();
    doc.blocks = [
      { type: "image", id: "i", storagePath: "x/y.png", widthMm: 180, align: "center" },
    ];
    const bytes = await renderEditorLetter({
      document: doc,
      senderLine: "S",
      recipient: recipient(),
      loadImage: async () => ({ bytes: png, mime: "image/png" }),
    });
    const validation = await validateLetterPdf(bytes);
    expect(validation.pageCount).toBe(2);
    expect(validation.rules.filter((r) => r.severity === "error")).toEqual([]);
  });
});

describe("font glyph coverage", () => {
  it("flags characters helvetica cannot print", async () => {
    const missing = await findUnsupportedChars("helvetica", "Grüße 日本 – ok");
    expect(missing).toContain("日");
    expect(missing).not.toContain("ü");
    // en dash is transliterated, not lost
    expect(missing).not.toContain("–");
  });

  it("accepts German text for embedded fonts and flags emoji", async () => {
    expect(await findUnsupportedChars("lato", "Grüße äöüß €")).toEqual([]);
    expect(await findUnsupportedChars("poppins", "Fest 🎉")).toContain("🎉");
  });
});

describe("style resolution", () => {
  it("derives heading sizes and colors from the theme", () => {
    const theme = emptyLetterDocument().theme;
    const style = resolveTextStyle(
      { type: "heading", id: "h", text: "x", level: 1, align: "left", color: "accent" },
      { ...theme, accentColor: "#123456" },
    );
    expect(style.sizePt).toBe(17);
    expect(style.bold).toBe(true);
    expect(style.colorHex).toBe("#123456");
  });
});

/** Hand-rolled grayscale PNG (node zlib) so the test needs no image deps. */
function buildTallPng(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const scanlines = Buffer.alloc(height * (width + 1), 0xcc);
  for (let y = 0; y < height; y++) scanlines[y * (width + 1)] = 0; // filter byte
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return Uint8Array.from(png);
}

describe("v1 fidelity regressions (review findings)", () => {
  it("consecutive spacers crossing a page boundary paginate exactly like v1", async () => {
    // v1: first spacer breaks the page, the SECOND advances the new page's
    // cursor (17→47mm) — the chain must not be merged into one deferral.
    const text36 = Array.from({ length: 36 }, (_, i) => `Z${i}`).join("\n"); // cursor 95+36*4.6=260.6
    const text51 = Array.from({ length: 51 }, (_, i) => `Y${i}`).join("\n"); // 51*4.6=234.6 from 47 → 281.6 > 277 → 3rd page
    const doc = parseLetterDocument({
      version: 1,
      logoStoragePath: null,
      showDate: false,
      senderAddressId: null,
      blocks: [
        { type: "text", id: "a", text: text36 },
        { type: "spacer", id: "s1", heightMm: 30 },
        { type: "spacer", id: "s2", heightMm: 30 },
        { type: "text", id: "b", text: text51 },
      ],
    });
    const pdf = await PDFDocument.load(await render(doc));
    expect(pdf.getPageCount()).toBe(3);
  });

  it("legacy subject reserves 7.6mm before a page break exactly like v1", async () => {
    // 38 lines put the cursor at 269.8mm; v1's ensureSpace(4.6+3) pushes the
    // subject to page 2. Reserving only 4.6mm would keep it on page 1.
    const text38 = Array.from({ length: 38 }, (_, i) => `Z${i}`).join("\n");
    const doc = parseLetterDocument({
      version: 1,
      logoStoragePath: null,
      showDate: false,
      senderAddressId: null,
      blocks: [
        { type: "text", id: "a", text: text38 },
        { type: "subject", id: "s", text: "Betreff am Seitenende" },
      ],
    });
    const pdf = await PDFDocument.load(await render(doc));
    expect(pdf.getPageCount()).toBe(2);
  });
});
