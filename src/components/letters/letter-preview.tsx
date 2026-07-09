"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ZoneOverlay } from "./zone-overlay";
import { de } from "@/lib/i18n/de";

/**
 * PDF preview of a letter with an optional Schablone-zone overlay. Uses a
 * cache-busting query so a re-render after an edit shows fresh content.
 */
export function LetterPreview({
  letterId,
  version = 0,
}: {
  letterId: string;
  version?: number;
}) {
  const [showZones, setShowZones] = useState(false);
  const src = `/app/briefe/${letterId}/preview?v=${version}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch id="show-zones" checked={showZones} onCheckedChange={setShowZones} />
        <Label htmlFor="show-zones" className="font-normal">
          {de.letters.showZones}
        </Label>
      </div>
      <div className="bg-muted mx-auto w-full max-w-md">
        <div className="relative w-full" style={{ aspectRatio: "210 / 297" }}>
          <iframe
            title={de.letters.preview}
            src={src}
            className="absolute inset-0 h-full w-full border"
          />
          <ZoneOverlay show={showZones} />
        </div>
      </div>
    </div>
  );
}
