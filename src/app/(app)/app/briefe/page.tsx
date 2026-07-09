import type { Metadata } from "next";
import { FileText, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { LetterRow } from "./letter-row";
import { ButtonLink } from "@/components/ui-ext/button-link";

export const metadata: Metadata = { title: de.letters.title };

export default async function LettersPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data: letters } = await supabase
    .from("letters")
    .select("id, title, source, page_count, sheet_count, status, has_placeholders, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{de.letters.title}</h1>
          <p className="text-muted-foreground text-sm">{de.letters.subtitle}</p>
        </div>
        <ButtonLink href="/app/briefe/neu">
          <Plus className="size-4" aria-hidden />
          {de.letters.newLetter}
        </ButtonLink>
      </div>

      {!letters || letters.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <FileText className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.letters.empty}</p>
            <p>{de.letters.emptyCta}</p>
            <ButtonLink href="/app/briefe/neu" className="mt-2">
              {de.letters.newLetter}
            </ButtonLink>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {letters.map((letter) => (
            <LetterRow key={letter.id} letter={letter} />
          ))}
        </ul>
      )}
    </div>
  );
}
