import { describe, expect, it } from "vitest";
import { calculateLetterPrice, PricingError, type PricingRow } from "@/lib/shared/pricing";

// Mirrors the seed (supabase/seed.sql): real DP EK prices, proposed VK.
const rows: PricingRow[] = [
  { option_key: "tier_standard_bw_simplex", kind: "tier", zone: "national", ek_cents: 80, vk_cents: 110, active: true },
  { option_key: "tier_standard_bw_duplex", kind: "tier", zone: "national", ek_cents: 81, vk_cents: 115, active: true },
  { option_key: "tier_standard_color_duplex", kind: "tier", zone: "national", ek_cents: 90, vk_cents: 125, active: true },
  { option_key: "tier_kompakt_bw_simplex", kind: "tier", zone: "national", ek_cents: 112, vk_cents: 155, active: true },
  { option_key: "tier_kompakt_bw_duplex", kind: "tier", zone: "national", ek_cents: 116, vk_cents: 160, active: true },
  { option_key: "tier_gross_bw_duplex", kind: "tier", zone: "national", ek_cents: 205, vk_cents: 285, active: true },
  { option_key: "extra_sheet_bw_duplex", kind: "extra_sheet", zone: "national", ek_cents: 5, vk_cents: 8, active: true },
  { option_key: "surcharge_registered_einwurf", kind: "surcharge", zone: "national", ek_cents: null, vk_cents: 350, active: true },
];

const base = { isColor: false, isDuplex: true, registered: "none" as const, discountPercent: 0 };

describe("calculateLetterPrice", () => {
  it("prices a 1-sheet standard letter", () => {
    const p = calculateLetterPrice(rows, { ...base, sheets: 1 });
    expect(p.vkCents).toBe(115);
    expect(p.ekCents).toBe(81);
    expect(p.ekComplete).toBe(true);
    expect(p.optionKeys).toEqual(["tier_standard_bw_duplex"]);
  });

  it("uses tier boundaries by sheet count (1 / ≤4 / ≤10 / 11+)", () => {
    expect(calculateLetterPrice(rows, { ...base, sheets: 2 }).optionKeys[0]).toBe("tier_kompakt_bw_duplex");
    expect(calculateLetterPrice(rows, { ...base, sheets: 4 }).optionKeys[0]).toBe("tier_kompakt_bw_duplex");
    expect(calculateLetterPrice(rows, { ...base, sheets: 10 }).optionKeys[0]).toBe("tier_gross_bw_duplex");
  });

  it("adds extra sheets beyond 10", () => {
    const p = calculateLetterPrice(rows, { ...base, sheets: 12 });
    expect(p.vkCents).toBe(285 + 2 * 8);
    expect(p.ekCents).toBe(205 + 2 * 5);
    expect(p.optionKeys).toContain("extra_sheet_bw_duplex×2");
  });

  it("adds registered surcharge and reports incomplete EK", () => {
    const p = calculateLetterPrice(rows, { ...base, sheets: 1, registered: "einwurf" });
    expect(p.vkCents).toBe(115 + 350);
    expect(p.ekComplete).toBe(false); // surcharge EK is TODO (null)
    expect(p.ekCents).toBe(81); // null EK contributes 0
  });

  it("applies the plan discount to VK only, rounded half-up", () => {
    const p = calculateLetterPrice(rows, { ...base, sheets: 1, discountPercent: 10 });
    expect(p.vkCents).toBe(104); // 115 * 0.9 = 103.5 → 104
    expect(p.ekCents).toBe(81); // EK untouched
    expect(p.vkBeforeDiscountCents).toBe(115);
  });

  it("respects color/duplex variants", () => {
    const p = calculateLetterPrice(rows, { ...base, sheets: 1, isColor: true });
    expect(p.optionKeys[0]).toBe("tier_standard_color_duplex");
    const simplex = calculateLetterPrice(rows, { ...base, sheets: 1, isDuplex: false });
    expect(simplex.optionKeys[0]).toBe("tier_standard_bw_simplex");
  });

  it("throws on missing options and invalid sheet counts", () => {
    expect(() => calculateLetterPrice(rows, { ...base, sheets: 0 })).toThrow(PricingError);
    expect(() =>
      calculateLetterPrice(rows, { ...base, sheets: 1, registered: "rueckschein" }),
    ).toThrow(PricingError);
  });

  it("rejects inactive options", () => {
    const inactive = rows.map((r) =>
      r.option_key === "tier_standard_bw_duplex" ? { ...r, active: false } : r,
    );
    expect(() => calculateLetterPrice(inactive, { ...base, sheets: 1 })).toThrow(PricingError);
  });
});
