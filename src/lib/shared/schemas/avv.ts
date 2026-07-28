import { z } from "zod";

/**
 * Request payload for the AVV (data processing agreement) generation route.
 * Field lengths are sized to the printable line width on page 1 of the
 * template (~448 pt at 11 pt Helvetica); longer values get font-shrunk, not
 * wrapped, so hard caps keep the block readable.
 */
export const avvRequestSchema = z.object({
  company: z.string().trim().min(2).max(80),
  representative: z.string().trim().min(2).max(80),
  street: z.string().trim().min(3).max(80),
  zip: z.string().trim().min(3).max(10),
  city: z.string().trim().min(2).max(60),
  // Signature as PNG data URL from the drawing canvas; ~400 KB cap.
  signature: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
    .max(400_000),
});

export type AvvRequest = z.infer<typeof avvRequestSchema>;
