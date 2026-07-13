import { describe, expect, it } from "vitest";
import { VAT_RATE_PERCENT, formatCents, grossFromNetCents } from "@/lib/shared/money";

describe("money", () => {
  it("formats cents as German euro", () => {
    // Intl uses a non-breaking space before the currency symbol.
    expect(formatCents(1234)).toBe("12,34 €");
  });

  it("VAT rate is 19 % (B2B net pricing, A-014)", () => {
    expect(VAT_RATE_PERCENT).toBe(19);
  });

  it("computes gross from net with half-up rounding", () => {
    expect(grossFromNetCents(1000)).toBe(1190); // 10,00 € -> 11,90 €
    expect(grossFromNetCents(2500)).toBe(2975);
    expect(grossFromNetCents(5000)).toBe(5950);
    expect(grossFromNetCents(1)).toBe(1); // 1.19 -> 1
    expect(grossFromNetCents(3)).toBe(4); // 3.57 -> 4
    expect(grossFromNetCents(50)).toBe(60); // 59.5 -> 60 (half-up)
    expect(grossFromNetCents(0)).toBe(0);
  });
});
