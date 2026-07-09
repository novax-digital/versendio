import { describe, expect, it } from "vitest";
import {
  hasPlaceholders,
  extractPlaceholders,
  resolvePlaceholders,
  unknownPlaceholders,
} from "@/lib/shared/placeholders";

describe("placeholders", () => {
  it("detects placeholders", () => {
    expect(hasPlaceholders("Hallo {{vorname}}")).toBe(true);
    expect(hasPlaceholders("Kein Platzhalter")).toBe(false);
  });

  it("extracts distinct keys, case-insensitive", () => {
    expect(extractPlaceholders("{{Vorname}} {{nachname}} {{vorname}}")).toEqual([
      "vorname",
      "nachname",
    ]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(extractPlaceholders("{{ firma }}")).toEqual(["firma"]);
  });

  it("resolves known placeholders and blanks unknown/empty", () => {
    const ctx = { vorname: "Max", nachname: "Mustermann", firma: null };
    expect(resolvePlaceholders("Sehr geehrter {{vorname}} {{nachname}}", ctx)).toBe(
      "Sehr geehrter Max Mustermann",
    );
    expect(resolvePlaceholders("{{firma}}!", ctx)).toBe("!");
    expect(resolvePlaceholders("{{unbekannt}}", ctx)).toBe("");
  });

  it("flags unknown placeholders", () => {
    expect(unknownPlaceholders("{{vorname}} {{quatsch}}")).toEqual(["quatsch"]);
    expect(unknownPlaceholders("{{vorname}} {{ort}}")).toEqual([]);
  });
});
