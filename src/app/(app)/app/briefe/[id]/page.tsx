import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LetterPreview } from "@/components/letters/letter-preview";
import { ValidationReport } from "@/components/letters/validation-report";
import type { PdfValidation } from "@/lib/shared/validation-result";
import { de } from "@/lib/i18n/de";
import { LetterActions, CoverToggle } from "./letter-actions";
import { ButtonLink } from "@/components/ui-ext/button-link";

export const metadata: Metadata = { title: de.letters.title };

export default async function LetterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: letter, error } = await supabase
    .from("letters")
    .select(
      "id, title, source, page_count, sheet_count, status, validation, needs_cover_letter, use_cover_letter, updated_at",
    )
    .eq("id", id)
    .single();

  if (error || !letter) notFound();

  const validation = (letter.validation ?? null) as PdfValidation | null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{letter.title}</h1>
          <p className="text-muted-foreground text-sm">
            {letter.source === "editor" ? de.letters.sourceEditor : de.letters.sourceUpload}
          </p>
        </div>
        <div className="flex gap-2">
          {letter.status === "ready" ? (
            <ButtonLink href={`/app/versand?brief=${letter.id}`}>
              <Send className="size-4" aria-hidden />
              {de.letters.sendLetter}
            </ButtonLink>
          ) : null}
          <LetterActions letterId={letter.id} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* updated_at as cache-buster: toggling the cover page touches the row,
            so the iframe reloads and the preview reflects the choice live. */}
        <LetterPreview letterId={letter.id} version={Date.parse(letter.updated_at)} />
        <div className="space-y-4">
          {validation ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{de.letters.status}</CardTitle>
              </CardHeader>
              <CardContent>
                <ValidationReport validation={validation} />
              </CardContent>
            </Card>
          ) : null}

          {letter.source === "upload" ? (
            <CoverToggle
              letterId={letter.id}
              useCover={letter.use_cover_letter}
              recommended={letter.needs_cover_letter}
              locked={validation?.rules.some((r) => r.id === "dvf_zone") ?? false}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
