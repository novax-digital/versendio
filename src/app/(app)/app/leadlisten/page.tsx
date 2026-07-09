import type { Metadata } from "next";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { LeadListHeader } from "./lead-list-header";

export const metadata: Metadata = { title: de.leadLists.title };

export default async function LeadListsPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data: lists } = await supabase
    .from("lead_lists")
    .select("id, name, description, source, lead_list_entries(count)")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <LeadListHeader />

      {!lists || lists.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <ListChecks className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.leadLists.empty}</p>
            <p>{de.leadLists.emptyCta}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {lists.map((list) => {
            const count = (list.lead_list_entries as unknown as { count: number }[])[0]?.count ?? 0;
            return (
              <li key={list.id}>
                <Link
                  href={`/app/leadlisten/${list.id}`}
                  className="focus-visible:ring-ring block rounded-lg focus-visible:ring-2 focus-visible:outline-none"
                >
                  <Card className="hover:border-primary h-full transition-colors">
                    <CardContent className="space-y-1 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate font-medium">{list.name}</p>
                        <Badge variant="secondary">
                          {list.source === "import"
                            ? de.leadLists.sourceImport
                            : de.leadLists.sourceManual}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {de.leadLists.entries(count)}
                      </p>
                      {list.description ? (
                        <p className="text-muted-foreground truncate text-xs">{list.description}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
