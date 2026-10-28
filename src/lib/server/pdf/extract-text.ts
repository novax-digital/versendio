import "server-only";

const MAX_PAGES = 10; // enough to judge a letter; bounds worker time on big PDFs

/**
 * Extracts the plain text of a PDF with pdf.js (legacy build, no worker —
 * same loading constraints as analyze-zones.ts). Used by the admin send
 * review to detect image-only letters and phishing wording. Reads at most
 * MAX_PAGES pages. Returns null when the parser fails; the caller then
 * reports "text not checked".
 */
export async function extractPdfText(
  bytes: Uint8Array,
  opts: { skipFirstPage?: boolean } = {},
): Promise<{ text: string; pages: number } | null> {
  let destroy: (() => Promise<void>) | null = null;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // @ts-expect-error -- no type declarations for the worker entry; imported
    // solely for its globalThis.pdfjsWorker side effect (see analyze-zones.ts).
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const loaded = await pdfjs.getDocument({
      data: new Uint8Array(bytes), // pdf.js detaches the buffer it is given
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    destroy = () => loaded.destroy();

    const first = opts.skipFirstPage ? 2 : 1;
    const last = Math.min(loaded.numPages, first + MAX_PAGES - 1);
    const parts: string[] = [];
    for (let n = first; n <= last; n++) {
      const page = await loaded.getPage(n);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ("str" in item) parts.push(item.str);
      }
    }
    return { text: parts.join(" "), pages: Math.max(last - first + 1, 0) };
  } catch {
    return null;
  } finally {
    await destroy?.().catch(() => undefined);
  }
}
