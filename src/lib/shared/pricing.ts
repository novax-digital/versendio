/**
 * Pure price calculation over pricing_table rows (ADR-0007). Deterministic and
 * unit-tested; the cost preview and the booking use this same function — no
 * two price truths. All amounts in integer cents.
 */

export type PricingRow = {
  option_key: string;
  kind: "tier" | "extra_sheet" | "surcharge";
  zone: "national" | "international";
  ek_cents: number | null;
  vk_cents: number;
  active: boolean;
};

export type PriceOptions = {
  sheets: number;
  isColor: boolean;
  isDuplex: boolean;
  registered: "none" | "einwurf" | "einschreiben" | "rueckschein";
  /** Plan discount in percent (0-100), applies to VK only. */
  discountPercent: number;
};

export type PriceBreakdown = {
  vkCents: number;
  ekCents: number;
  /** null EK anywhere in the path → EK incomplete (admin TODO), reported as 0. */
  ekComplete: boolean;
  optionKeys: string[];
  discountPercent: number;
  vkBeforeDiscountCents: number;
};

export class PricingError extends Error {
  constructor(
    message: string,
    readonly code: "missing_option" | "invalid_sheets" | "inactive_option",
  ) {
    super(message);
  }
}

/**
 * Postage tier from the sheet count — the print center determines the physical
 * product (envelope, fold) the same way; the E-Post API offers no override.
 * Exported so the UI can show which Briefart a send will become.
 */
export function tierForSheets(sheets: number): { tier: "standard" | "kompakt" | "gross"; extraSheets: number } {
  if (sheets <= 1) return { tier: "standard", extraSheets: 0 };
  if (sheets <= 4) return { tier: "kompakt", extraSheets: 0 };
  if (sheets <= 10) return { tier: "gross", extraSheets: 0 };
  return { tier: "gross", extraSheets: sheets - 10 };
}

/** Price for ONE letter with the given options. */
export function calculateLetterPrice(
  rows: PricingRow[],
  options: PriceOptions,
): PriceBreakdown {
  if (!Number.isInteger(options.sheets) || options.sheets < 1) {
    throw new PricingError("sheet count must be a positive integer", "invalid_sheets");
  }

  const byKey = new Map(rows.map((r) => [r.option_key, r]));
  const color = options.isColor ? "color" : "bw";
  const print = options.isDuplex ? "duplex" : "simplex";
  const { tier, extraSheets } = tierForSheets(options.sheets);

  const usedKeys: string[] = [];
  let vk = 0;
  let ek = 0;
  let ekComplete = true;

  const consume = (key: string, multiplier = 1) => {
    const row = byKey.get(key);
    if (!row) throw new PricingError(`pricing option missing: ${key}`, "missing_option");
    if (!row.active) throw new PricingError(`pricing option inactive: ${key}`, "inactive_option");
    usedKeys.push(multiplier > 1 ? `${key}×${multiplier}` : key);
    vk += row.vk_cents * multiplier;
    if (row.ek_cents == null) ekComplete = false;
    else ek += row.ek_cents * multiplier;
  };

  consume(`tier_${tier}_${color}_${print}`);
  if (extraSheets > 0) consume(`extra_sheet_${color}_${print}`, extraSheets);
  if (options.registered !== "none") consume(`surcharge_registered_${options.registered}`);

  const vkBeforeDiscount = vk;
  const discount = Math.min(100, Math.max(0, options.discountPercent));
  // Round half-up per letter (ADR-0007 §2).
  const vkDiscounted = Math.round(vk * (1 - discount / 100));

  return {
    vkCents: vkDiscounted,
    ekCents: ek,
    ekComplete,
    optionKeys: usedKeys,
    discountPercent: discount,
    vkBeforeDiscountCents: vkBeforeDiscount,
  };
}
