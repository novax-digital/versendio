import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Badge } from "@/components/ui/badge";
import { de } from "@/lib/i18n/de";
import { ListDetail, type ListEntry } from "./list-detail";

export const metadata: Metadata = { title: de.leadLists.title };

export default async function LeadListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: list }, { data: entries }] = await Promise.all([
    supabase.from("lead_lists").select("id, name, description, source").eq("id", id).single(),
    supabase
      .from("lead_list_entries")
      .select(
        "id, contact_id, contacts(id, salutation, first_name, last_name, company, street, zip, city, country)",
      )
      .eq("list_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!list) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{list.name}</h1>
        <Badge variant="secondary">
          {list.source === "import" ? de.leadLists.sourceImport : de.leadLists.sourceManual}
        </Badge>
      </div>
      {list.description ? (
        <p className="text-muted-foreground text-sm">{list.description}</p>
      ) : null}
      <ListDetail listId={list.id} entries={(entries ?? []) as unknown as ListEntry[]} />
    </div>
  );
}
