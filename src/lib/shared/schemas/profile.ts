import { z } from "zod";
import { de } from "@/lib/i18n/de";
import { validatePostalCode, normalizeCountry } from "@/lib/shared/postal-code";

// Empty country input defaults to DE; otherwise a 2-letter code, normalized.
const countrySchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "DE" : v),
  z
    .string()
    .trim()
    .length(2, de.validation.countryInvalid)
    .transform((v) => normalizeCountry(v)),
);

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, de.validation.fieldRequired).max(120),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  billingStreet: z.string().trim().max(200).optional().or(z.literal("")),
  billingZip: z.string().trim().max(10).optional().or(z.literal("")),
  billingCity: z.string().trim().max(120).optional().or(z.literal("")),
  billingCountry: countrySchema,
});

export const senderAddressSchema = z
  .object({
    label: z.string().trim().min(1, de.validation.fieldRequired).max(80),
    company: z.string().trim().max(160).optional().or(z.literal("")),
    firstName: z.string().trim().max(80).optional().or(z.literal("")),
    lastName: z.string().trim().max(80).optional().or(z.literal("")),
    street: z.string().trim().min(1, de.validation.fieldRequired).max(200),
    zip: z.string().trim().min(1, de.validation.fieldRequired).max(10),
    city: z.string().trim().min(1, de.validation.fieldRequired).max(120),
    country: countrySchema,
    senderLine: z.string().trim().min(1, de.validation.fieldRequired).max(120),
    isDefault: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    const zipError = validatePostalCode(data.zip, data.country);
    if (zipError) {
      ctx.addIssue({ code: "custom", message: zipError, path: ["zip"] });
    }
    if (!data.company && !data.lastName) {
      ctx.addIssue({
        code: "custom",
        message: de.senderAddresses.nameOrCompanyRequired,
        path: ["company"],
      });
    }
  });

export type ProfileInput = z.infer<typeof profileSchema>;
export type SenderAddressInput = z.infer<typeof senderAddressSchema>;

/** Builds the single-line sender line required by Schablone V3 (e.g. "Firma GmbH · Musterstr. 1 · 12345 Berlin"). */
export function buildSenderLine(input: {
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  street: string;
  zip: string;
  city: string;
}): string {
  const name =
    input.company?.trim() ||
    [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ");
  return [name, input.street.trim(), `${input.zip.trim()} ${input.city.trim()}`]
    .filter(Boolean)
    .join(" · ");
}
