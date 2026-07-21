import { z } from "zod";
import { de } from "@/lib/i18n/de";
import { normalizeCountry, validatePostalCode } from "@/lib/shared/postal-code";
import { CONTACT_FIELDS, type ContactField } from "@/lib/shared/import/mapping";

const countrySchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "DE" : v),
  z
    .string()
    .trim()
    .length(2, de.validation.countryInvalid)
    .transform((v) => normalizeCountry(v)),
);

export const contactSchema = z
  .object({
    salutation: z.string().trim().max(40).optional().or(z.literal("")),
    firstName: z.string().trim().max(80).optional().or(z.literal("")),
    lastName: z.string().trim().max(80).optional().or(z.literal("")),
    company: z.string().trim().max(160).optional().or(z.literal("")),
    street: z.string().trim().min(1, de.validation.fieldRequired).max(200),
    addressExtra: z.string().trim().max(120).optional().or(z.literal("")),
    zip: z.string().trim().min(1, de.validation.fieldRequired).max(10),
    city: z.string().trim().min(1, de.validation.fieldRequired).max(120),
    country: countrySchema,
    email: z.string().trim().email(de.auth.emailInvalid).max(200).optional().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    const zipError = validatePostalCode(data.zip, data.country);
    if (zipError) ctx.addIssue({ code: "custom", message: zipError, path: ["zip"] });
    if (!data.company && !data.lastName) {
      ctx.addIssue({
        code: "custom",
        message: de.contacts.nameOrCompanyRequired,
        path: ["lastName"],
      });
    }
  });

export type ContactInput = z.infer<typeof contactSchema>;

const mappingValueSchema = z
  .union([z.enum(CONTACT_FIELDS as [ContactField, ...ContactField[]]), z.null()])
  .catch(null);

export const commitImportSchema = z.object({
  importPath: z.string().min(1),
  fileName: z.string().min(1),
  mapping: z.record(z.string(), mappingValueSchema),
  listName: z.string().trim().max(160).optional().or(z.literal("")),
  // Active flows the imported contacts should be enrolled into (opt-in). Not
  // hard-capped here: an oversized selection must never abort the whole import —
  // it is sliced best-effort server-side (see commitImportAction).
  flowIds: z.array(z.string().uuid()).optional(),
});

export const leadListSchema = z.object({
  name: z.string().trim().min(1, de.validation.fieldRequired).max(160),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});
