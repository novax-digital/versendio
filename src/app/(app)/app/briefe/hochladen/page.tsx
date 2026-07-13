import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: de.letters.uploadTitle };

export default async function UploadLetterPage() {
  await requireProfile();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.letters.uploadTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.letters.uploadHint}</p>
      </div>
      <div className="bg-muted/50 space-y-2 rounded-md border p-3 text-sm">
        <p className="text-muted-foreground">{de.letters.uploadZoneNotice}</p>
        {/* Plain anchor to a file-download route handler (not a page). No
            `download` attribute: the route sends Content-Disposition itself;
            with an expired session the redirect must navigate to the login
            page instead of downloading its HTML as a file. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/app/briefe/hochladen/muster"
          className="text-primary inline-flex items-center gap-1.5 font-medium hover:underline"
        >
          <FileDown className="size-4" aria-hidden />
          {de.letters.uploadMusterDownload}
        </a>
      </div>
      <UploadForm />
    </div>
  );
}
