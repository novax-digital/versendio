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
};

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
