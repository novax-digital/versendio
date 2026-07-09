/**
 * Prepares a user search term for use inside a PostgREST `.or(...ilike...)`
 * filter string. Escapes LIKE metacharacters and strips characters that are
 * structural in the .or() grammar (commas, parentheses, quotes, backslashes) —
 * otherwise a term like "Mustermann, Max" produces a malformed filter (400)
 * and the search silently shows no results.
 */
export function sanitizeSearchTerm(term: string): string {
  return term
    .trim()
    .slice(0, 80)
    .replace(/[\\,()"']/g, " ")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replace(/\s+/g, " ")
    .trim();
}
