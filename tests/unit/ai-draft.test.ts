import { describe, expect, it } from "vitest";
import { stripUnknownTokens } from "@/lib/server/ai/draft-provider";

describe("stripUnknownTokens", () => {
  it("never corrupts ordinary text containing digits", () => {
    const input = "Zahlbar innerhalb von 0 Tagen, {{anrede}} {{nachname}}.";
    expect(stripUnknownTokens(input)).toBe(input);
  });

  it("removes invented tokens and normalizes known ones", () => {
    expect(stripUnknownTokens("Hallo {{ Anrede }} {{datum}} {{unterschrift}}!")).toBe(
      "Hallo {{anrede}}  !",
    );
  });

  it("keeps text without tokens untouched", () => {
    expect(stripUnknownTokens("Anlage 1, Seite 2 von 3")).toBe("Anlage 1, Seite 2 von 3");
  });
});
