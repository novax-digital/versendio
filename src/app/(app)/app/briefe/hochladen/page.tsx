import type { Metadata } from "next";
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
      <UploadForm />
    </div>
  );
}
