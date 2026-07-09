import { z } from "zod";

/** Hard cap of recipients per send job (applies to lead lists and selections). */
export const MAX_RECIPIENTS_PER_JOB = 2000;

export const sendOptionsSchema = z.object({
  isColor: z.boolean().default(false),
  isDuplex: z.boolean().default(true),
  registered: z.enum(["none", "einwurf", "einschreiben", "rueckschein"]).default("none"),
});

export const recipientSelectionSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("lead_list"), leadListId: z.string().uuid() }),
  z.object({
    source: z.literal("contacts"),
    contactIds: z.array(z.string().uuid()).min(1).max(MAX_RECIPIENTS_PER_JOB),
  }),
]);

export const quoteRequestSchema = z.object({
  letterId: z.string().uuid(),
  recipients: recipientSelectionSchema,
  options: sendOptionsSchema,
});

export const confirmRequestSchema = quoteRequestSchema.extend({
  clientToken: z.string().uuid(),
  isTest: z.boolean().default(false),
  senderAddressId: z.string().uuid().nullable().optional(),
  /** Optional cancellation window: hold submission until this time (max 31 days). */
  scheduledReleaseAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .refine(
      (v) => !v || (Date.parse(v) > Date.now() - 60_000 && Date.parse(v) < Date.now() + 31 * 86_400_000),
      { message: "Der Versandzeitpunkt muss in der Zukunft und innerhalb von 31 Tagen liegen." },
    ),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
