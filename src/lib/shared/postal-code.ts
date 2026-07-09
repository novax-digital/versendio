// Country-aware postal code validation, adopted from the proven legacy
// implementation (docs/LEGACY_FINDINGS.md §6). Returns null when valid,
// or a German error message when invalid.
import { de } from "@/lib/i18n/de";

const RULES: Record<string, { re: RegExp; hint: string }> = {
  DE: { re: /^\d{5}$/, hint: "5 Ziffern (z. B. 10115)" },
  AT: { re: /^\d{4}$/, hint: "4 Ziffern" },
  CH: { re: /^\d{4}$/, hint: "4 Ziffern" },
  LI: { re: /^\d{4}$/, hint: "4 Ziffern" },
  LU: { re: /^\d{4}$/, hint: "4 Ziffern" },
  BE: { re: /^\d{4}$/, hint: "4 Ziffern" },
  DK: { re: /^\d{4}$/, hint: "4 Ziffern" },
  NL: { re: /^\d{4} ?[A-Z]{2}$/i, hint: "z. B. 1011 AB" },
  FR: { re: /^\d{5}$/, hint: "5 Ziffern" },
  ES: { re: /^\d{5}$/, hint: "5 Ziffern" },
  IT: { re: /^\d{5}$/, hint: "5 Ziffern" },
  PL: { re: /^\d{2}-\d{3}$/, hint: "z. B. 00-001" },
  CZ: { re: /^\d{3} ?\d{2}$/, hint: "5 Ziffern" },
  SE: { re: /^\d{3} ?\d{2}$/, hint: "5 Ziffern" },
  US: { re: /^\d{5}(-\d{4})?$/, hint: "5 Ziffern" },
  GB: { re: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, hint: "z. B. SW1A 1AA" },
};

export function normalizeCountry(c?: string | null): string {
  return (c || "DE").trim().toUpperCase().slice(0, 2);
}

export function validatePostalCode(plz: string, country?: string | null): string | null {
  const cc = normalizeCountry(country);
  const value = (plz || "").trim();
  if (!value) return de.validation.zipRequired;
  const rule = RULES[cc];
  if (!rule) {
    // Unknown country: sanity check only.
    if (!/^[A-Za-z0-9 -]{2,10}$/.test(value)) return de.validation.zipInvalidGeneric;
    return null;
  }
  return rule.re.test(value) ? null : de.validation.zipInvalidForCountry(cc, rule.hint);
}
