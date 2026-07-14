import type { Metadata } from "next";
import { LayoutTemplate, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { de } from "@/lib/i18n/de";
import { TemplateRow } from "./template-row";

export const metadata: Metadata = { title: de.letters.templatesTitle };

export default async function TemplatesPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("letter_templates")
    .select("id, name, updated_at")
    .eq("kind", "template")
    .order("updated_at", { ascending: false });

  const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short" });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{de.letters.templatesTitle}</h1>
          <p className="text-muted-foreground text-sm">{de.letters.templatesSubtitle}</p>
        </div>
        <ButtonLink href="/app/briefe/vorlagen/neu">
          <Plus className="size-4" aria-hidden />
          {de.letters.newTemplate}
        </ButtonLink>
      </div>

      {!templates || templates.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <LayoutTemplate className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.letters.templatesEmpty}</p>
            <p>{de.letters.templatesEmptyHint}</p>
            <ButtonLink href="/app/briefe/vorlagen/neu" className="mt-2">
              {de.letters.newTemplate}
            </ButtonLink>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {templates.map((t) => (
            <TemplateRow
              key={t.id}
              id={t.id}
              name={t.name}
              updatedLabel={dateFmt.format(new Date(t.updated_at))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
