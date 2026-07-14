import { describe, expect, it } from "vitest";
import { bonusTiersSchema, computeBonusCents, type BonusTier } from "@/lib/shared/topup-bonus";

describe("computeBonusCents", () => {
  const tiers: BonusTier[] = [
    { threshold_cents: 5000, bonus_percent: 10 },
    { threshold_cents: 10000, bonus_cents: 1500 },
  ];

  it("returns 0 below the lowest threshold or with no tiers", () => {
    expect(computeBonusCents(4999, tiers)).toBe(0);
    expect(computeBonusCents(5000, [])).toBe(0);
    expect(computeBonusCents(0, tiers)).toBe(0);
    expect(computeBonusCents(-100, tiers)).toBe(0);
  });

  it("applies the highest matching tier", () => {
    expect(computeBonusCents(5000, tiers)).toBe(500); // 10% of 50€
    expect(computeBonusCents(9999, tiers)).toBe(999); // still percent tier, floored
    expect(computeBonusCents(10000, tiers)).toBe(1500); // flat tier wins
    expect(computeBonusCents(50000, tiers)).toBe(1500); // highest threshold met
  });

  it("floors percentage bonuses so we never over-grant", () => {
    expect(computeBonusCents(5005, [{ threshold_cents: 5000, bonus_percent: 10 }])).toBe(500); // 500.5 → 500
  });

  it("schema rejects a tier with both or neither bonus field", () => {
    expect(bonusTiersSchema.safeParse([{ threshold_cents: 5000 }]).success).toBe(false);
    expect(
      bonusTiersSchema.safeParse([{ threshold_cents: 5000, bonus_percent: 10, bonus_cents: 100 }])
        .success,
    ).toBe(false);
    expect(
      bonusTiersSchema.safeParse([{ threshold_cents: 5000, bonus_percent: 10 }]).success,
    ).toBe(true);
    expect(bonusTiersSchema.safeParse([]).success).toBe(true);
  });
});
