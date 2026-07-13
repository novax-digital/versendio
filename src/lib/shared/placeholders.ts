/**
 * Serienbrief placeholders. Editor letters may contain `{{feld}}` tokens that
 * are resolved per recipient at send time (ADR-0006 §4). Kept locale-neutral
 * German field names to match the CSV import mapping.
 */

export type PlaceholderContext = {
  anrede?: string | null;
  vorname?: string | null;
  nachname?: string | null;
  firma?: string | null;
  strasse?: string | null;
  plz?: string | null;
  ort?: string | null;
  land?: string | null;
  /** Send date (dd.mm.yyyy) — injected by the renderer, not recipient data. */
  datum?: string | null;
};

export const PLACEHOLDER_KEYS: (keyof PlaceholderContext)[] = [
  "anrede",
  "vorname",
  "nachname",
  "firma",
  "strasse",
  "plz",
  "ort",
  "land",
  "datum",
];

export const PLACEHOLDER_LABELS: Record<keyof PlaceholderContext, string> = {
  anrede: "Anrede",
  vorname: "Vorname",
  nachname: "Nachname",
  firma: "Firma",
  strasse: "Straße",
  plz: "PLZ",
  ort: "Ort",
  land: "Land",
  datum: "Datum",
};

/** The letter date, used for the date line and `{{datum}}`. */
export function formatLetterDate(
  date: Date = new Date(),
  style: "short" | "long" = "short",
): string {
  if (style === "long") {
    // "13. Juli 2026"
    return new Intl.DateTimeFormat("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** The visible date line: optional "Ort, " prefix from the sender address. */
export function buildDateLine(
  style: "short" | "long",
  withPlace: boolean,
  senderCity: string | null | undefined,
  date: Date = new Date(),
): string {
  const formatted = formatLetterDate(date, style);
  return withPlace && senderCity?.trim() ? `${senderCity.trim()}, ${formatted}` : formatted;
}

const TOKEN_RE = /\{\{\s*([a-zA-ZäöüÄÖÜß]+)\s*\}\}/g;

/** True if the text contains at least one `{{token}}`. */
export function hasPlaceholders(text: string): boolean {
  TOKEN_RE.lastIndex = 0;
  return TOKEN_RE.test(text);
}

/** Distinct placeholder keys used in a text (unknown tokens included). */
export function extractPlaceholders(text: string): string[] {
  const keys = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    keys.add(match[1].toLowerCase());
  }
  return [...keys];
}

/**
 * Replaces `{{token}}` with values from the context. Unknown or empty tokens
 * become an empty string (never left as raw `{{…}}` on a printed letter).
 */
export function resolvePlaceholders(text: string, context: PlaceholderContext): string {
  return text.replace(TOKEN_RE, (_full, rawKey: string) => {
    const key = rawKey.toLowerCase() as keyof PlaceholderContext;
    const value = context[key];
    return value != null ? String(value) : "";
  });
}

/** Placeholder tokens that are not known fields — surfaced as a warning. */
export function unknownPlaceholders(text: string): string[] {
  return extractPlaceholders(text).filter(
    (key) => !PLACEHOLDER_KEYS.includes(key as keyof PlaceholderContext),
  );
}
