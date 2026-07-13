import { z } from "zod";
import { de } from "@/lib/i18n/de";
import { letterDocumentSchema } from "@/lib/shared/letter-document";

export const letterTitleSchema = z.string().trim().min(1, de.validation.fieldRequired).max(160);

export const saveEditorLetterSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  title: letterTitleSchema,
  document: letterDocumentSchema,
});

export const saveTemplateSchema = z.object({
  name: z.string().trim().min(1, de.validation.fieldRequired).max(160),
  document: letterDocumentSchema,
  /** "template" = full letter template; "letterhead" = theme/header/footer preset. */
  kind: z.enum(["template", "letterhead"]).default("template"),
});

export type SaveEditorLetterInput = z.infer<typeof saveEditorLetterSchema>;
