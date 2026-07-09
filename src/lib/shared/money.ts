/** Formats integer cents as German Euro string, e.g. 1234 -> "12,34 €". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}
