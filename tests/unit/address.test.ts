import { describe, expect, it } from "vitest";
import { buildRecipientAddressLines, toPlaceholderContext } from "@/lib/shared/address";

describe("buildRecipientAddressLines", () => {
  it("omits the country for DE", () => {
    const lines = buildRecipientAddressLines({
      firstName: "Max",
      lastName: "Mustermann",
      street: "Musterstr. 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
    });
    expect(lines).toEqual(["Max Mustermann", "Musterstr. 1", "10115 Berlin"]);
  });

  it("adds an uppercased country name for non-DE", () => {
    const lines = buildRecipientAddressLines({
      company: "Muster AG",
      street: "Bahnhofstrasse 1",
      zip: "8001",
      city: "Zürich",
      country: "CH",
    });
    expect(lines).toEqual(["Muster AG", "Bahnhofstrasse 1", "8001 Zürich", "SCHWEIZ"]);
  });

  it("puts company before person name", () => {
    const lines = buildRecipientAddressLines({
      company: "Muster GmbH",
      firstName: "Erika",
      lastName: "Muster",
      street: "Weg 2",
      zip: "80331",
      city: "München",
    });
    expect(lines[0]).toBe("Muster GmbH");
    expect(lines[1]).toBe("Erika Muster");
  });

  it("never exceeds six lines", () => {
    const lines = buildRecipientAddressLines({
      company: "Muster GmbH",
      firstName: "Erika",
      lastName: "Muster",
      addressExtra: "c/o Empfang",
      street: "Weg 2",
      zip: "1000",
      city: "Wien",
      country: "AT",
    });
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines).toContain("ÖSTERREICH");
  });
});

describe("toPlaceholderContext", () => {
  it("maps fields and normalizes country", () => {
    const ctx = toPlaceholderContext({
      salutation: "Herr",
      firstName: "Max",
      lastName: "Mustermann",
      company: "Muster GmbH",
      street: "Weg 1",
      zip: "10115",
      city: "Berlin",
      country: "de",
    });
    expect(ctx).toMatchObject({
      anrede: "Herr",
      vorname: "Max",
      nachname: "Mustermann",
      firma: "Muster GmbH",
      land: "DE",
    });
  });
});
