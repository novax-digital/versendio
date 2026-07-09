/**
 * Column mapping for CSV/XLSX contact imports. Header aliases adopted from
 * the proven legacy auto-mapper (German + English) and extended.
 */

export type ContactField =
  | "salutation"
  | "firstName"
  | "lastName"
  | "company"
  | "street"
  | "addressExtra"
  | "zip"
  | "city"
  | "country"
  | "email";

export const CONTACT_FIELDS: ContactField[] = [
  "salutation",
  "firstName",
  "lastName",
  "company",
  "street",
  "addressExtra",
  "zip",
  "city",
  "country",
  "email",
];

export const FIELD_LABELS_DE: Record<ContactField, string> = {
  salutation: "Anrede",
  firstName: "Vorname",
  lastName: "Nachname",
  company: "Firma",
  street: "Straße und Hausnummer",
  addressExtra: "Adresszusatz",
  zip: "PLZ",
  city: "Ort",
  country: "Land",
  email: "E-Mail",
};

const ALIASES: Record<ContactField, string[]> = {
  salutation: ["anrede", "salutation", "titel", "title"],
  firstName: ["vorname", "firstname", "first name", "first_name", "given name"],
  lastName: ["nachname", "lastname", "last name", "last_name", "name", "surname", "familienname"],
  company: ["firma", "company", "unternehmen", "organisation", "organization", "firmenname"],
  street: ["strasse", "straße", "street", "adresse", "address", "anschrift", "straße und hausnummer", "strasse und hausnummer"],
  addressExtra: ["adresszusatz", "zusatz", "address2", "address 2", "addresszusatz", "c/o", "co"],
  zip: ["plz", "postleitzahl", "zip", "zipcode", "zip code", "postal code", "postalcode"],
  city: ["ort", "stadt", "city", "town", "wohnort"],
  country: ["land", "country", "laendercode", "ländercode", "country code", "countrycode"],
  email: ["email", "e-mail", "mail", "emailadresse", "e-mail-adresse"],
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Suggests a field mapping for raw file headers. Exact alias matches win;
 * headers without a match stay unmapped (user assigns them in the UI).
 * Each field is assigned at most once (first matching column wins).
 */
export function suggestMapping(headers: string[]): Record<number, ContactField | null> {
  const mapping: Record<number, ContactField | null> = {};
  const taken = new Set<ContactField>();

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    let match: ContactField | null = null;
    for (const field of CONTACT_FIELDS) {
      if (taken.has(field)) continue;
      if (ALIASES[field].includes(normalized)) {
        match = field;
        break;
      }
    }
    if (match) taken.add(match);
    mapping[index] = match;
  });

  return mapping;
}
