import { z } from "zod";

/**
 * Versioned block model for editor letters (`letters.editor_document`).
 * Rendered server-side to the same PDF format as uploads (ADR-0006).
 * Address/DVF zones are enforced by the renderer, not modelled as blocks.
 */

export const LETTER_DOCUMENT_VERSION = 1;

export const textBlockSchema = z.object({
  type: z.literal("text"),
  id: z.string(),
  text: z.string().max(20000),
});

export const subjectBlockSchema = z.object({
  type: z.literal("subject"),
  id: z.string(),
  text: z.string().max(300),
});

export const spacerBlockSchema = z.object({
  type: z.literal("spacer"),
  id: z.string(),
  heightMm: z.number().min(1).max(120),
});

export const imageBlockSchema = z.object({
  type: z.literal("image"),
  id: z.string(),
  storagePath: z.string(),
  widthMm: z.number().min(5).max(180),
  align: z.enum(["left", "center", "right"]).default("left"),
});

export const blockSchema = z.discriminatedUnion("type", [
  subjectBlockSchema,
  textBlockSchema,
  spacerBlockSchema,
  imageBlockSchema,
]);

export type LetterBlock = z.infer<typeof blockSchema>;

export const letterDocumentSchema = z.object({
  version: z.literal(LETTER_DOCUMENT_VERSION),
  // Header/logo shown above the address field.
  logoStoragePath: z.string().nullable().default(null),
  showDate: z.boolean().default(true),
  senderAddressId: z.string().uuid().nullable().default(null),
  blocks: z.array(blockSchema).max(200),
});

export type LetterDocument = z.infer<typeof letterDocumentSchema>;

export function emptyLetterDocument(): LetterDocument {
  return {
    version: LETTER_DOCUMENT_VERSION,
    logoStoragePath: null,
    showDate: true,
    senderAddressId: null,
    blocks: [
      { type: "subject", id: "subject", text: "" },
      { type: "text", id: "body", text: "" },
    ],
  };
}
