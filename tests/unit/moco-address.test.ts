import { describe, expect, it } from "vitest";
import { parseMocoRecipientAddress } from "@/lib/shared/moco-address";
import { isValidMocoSubdomain } from "@/lib/server/moco/client";
import { contactSchema } from "@/lib/shared/schemas/contact";

describe("parseMocoRecipientAddress", () => {
  it("parses a standard German block", () => {
    const result = parseMocoRecipientAddress(
      "Beispiel GmbH\r\nMusterstraße 12\r\n10115 Berlin",
    );
    expect(result).toEqual({
      ok: true,
      recipient: {
        company: "Beispiel GmbH",
        addressExtra: null,
        street: "Musterstraße 12",
        zip: "10115",
        city: "Berlin",
        country: "DE",
      },
    });
  });

  it("parses a Swiss block with 4-digit zip and country line", () => {
    const result = parseMocoRecipientAddress(
      "Beispiel AG\nBeispielstrasse 123\n8000 Zürich\nSchweiz",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.zip).toBe("8000");
      expect(result.recipient.city).toBe("Zürich");
      expect(result.recipient.country).toBe("CH");
    }
  });

  it("keeps intermediate lines as address extra", () => {
    const result = parseMocoRecipientAddress(
      "Muster AG\nz. Hd. Frau Beispiel\nRechnungswesen\nHauptstraße 1\n50667 Köln",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.addressExtra).toBe("z. Hd. Frau Beispiel, Rechnungswesen");
      expect(result.recipient.street).toBe("Hauptstraße 1");
    }
  });

  it("understands historic country prefixes (CH-8000)", () => {
    const result = parseMocoRecipientAddress("Muster AG\nWeg 2\nCH-8000 Zürich");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.country).toBe("CH");
      expect(result.recipient.zip).toBe("8000");
    }
  });

  it("parses Dutch zip formats", () => {
    const result = parseMocoRecipientAddress("Voorbeeld BV\nStraat 1\n1011 AB Amsterdam\nNL");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.zip).toBe("1011 AB");
      expect(result.recipient.country).toBe("NL");
    }
  });

  it("uses the fallback country when the block has none", () => {
    const result = parseMocoRecipientAddress("Muster AG\nWeg 2\n4051 Basel", "CH");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipient.country).toBe("CH");
  });

  it("fails loudly on blocks without a zip/city line", () => {
    const result = parseMocoRecipientAddress("Muster AG\nIrgendwo\nOhne Postleitzahl");
    expect(result).toEqual({ ok: false, reason: "no_zip_city_line" });
  });

  it("fails on too-short blocks instead of guessing", () => {
    expect(parseMocoRecipientAddress("10115 Berlin")).toEqual({
      ok: false,
      reason: "too_few_lines",
    });
    expect(parseMocoRecipientAddress("")).toEqual({ ok: false, reason: "empty" });
  });

  it("never mistakes a house number for the zip (bottom-up search)", () => {
    const result = parseMocoRecipientAddress("Firma 2000 GmbH\nStraße 12345 b\n80331 München");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.zip).toBe("80331");
      expect(result.recipient.street).toBe("Straße 12345 b");
    }
  });

  it("caps addressExtra to the contact-schema limit (Zod rejects, never truncates)", () => {
    const longDept = "Abteilung " + "sehr ".repeat(40) + "lang";
    const result = parseMocoRecipientAddress(
      `Muster AG\n${longDept}\nHauptstraße 1\n50667 Köln`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.addressExtra!.length).toBeLessThanOrEqual(120);
      const check = contactSchema.safeParse({
        company: result.recipient.company,
        addressExtra: result.recipient.addressExtra ?? undefined,
        street: result.recipient.street,
        zip: result.recipient.zip,
        city: result.recipient.city,
        country: result.recipient.country,
      });
      expect(check.success).toBe(true);
    }
  });

  it("produces output that satisfies the pipeline contact schema", () => {
    const result = parseMocoRecipientAddress("Beispiel GmbH\nMusterstraße 12\n10115 Berlin");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const check = contactSchema.safeParse({
        company: result.recipient.company,
        street: result.recipient.street,
        zip: result.recipient.zip,
        city: result.recipient.city,
        country: result.recipient.country,
      });
      expect(check.success).toBe(true);
    }
  });
});

describe("isValidMocoSubdomain", () => {
  it("accepts plain account labels", () => {
    expect(isValidMocoSubdomain("acme")).toBe(true);
    expect(isValidMocoSubdomain("acme-2")).toBe(true);
  });

  it("rejects anything that could redirect the API host (SSRF)", () => {
    expect(isValidMocoSubdomain("acme.evil.com")).toBe(false);
    expect(isValidMocoSubdomain("evil.com/path")).toBe(false);
    expect(isValidMocoSubdomain("")).toBe(false);
    expect(isValidMocoSubdomain("-acme")).toBe(false);
    expect(isValidMocoSubdomain("acme mocoapp")).toBe(false);
  });
});
