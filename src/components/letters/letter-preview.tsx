"use client";

import { de } from "@/lib/i18n/de";

/**
 * PDF preview of a letter. Uses a cache-busting query so a re-render after an
 * edit shows fresh content.
 *
 * No Schablone-zone overlay here: this is the browser's PDF viewer in an iframe
 * (its own toolbar, zoom and scroll), so a fixed overlay can't stay aligned
 * with the page and would only mislead. Zone compliance is reported
 * authoritatively by the server-side validation (ValidationReport), and the
 * editor's live canvas has its own aligned overlay.
 */
export function LetterPreview({
  letterId,
  version = 0,
}: {
  letterId: string;
  version?: number;
}) {
  const src = `/app/briefe/${letterId}/preview?v=${version}`;

  return (
    <div className="bg-muted mx-auto w-full max-w-md">
      <div className="w-full border" style={{ aspectRatio: "210 / 297" }}>
        <iframe title={de.letters.preview} src={src} className="h-full w-full" />
      </div>
    </div>
  );
}
