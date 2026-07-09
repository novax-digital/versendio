import { normalizeCountry, validatePostalCode } from "@/lib/shared/postal-code";
import type { ContactField } from "./mapping";

export type ImportedContact = {
  salutation: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  street: string;
  addressExtra: string | null;
  zip: string;
  city: string;
  country: string;
  email: string | null;
};

export type RowError = { rowNumber: number; errors: string[]; raw: string[] };

export type RowResult =
  | { ok: true; contact: ImportedContact }
  | { ok: false; errors: string[] };

const MAX_FIELD_LENGTH = 200;

/** Maps a raw row through the column mapping and validates required fields. */
export function validateImportRow(
  raw: string[],
  mapping: Record<number, ContactField | null>,
): RowResult {
  const value = (field: ContactField): string => {
    for (const [indexStr, mapped] of Object.entries(mapping)) {
      if (mapped === field) {
        const cell = raw[Number(indexStr)];
        return (cell ?? "").toString().trim();
      }
    }
    return "";
  };

  const errors: string[] = [];

  const firstName = value("firstName");
  const lastName = value("lastName");
  const company = value("company");
  const street = value("street");
  const zip = value("zip");
  const city = value("city");
  const country = normalizeCountry(value("country") || "DE");

  if (!lastName && !company) errors.push("Nachname oder Firma erforderlich");
  if (!street) errors.push("Straße erforderlich");
  if (!city) errors.push("Ort erforderlich");

  const zipError = validatePostalCode(zip, country);
  if (zipError) errors.push(zipError);

  for (const [field, v] of Object.entries({ firstName, lastName, company, street, city })) {
    if (v.length > MAX_FIELD_LENGTH) errors.push(`Feld ${field} ist zu lang`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    contact: {
      salutation: value("salutation") || null,
      firstName: firstName || null,
      lastName: lastName || null,
      company: company || null,
      street,
      addressExtra: value("addressExtra") || null,
      zip,
      city,
      country,
      email: value("email") || null,
    },
  };
}

/** Mirrors the DB-generated dedup_key (contacts table) for pre-insert checks. */
export function dedupKey(contact: ImportedContact): string {
  return [
    contact.firstName ?? "",
    contact.lastName ?? "",
    contact.company ?? "",
    contact.street,
    contact.zip,
    contact.city,
  ]
    .join("|")
    .toLowerCase();
}
