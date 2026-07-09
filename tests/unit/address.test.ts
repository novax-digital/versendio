import { describe, expect, it } from "vitest";
import {
  buildRecipientAddressLines,
  buildProviderAddressLines,
  toPlaceholderContext,
} from "@/lib/shared/address";

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

describe("buildProviderAddressLines", () => {
  // Swagger v2.6.1: addressLine1..5 carry name/company + street/address extra.
  // zipCode/city/country are DISCRETE fields — repeating them in the lines
  // would print the locality twice on the real letter.
  const berlin = {
    firstName: "Max",
    lastName: "Mustermann",
    company: "Muster GmbH",
    addressExtra: "c/o Empfang",
    street: "Musterstr. 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
  };

  it("never contains the zip/city line", () => {
    const lines = buildProviderAddressLines(berlin);
    expect(lines.some((l) => l.includes("10115"))).toBe(false);
    expect(lines.some((l) => l.includes("Berlin"))).toBe(false);
  });

  it("never contains the country name", () => {
    const lines = buildProviderAddressLines({ ...berlin, country: "CH", city: "Zürich", zip: "8001" });
    expect(lines.some((l) => l.includes("SCHWEIZ"))).toBe(false);
  });

  it("orders company, name, extra, street", () => {
    expect(buildProviderAddressLines(berlin)).toEqual([
      "Muster GmbH",
      "Max Mustermann",
      "c/o Empfang",
      "Musterstr. 1",
    ]);
  });

  it("works without company or address extra", () => {
    expect(
      buildProviderAddressLines({
        lastName: "Muster",
        street: "Weg 2",
        zip: "80331",
        city: "München",
      }),
    ).toEqual(["Muster", "Weg 2"]);
  });

  it("never exceeds five lines", () => {
    expect(buildProviderAddressLines(berlin).length).toBeLessThanOrEqual(5);
  });

  it("differs from the printed block, which does carry zip/city", () => {
    const printed = buildRecipientAddressLines(berlin);
    expect(printed.some((l) => l.includes("10115 Berlin"))).toBe(true);
    expect(buildProviderAddressLines(berlin)).not.toEqual(printed);
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
