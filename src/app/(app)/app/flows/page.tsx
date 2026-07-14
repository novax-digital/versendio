import type { Metadata } from "next";
import { Workflow } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { Card, CardContent } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { FlowList, type FlowRow } from "./flow-list";

export const metadata: Metadata = { title: de.flows.title };

export default async function FlowsPage() {
  await requireProfile();
  const supabase = await createClient();

  const { data } = await supabase
    .from("flows")
    .select("id, name, is_active, delay_minutes, lead_lists(name), letters(title), flow_enrollments(count)")
    .order("created_at", { ascending: false });

  const flows: FlowRow[] = (data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    isActive: f.is_active,
    delayMinutes: f.delay_minutes,
    listName: (f.lead_lists as unknown as { name: string } | null)?.name ?? "–",
    letterTitle: (f.letters as unknown as { title: string } | null)?.title ?? "–",
    enrollments: (f.flow_enrollments as unknown as { count: number }[])[0]?.count ?? 0,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{de.flows.title}</h1>
          <p className="text-muted-foreground text-sm">{de.flows.subtitle}</p>
        </div>
        <ButtonLink href="/app/flows/neu">{de.flows.newFlow}</ButtonLink>
      </div>

      {flows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <Workflow className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.flows.empty}</p>
            <p>{de.flows.emptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <FlowList flows={flows} />
      )}
    </div>
  );
}
