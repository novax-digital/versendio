import { z } from "zod";

/**
 * Versioned block model for editor letters (`letters.editor_document`).
 * Rendered server-side to the same PDF format as uploads (ADR-0006).
 * Address/DVF zones are enforced by the renderer, not modelled as blocks.
 *
 * v2 adds a document theme (font family, base size, accent color) and styled
 * blocks (heading, divider, alignment, per-block color). v1 documents remain
 * in production rows and are upgraded in-memory by `parseLetterDocument` —
 * with `theme.legacyLayout` so the rendered output (line metrics, pagination,
 * and therefore sheet count / price) is bit-identical to the v1 renderer.
 */

export const LETTER_DOCUMENT_VERSION = 2;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Accent swatches offered in the builder (any 6-digit hex validates). */
export const ACCENT_SWATCHES = [
  "#2C4BE8", // Kurierblau
  "#1C33AF", // Tiefblau
  "#101828", // Tinte
  "#0E9F6E", // Grün
  "#B45309", // Bernstein
  "#9D174D", // Beere
  "#0F766E", // Petrol
  "#64748B", // Grau
] as const;

const align = z.enum(["left", "center", "right"]).default("left");
/** Per-block text color relative to the theme (no free hex on blocks — print safety). */
const blockColor = z.enum(["default", "accent", "muted"]).default("default");

export const themeSchema = z.object({
  fontFamily: z.enum(["helvetica", "lato", "poppins", "ptserif"]).default("helvetica"),
  baseSizePt: z.number().int().min(9).max(14).default(11),
  accentColor: hexColor.default("#2C4BE8"),
  /** Line height as a factor of the font size. */
  lineHeight: z.number().min(1.1).max(1.6).default(1.35),
  /**
   * Set ONLY by the v1→v2 upgrade path: reproduces the v1 renderer metrics
   * exactly (4.6mm line advance at 11pt, subject at base size) so existing
   * letters keep their page/sheet count and price. Never set for new docs.
   */
  legacyLayout: z.boolean().default(false),
});

export type LetterTheme = z.infer<typeof themeSchema>;

export const subjectBlockSchema = z.object({
  type: z.literal("subject"),
  id: z.string(),
  text: z.string().max(300),
  align,
  color: blockColor,
});

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  id: z.string(),
  text: z.string().max(200),
  level: z.union([z.literal(1), z.literal(2)]).default(2),
  align,
  color: blockColor,
});

export const textBlockSchema = z.object({
  type: z.literal("text"),
  id: z.string(),
  text: z.string().max(20000),
  align,
  /** Size offset from theme.baseSizePt in points. */
  sizeDeltaPt: z.number().int().min(-2).max(4).default(0),
  color: blockColor,
});

export const dividerBlockSchema = z.object({
  type: z.literal("divider"),
  id: z.string(),
  widthPct: z.number().min(20).max(100).default(100),
  thicknessPt: z.number().min(0.5).max(2).default(0.75),
  color: z.enum(["muted", "accent"]).default("muted"),
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
  headingBlockSchema,
  textBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
  imageBlockSchema,
]);

export type LetterBlock = z.infer<typeof blockSchema>;

export const letterDocumentSchema = z.object({
  version: z.literal(LETTER_DOCUMENT_VERSION),
  theme: themeSchema.default({
    fontFamily: "helvetica",
    baseSizePt: 11,
    accentColor: "#2C4BE8",
    lineHeight: 1.35,
    legacyLayout: false,
  }),
  // Header/logo shown above the address field.
  logoStoragePath: z.string().nullable().default(null),
  showDate: z.boolean().default(true),
  senderAddressId: z.string().uuid().nullable().default(null),
  blocks: z.array(blockSchema).max(200),
});

export type LetterDocument = z.infer<typeof letterDocumentSchema>;

// ---------------------------------------------------------------------------
// v1 (legacy) schema + upgrade — production rows in letters/letter_templates
// still hold v1 documents; every load path must go through parseLetterDocument.
// ---------------------------------------------------------------------------

const v1TextBlock = z.object({ type: z.literal("text"), id: z.string(), text: z.string().max(20000) });
const v1SubjectBlock = z.object({ type: z.literal("subject"), id: z.string(), text: z.string().max(300) });
const v1SpacerBlock = z.object({ type: z.literal("spacer"), id: z.string(), heightMm: z.number().min(1).max(120) });
const v1ImageBlock = z.object({
  type: z.literal("image"),
  id: z.string(),
  storagePath: z.string(),
  widthMm: z.number().min(5).max(180),
  align: z.enum(["left", "center", "right"]).default("left"),
});

export const letterDocumentV1Schema = z.object({
  version: z.literal(1),
  logoStoragePath: z.string().nullable().default(null),
  showDate: z.boolean().default(true),
  senderAddressId: z.string().uuid().nullable().default(null),
  blocks: z
    .array(z.discriminatedUnion("type", [v1SubjectBlock, v1TextBlock, v1SpacerBlock, v1ImageBlock]))
    .max(200),
});

function upgradeV1(v1: z.infer<typeof letterDocumentV1Schema>): LetterDocument {
  return {
    version: LETTER_DOCUMENT_VERSION,
    theme: {
      fontFamily: "helvetica",
      baseSizePt: 11,
      accentColor: "#2C4BE8",
      lineHeight: 1.35, // unused while legacyLayout is true
      legacyLayout: true,
    },
    logoStoragePath: v1.logoStoragePath,
    showDate: v1.showDate,
    senderAddressId: v1.senderAddressId,
    blocks: v1.blocks.map((b): LetterBlock => {
      switch (b.type) {
        case "subject":
          return { ...b, align: "left", color: "default" };
        case "text":
          return { ...b, align: "left", sizeDeltaPt: 0, color: "default" };
        default:
          return b;
      }
    }),
  };
}

/**
 * Parses a stored editor document of any supported version, upgrading v1
 * in-memory to v2. Throws on invalid input (same contract as schema.parse).
 */
export function parseLetterDocument(input: unknown): LetterDocument {
  const v2 = letterDocumentSchema.safeParse(input);
  if (v2.success) return v2.data;
  const v1 = letterDocumentV1Schema.safeParse(input);
  if (v1.success) return upgradeV1(v1.data);
  // Surface the v2 issues — that's the current contract.
  throw v2.error;
}

/** Non-throwing variant for untrusted client-side loads (templates). */
export function safeParseLetterDocument(
  input: unknown,
): { success: true; data: LetterDocument } | { success: false } {
  try {
    return { success: true, data: parseLetterDocument(input) };
  } catch {
    return { success: false };
  }
}

export function emptyLetterDocument(): LetterDocument {
  return {
    version: LETTER_DOCUMENT_VERSION,
    theme: {
      fontFamily: "helvetica",
      baseSizePt: 11,
      accentColor: "#2C4BE8",
      lineHeight: 1.35,
      legacyLayout: false,
    },
    logoStoragePath: null,
    showDate: true,
    senderAddressId: null,
    blocks: [
      { type: "subject", id: "subject", text: "", align: "left", color: "default" },
      { type: "text", id: "body", text: "", align: "left", sizeDeltaPt: 0, color: "default" },
    ],
  };
}
