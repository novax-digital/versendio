import { describe, expect, it } from "vitest";
import { stripUnknownTokens, toDraftBlocks } from "@/lib/server/ai/draft-provider";

describe("stripUnknownTokens", () => {
  it("never corrupts ordinary text containing digits", () => {
    const input = "Zahlbar innerhalb von 0 Tagen, {{anrede}} {{nachname}}.";
    expect(stripUnknownTokens(input)).toBe(input);
  });

  it("removes invented tokens and normalizes known ones", () => {
    expect(stripUnknownTokens("Hallo {{ Anrede }} {{betrag}} {{unterschrift}}!")).toBe(
      "Hallo {{anrede}}  !",
    );
  });

  it("keeps {{datum}} — it resolves to the send date at render time", () => {
    expect(stripUnknownTokens("Stand: {{ Datum }}")).toBe("Stand: {{datum}}");
  });

  it("keeps text without tokens untouched", () => {
    expect(stripUnknownTokens("Anlage 1, Seite 2 von 3")).toBe("Anlage 1, Seite 2 von 3");
  });
});

describe("toDraftBlocks", () => {
  it("maps module types to editor block kinds", () => {
    expect(
      toDraftBlocks([
        { typ: "absatz", text: "Guten Tag," },
        { typ: "ueberschrift", text: "Abschnitt" },
        { typ: "trenner" },
        { typ: "absatz", text: "Mit freundlichen Grüßen" },
      ]),
    ).toEqual([
      { kind: "paragraph", text: "Guten Tag," },
      { kind: "heading", text: "Abschnitt" },
      { kind: "divider" },
      { kind: "paragraph", text: "Mit freundlichen Grüßen" },
    ]);
  });

  it("strips unknown tokens and drops paragraphs empty after stripping", () => {
    expect(
      toDraftBlocks([
        { typ: "absatz", text: "Hallo {{anrede}} {{betrag}}" },
        { typ: "absatz", text: "{{unterschrift}}" },
      ]),
    ).toEqual([{ kind: "paragraph", text: "Hallo {{anrede}}" }]);
  });

  it("trims leading and trailing structural blocks", () => {
    expect(
      toDraftBlocks([
        { typ: "abstand" },
        { typ: "trenner" },
        { typ: "absatz", text: "Kern" },
        { typ: "trenner" },
        { typ: "abstand" },
      ]),
    ).toEqual([{ kind: "paragraph", text: "Kern" }]);
  });
});
