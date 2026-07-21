import type { Metadata } from "next";
import Link from "next/link";
import { Upload, PenLine, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.letters.newLetter };

export default async function NewLetterPage() {
  await requireProfile();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.letters.newLetter}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{de.letters.newLetterSubtitle}</p>
      </div>

      {/* Primary path: build a letter in the editor. Deliberately the dominant
          option — most letters are created here. */}
      <Link
        href="/app/briefe/editor"
        className="group focus-visible:ring-ring block rounded-xl focus-visible:ring-2 focus-visible:outline-none"
      >
        <Card className="border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 transition-colors">
          <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:gap-6">
            <div className="bg-primary/10 text-primary flex size-14 shrink-0 items-center justify-center rounded-xl">
              <PenLine className="size-7" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{de.letters.chooseEditor}</h2>
                <Badge>{de.letters.recommendedBadge}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">{de.letters.chooseEditorHint}</p>
            </div>
            <div className="text-primary flex shrink-0 items-center gap-1.5 text-sm font-medium">
              {de.letters.chooseEditorCta}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </div>
          </CardContent>
        </Card>
      </Link>

      {/* "oder" divider — visually demotes the alternative below. */}
      <div className="text-muted-foreground flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" aria-hidden />
        {de.letters.chooseAlternative}
        <span className="bg-border h-px flex-1" aria-hidden />
      </div>

      {/* Secondary path: upload a finished PDF. Compact row, lighter weight. */}
      <Link
        href="/app/briefe/hochladen"
        className="group focus-visible:ring-ring hover:border-primary/40 hover:bg-muted/40 flex items-center gap-4 rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
          <Upload className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{de.letters.chooseUpload}</h2>
          <p className="text-muted-foreground text-sm">{de.letters.chooseUploadHint}</p>
        </div>
        <ArrowRight
          className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}
