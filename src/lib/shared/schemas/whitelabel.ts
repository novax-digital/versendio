import { z } from "zod";
import { de } from "@/lib/i18n/de";

/** End-customer of a whitelabel customer (pure data object, no login). */
export const wlCustomerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, de.validation.fieldRequired).max(160),
  externalRef: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email(de.auth.emailInvalid).max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type WlCustomerInput = z.infer<typeof wlCustomerSchema>;
