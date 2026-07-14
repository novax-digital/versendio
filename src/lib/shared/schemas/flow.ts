import { z } from "zod";
import { sendOptionsSchema } from "./send";
import { DELAY_UNITS, MAX_DELAY_MINUTES, parseDelay } from "@/lib/shared/flows";

/**
 * A flow definition as submitted by the builder. The target list is either an
 * existing list (listMode 'existing' + listId) or a new one auto-created from
 * `name` (listMode 'new'). Delay is entered as value + unit and converted to
 * minutes server-side; the refine here rejects an out-of-range combined delay.
 */
export const flowSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    listMode: z.enum(["existing", "new"]),
    listId: z.string().uuid().optional(),
    letterId: z.string().uuid(),
    delayValue: z.coerce.number().min(0),
    delayUnit: z.enum(DELAY_UNITS),
    options: sendOptionsSchema,
    senderAddressId: z.string().uuid().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.listMode === "existing" && !v.listId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["listId"],
        message: "Bitte wählen Sie eine Kontaktliste.",
      });
    }
    let minutes: number;
    try {
      minutes = parseDelay(v.delayValue, v.delayUnit);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["delayValue"], message: "Ungültige Verzögerung." });
      return;
    }
    if (minutes > MAX_DELAY_MINUTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["delayValue"],
        message: "Die Verzögerung darf höchstens 365 Tage betragen.",
      });
    }
  });

export type FlowInput = z.infer<typeof flowSchema>;
