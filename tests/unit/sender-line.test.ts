import { describe, expect, it } from "vitest";
import { buildSenderLine } from "@/lib/shared/schemas/profile";

describe("buildSenderLine", () => {
  it("prefers the company name", () => {
    expect(
      buildSenderLine({
        company: "Muster GmbH",
        firstName: "Max",
        lastName: "Mustermann",
        street: "Musterstraße 1",
        zip: "10115",
        city: "Berlin",
      }),
    ).toBe("Muster GmbH · Musterstraße 1 · 10115 Berlin");
  });

  it("falls back to person name", () => {
    expect(
      buildSenderLine({
        firstName: "Max",
        lastName: "Mustermann",
        street: "Musterstraße 1",
        zip: "10115",
        city: "Berlin",
      }),
    ).toBe("Max Mustermann · Musterstraße 1 · 10115 Berlin");
  });

  it("handles missing name parts", () => {
    expect(
      buildSenderLine({ lastName: "Mustermann", street: "Weg 2", zip: "80331", city: "München" }),
    ).toBe("Mustermann · Weg 2 · 80331 München");
    expect(buildSenderLine({ street: "Weg 2", zip: "80331", city: "München" })).toBe(
      "Weg 2 · 80331 München",
    );
  });
});
