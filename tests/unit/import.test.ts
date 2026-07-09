import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "@/lib/shared/search-term";
import { suggestMapping } from "@/lib/shared/import/mapping";
import { validateImportRow, dedupKey } from "@/lib/shared/import/validate-row";
import { parseImportFile } from "@/lib/server/import/parse-file";

describe("suggestMapping", () => {
  it("maps German headers", () => {
    const mapping = suggestMapping(["Anrede", "Vorname", "Nachname", "Firma", "Straße", "PLZ", "Ort", "Land"]);
    expect(mapping[0]).toBe("salutation");
    expect(mapping[1]).toBe("firstName");
    expect(mapping[2]).toBe("lastName");
    expect(mapping[3]).toBe("company");
    expect(mapping[4]).toBe("street");
    expect(mapping[5]).toBe("zip");
    expect(mapping[6]).toBe("city");
    expect(mapping[7]).toBe("country");
  });

  it("maps English headers case-insensitively", () => {
    const mapping = suggestMapping(["First Name", "LAST NAME", "Company", "Street", "ZIP Code", "City"]);
    expect(mapping[0]).toBe("firstName");
    expect(mapping[1]).toBe("lastName");
    expect(mapping[4]).toBe("zip");
  });

  it("leaves unknown headers unmapped and assigns each field once", () => {
    const mapping = suggestMapping(["Nachname", "Name", "Sonstiges"]);
    expect(mapping[0]).toBe("lastName");
    expect(mapping[1]).toBeNull(); // lastName already taken
    expect(mapping[2]).toBeNull();
  });
});

describe("validateImportRow", () => {
  const mapping = { 0: "lastName", 1: "street", 2: "zip", 3: "city", 4: "country" } as const;

  it("accepts a valid row", () => {
    const result = validateImportRow(["Muster", "Weg 1", "10115", "Berlin", "DE"], mapping);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contact.zip).toBe("10115");
      expect(result.contact.country).toBe("DE");
    }
  });

  it("defaults missing country to DE", () => {
    const result = validateImportRow(["Muster", "Weg 1", "10115", "Berlin", ""], mapping);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contact.country).toBe("DE");
  });

  it("collects multiple errors per row", () => {
    const result = validateImportRow(["", "", "123", "", "DE"], mapping);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("validates zip against the row country", () => {
    const at = validateImportRow(["Muster", "Weg 1", "1010", "Wien", "AT"], mapping);
    expect(at.ok).toBe(true);
    const bad = validateImportRow(["Muster", "Weg 1", "10115", "Wien", "AT"], mapping);
    expect(bad.ok).toBe(false);
  });
});

describe("dedupKey", () => {
  it("is case-insensitive and mirrors the DB shape", () => {
    const a = dedupKey({
      salutation: null,
      firstName: "Max",
      lastName: "Mustermann",
      company: null,
      street: "Weg 1",
      addressExtra: null,
      zip: "10115",
      city: "Berlin",
      country: "DE",
      email: null,
    });
    const b = dedupKey({
      salutation: "Herr",
      firstName: "MAX",
      lastName: "mustermann",
      company: null,
      street: "WEG 1",
      addressExtra: "c/o",
      zip: "10115",
      city: "berlin",
      country: "DE",
      email: "x@y.de",
    });
    expect(a).toBe(b);
    expect(a).toBe("max|mustermann||weg 1|10115|berlin");
  });
});

describe("sanitizeSearchTerm", () => {
  it("strips PostgREST-structural characters", () => {
    expect(sanitizeSearchTerm("Mustermann, Max")).toBe("Mustermann Max");
    expect(sanitizeSearchTerm('a(b)"c\'d\\e')).toBe("a b c d e");
  });

  it("escapes LIKE metacharacters", () => {
    expect(sanitizeSearchTerm("100%_test")).toBe("100\\%\\_test");
  });

  it("trims and collapses whitespace", () => {
    expect(sanitizeSearchTerm("  Max   Muster  ")).toBe("Max Muster");
  });
});

describe("parseImportFile (CSV)", () => {
  const parse = (text: string, name = "test.csv") =>
    parseImportFile(new TextEncoder().encode(text), name);

  it("parses comma-separated with header", async () => {
    const table = await parse("Nachname,PLZ\nMuster,10115\nBeispiel,80331");
    expect(table.headers).toEqual(["Nachname", "PLZ"]);
    expect(table.rows).toEqual([
      ["Muster", "10115"],
      ["Beispiel", "80331"],
    ]);
  });

  it("guesses semicolon delimiter (German Excel default)", async () => {
    const table = await parse("Nachname;PLZ;Ort\nMuster;10115;Berlin");
    expect(table.headers).toEqual(["Nachname", "PLZ", "Ort"]);
    expect(table.rows[0]).toEqual(["Muster", "10115", "Berlin"]);
  });

  it("strips a UTF-8 BOM", async () => {
    const table = await parse("﻿Nachname,PLZ\nMuster,10115");
    expect(table.headers[0]).toBe("Nachname");
  });

  it("skips empty lines", async () => {
    const table = await parse("A,B\n\n1,2\n\n");
    expect(table.rows).toEqual([["1", "2"]]);
  });
});
