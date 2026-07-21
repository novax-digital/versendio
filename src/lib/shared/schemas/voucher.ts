import { z } from "zod";
import { de } from "@/lib/i18n/de";

/** Codes are matched case-insensitively and stored/compared in upper form. */
export function normalizeVoucherCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Manually chosen codes: letters, digits and dashes, 4–40 chars. */
export const VOUCHER_CODE_RE = /^[A-Z0-9-]{4,40}$/;

const optionalPositiveInt = z
  .union([z.coerce.number().int().positive(), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const createVoucherSchema = z.object({
  // Gift amount in integer cents (euros parsed client-side). Cap at 10.000 €.
  amountCents: z.coerce.number().int().positive().max(1_000_000, de.admin.voucherAmountTooHigh),
  // Empty → auto-generated server-side.
  code: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? normalizeVoucherCode(v) : "")),
  // Empty → unlimited redemptions.
  maxRedemptions: optionalPositiveInt,
  // Empty → never expires. "YYYY-MM-DD" from a date input.
  validUntil: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  comment: z.string().trim().max(200).optional().or(z.literal("")),
});

export type CreateVoucherInput = z.infer<typeof createVoucherSchema>;
