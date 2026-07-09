import { describe, expect, it } from "vitest";
import { normalizeCountry, validatePostalCode } from "@/lib/shared/postal-code";

describe("normalizeCountry", () => {
  it("defaults to DE", () => {
    expect(normalizeCountry()).toBe("DE");
    expect(normalizeCountry(null)).toBe("DE");
    expect(normalizeCountry("")).toBe("DE");
  });

  it("uppercases and trims two-letter codes", () => {
    expect(normalizeCountry(" de ")).toBe("DE");
    expect(normalizeCountry("ch")).toBe("CH");
  });
});

describe("validatePostalCode", () => {
  it("accepts valid German zips", () => {
    expect(validatePostalCode("10115", "DE")).toBeNull();
    expect(validatePostalCode("01067", "DE")).toBeNull();
  });

  it("rejects invalid German zips with a hint", () => {
    expect(validatePostalCode("1011", "DE")).toContain("Ungültige PLZ");
    expect(validatePostalCode("ABCDE", "DE")).toContain("Ungültige PLZ");
  });

  it("requires a value", () => {
    expect(validatePostalCode("", "DE")).toBe("PLZ erforderlich");
    expect(validatePostalCode("   ", "DE")).toBe("PLZ erforderlich");
  });

  it("validates country-specific formats", () => {
    expect(validatePostalCode("1011 AB", "NL")).toBeNull();
    expect(validatePostalCode("00-001", "PL")).toBeNull();
    expect(validatePostalCode("SW1A 1AA", "GB")).toBeNull();
    expect(validatePostalCode("10115", "AT")).not.toBeNull();
  });

  it("sanity-checks unknown countries only", () => {
    expect(validatePostalCode("12345", "XX")).toBeNull();
    expect(validatePostalCode("!!!", "XX")).not.toBeNull();
  });
});
