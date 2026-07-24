/**
 * Parses MOCO's free-text recipient_address block into the structured
 * recipient shape our send pipeline requires (contactSchema fields). MOCO
 * stores addresses as plain multi-line text, e.g.
 *
 *   "Beispiel AG\r\nz. Hd. Frau Muster\r\nBeispielstrasse 123\r\n8000 Zürich"
 *
 * Strategy: locate the zip/city line (searching bottom-up, past an optional
 * trailing country line), take the line above as street, the first line as
 * company and anything between as address extra. Ambiguous or incomplete
 * blocks fail loudly — a mis-parsed address on a physical letter is worse
 * than a skipped document the user can send manually.
 */

export type ParsedMocoRecipient = {
  company: string;
  addressExtra: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
};

export type MocoAddressResult =
  | { ok: true; recipient: ParsedMocoRecipient }
  | { ok: false; reason: "empty" | "too_few_lines" | "no_zip_city_line" };

const COUNTRY_NAMES: Record<string, string> = {
  deutschland: "DE",
  germany: "DE",
  schweiz: "CH",
  suisse: "CH",
  svizzera: "CH",
  switzerland: "CH",
  österreich: "AT",
  oesterreich: "AT",
  austria: "AT",
  liechtenstein: "LI",
  luxemburg: "LU",
  luxembourg: "LU",
  frankreich: "FR",
  france: "FR",
  niederlande: "NL",
  netherlands: "NL",
  belgien: "BE",
  belgium: "BE",
  italien: "IT",
  italy: "IT",
};

/** "CH-8000 Zürich" / "8000 Zürich" / "1011 AB Amsterdam" → {zip, city, country?} */
function parseZipCityLine(line: string): { zip: string; city: string; country?: string } | null {
  // Optional ISO prefix (D-, CH-, A- are historic; map the common ones).
  const prefixed = /^([A-Za-z]{1,3})[- ](\d.*)$/.exec(line);
  let rest = line;
  let country: string | undefined;
  if (prefixed) {
    const p = prefixed[1].toUpperCase();
    const map: Record<string, string> = { D: "DE", A: "AT", CH: "CH", FL: "LI", L: "LU" };
    country = map[p] ?? (p.length === 2 ? p : undefined);
    if (country) rest = prefixed[2];
  }
  // Dutch style: "1011 AB Amsterdam"
  const nl = /^(\d{4}\s?[A-Z]{2})\s+(\S.*)$/.exec(rest);
  if (nl) return { zip: nl[1], city: nl[2].trim(), country: country ?? "NL" };
  // Continental style: 4–5 digit zip + city
  const std = /^(\d{4,5})\s+(\S.*)$/.exec(rest);
  if (std) return { zip: std[1], city: std[2].trim(), country };
  return null;
}

export function parseMocoRecipientAddress(
  raw: string,
  fallbackCountry?: string | null,
): MocoAddressResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { ok: false, reason: "empty" };
  if (lines.length < 3) return { ok: false, reason: "too_few_lines" };

  // Optional trailing country line ("Schweiz", "DE", …).
  let countryFromLine: string | undefined;
  let end = lines.length;
  const last = lines[lines.length - 1];
  const lastLower = last.toLowerCase();
  if (COUNTRY_NAMES[lastLower]) {
    countryFromLine = COUNTRY_NAMES[lastLower];
    end -= 1;
  } else if (/^[A-Z]{2}$/.test(last)) {
    countryFromLine = last;
    end -= 1;
  }

  // Zip/city: bottom-up so street numbers never masquerade as zips.
  let zipIdx = -1;
  let zipCity: { zip: string; city: string; country?: string } | null = null;
  for (let i = end - 1; i >= 1; i--) {
    const parsed = parseZipCityLine(lines[i]);
    if (parsed) {
      zipIdx = i;
      zipCity = parsed;
      break;
    }
  }
  if (!zipCity || zipIdx < 2) {
    // zipIdx < 2 → no room for both a name line and a street line above.
    return { ok: false, reason: "no_zip_city_line" };
  }

  const street = lines[zipIdx - 1];
  const company = lines[0];
  const extraLines = lines.slice(1, zipIdx - 1);

  const country = (
    zipCity.country ??
    countryFromLine ??
    (fallbackCountry && /^[A-Za-z]{2}$/.test(fallbackCountry) ? fallbackCountry : "DE")
  ).toUpperCase();

  return {
    ok: true,
    recipient: {
      company: company.slice(0, 160),
      addressExtra: extraLines.length > 0 ? extraLines.join(", ").slice(0, 200) : null,
      street: street.slice(0, 200),
      zip: zipCity.zip.slice(0, 10),
      city: zipCity.city.slice(0, 120),
      country,
    },
  };
}
