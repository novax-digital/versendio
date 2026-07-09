import { normalizeCountry } from "./postal-code";
import type { PlaceholderContext } from "./placeholders";

export type RecipientAddress = {
  salutation?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  street: string;
  addressExtra?: string | null;
  zip: string;
  city: string;
  country?: string | null;
};

const COUNTRY_NAMES: Record<string, string> = {
  AT: "ÖSTERREICH",
  CH: "SCHWEIZ",
  NL: "NIEDERLANDE",
  BE: "BELGIEN",
  FR: "FRANKREICH",
  IT: "ITALIEN",
  PL: "POLEN",
  LU: "LUXEMBURG",
  DK: "DÄNEMARK",
  ES: "SPANIEN",
  GB: "GROSSBRITANNIEN",
  US: "USA",
};

/**
 * Builds the printed recipient block (max 6 lines, Schablone V3). For non-DE
 * destinations the country is added as an uppercased last line (DIN 5008 /
 * Weltpostverein). The person/company name is the first line.
 */
export function buildRecipientAddressLines(addr: RecipientAddress): string[] {
  const country = normalizeCountry(addr.country);
  const lines: string[] = [];

  const name = [addr.firstName?.trim(), addr.lastName?.trim()].filter(Boolean).join(" ");
  if (addr.company?.trim()) lines.push(addr.company.trim());
  if (name) lines.push(name);
  if (addr.addressExtra?.trim()) lines.push(addr.addressExtra.trim());
  lines.push(addr.street.trim());
  lines.push(`${addr.zip.trim()} ${addr.city.trim()}`);
  if (country !== "DE") {
    lines.push(COUNTRY_NAMES[country] ?? country);
  }

  // Hard cap at the 6-line recipient zone. When over budget, drop the optional
  // address-extra line first (it is the least essential for delivery).
  if (lines.length > 6 && addr.addressExtra?.trim()) {
    const idx = lines.indexOf(addr.addressExtra.trim());
    if (idx >= 0) lines.splice(idx, 1);
  }
  return lines.slice(0, 6);
}

/**
 * Address lines for the PROVIDER payload (`addressLine1–5`). Per Swagger
 * v2.6.1 these carry only name/company, street and address extra —
 * "Empfängerzeile 1 (z.B. Name,Firma)", "… (z.B. Strasse,Adresszusatz)".
 * PLZ, Ort und Land werden in den separaten Feldern `zipCode`/`city`/`country`
 * übergeben. Sie hier zu wiederholen würde die Ortsangabe doppelt drucken.
 *
 * Distinct from `buildRecipientAddressLines`, which builds the PRINTED block
 * (cover letter / editor rendering) and therefore does include zip/city/country.
 */
export function buildProviderAddressLines(addr: RecipientAddress): string[] {
  const lines: string[] = [];
  const name = [addr.firstName?.trim(), addr.lastName?.trim()].filter(Boolean).join(" ");
  if (addr.company?.trim()) lines.push(addr.company.trim());
  if (name) lines.push(name);
  if (addr.addressExtra?.trim()) lines.push(addr.addressExtra.trim());
  lines.push(addr.street.trim());
  // addressLine5 is DE-only; 4 lines cover every supported combination.
  return lines.slice(0, 5);
}

/** Maps a recipient to the placeholder context for Serienbrief rendering. */
export function toPlaceholderContext(addr: RecipientAddress): PlaceholderContext {
  return {
    anrede: addr.salutation ?? "",
    vorname: addr.firstName ?? "",
    nachname: addr.lastName ?? "",
    firma: addr.company ?? "",
    strasse: addr.street ?? "",
    plz: addr.zip ?? "",
    ort: addr.city ?? "",
    land: normalizeCountry(addr.country),
  };
}
