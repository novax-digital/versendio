/**
 * Letter font catalog — the single list of families available in the letter
 * builder. Browser (canvas WYSIWYG via @font-face in globals.css) and PDF
 * renderer (embedded TTF via fontkit) use the SAME font files under
 * public/fonts so on-screen metrics match the printed letter.
 * "helvetica" is the PDF standard font (no file; browser falls back to
 * Helvetica/Arial) and stays the default for backward compatibility.
 */

export type LetterFontId = "helvetica" | "lato" | "poppins" | "ptserif";

export type LetterFontMeta = {
  label: string;
  /** CSS stack used on the canvas. Custom families are registered in globals.css. */
  cssStack: string;
  /** TTF file names under public/fonts, or null for the PDF standard font. */
  files: { regular: string; bold: string } | null;
};

export const LETTER_FONTS: Record<LetterFontId, LetterFontMeta> = {
  helvetica: {
    label: "Standard",
    cssStack: "Helvetica, Arial, sans-serif",
    files: null,
  },
  lato: {
    label: "Modern",
    cssStack: "'Lato Letter', Helvetica, Arial, sans-serif",
    files: { regular: "Lato-Regular.ttf", bold: "Lato-Bold.ttf" },
  },
  poppins: {
    label: "Markant",
    cssStack: "'Poppins Letter', Helvetica, Arial, sans-serif",
    files: { regular: "Poppins-Regular.ttf", bold: "Poppins-SemiBold.ttf" },
  },
  ptserif: {
    label: "Klassisch",
    cssStack: "'PT Serif Letter', Georgia, serif",
    files: { regular: "PT_Serif-Web-Regular.ttf", bold: "PT_Serif-Web-Bold.ttf" },
  },
};

export const LETTER_FONT_IDS = Object.keys(LETTER_FONTS) as LetterFontId[];
