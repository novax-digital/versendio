/** Formats integer cents as German Euro string, e.g. 1234 -> "12,34 €". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
}

/**
 * B2B pricing: ALL amounts in the app (VK prices, credit balance, ledger)
 * are NET. German VAT is added only at the payment boundary (Stripe checkout
 * line item / auto-topup charge) and shown on the Stripe invoice.
 */
export const VAT_RATE_PERCENT = 19;

/** Gross amount for a net amount in cents (half-up, matching Stripe's tax rounding). */
export function grossFromNetCents(netCents: number): number {
  return Math.round((netCents * (100 + VAT_RATE_PERCENT)) / 100);
}
