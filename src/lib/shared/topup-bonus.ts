import { z } from "zod";

/**
 * Admin-configurable top-up bonus tiers. A tier grants extra credit when the
 * NET top-up reaches its threshold — either a flat cents amount or a percentage
 * of the net. The bonus is a gift (unpaid credit): no VAT, no invoice.
 * Exactly one of bonus_percent / bonus_cents per tier. All amounts integer cents.
 */
export const bonusTierSchema = z
  .object({
    threshold_cents: z.number().int().positive(),
    bonus_percent: z.number().min(0).max(100).optional(),
    bonus_cents: z.number().int().min(0).optional(),
  })
  .refine((t) => (t.bonus_percent != null) !== (t.bonus_cents != null), {
    message: "genau eines von bonus_percent oder bonus_cents angeben",
  });

export const bonusTiersSchema = z.array(bonusTierSchema).max(8);

export type BonusTier = z.infer<typeof bonusTierSchema>;

/**
 * Bonus (extra credit) in integer cents for a given NET top-up amount.
 * Picks the highest tier whose threshold is met; percentages round DOWN so we
 * never over-grant. Returns 0 when no tier matches or the config is empty.
 */
export function computeBonusCents(netCents: number, tiers: BonusTier[]): number {
  if (!Number.isFinite(netCents) || netCents <= 0 || tiers.length === 0) return 0;
  const matching = tiers
    .filter((t) => netCents >= t.threshold_cents)
    .sort((a, b) => b.threshold_cents - a.threshold_cents);
  const tier = matching[0];
  if (!tier) return 0;
  if (tier.bonus_cents != null) return Math.max(0, Math.floor(tier.bonus_cents));
  return Math.max(0, Math.floor((netCents * (tier.bonus_percent ?? 0)) / 100));
}
