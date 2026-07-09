import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { SendWizard } from "./send-wizard";

export const metadata: Metadata = { title: de.send.title };

export default async function SendPage({
  searchParams,
}: {
  searchParams: Promise<{ brief?: string }>;
}) {
  await requireProfile();
  const { brief } = await searchParams;
  const supabase = await createClient();

  const [{ data: letters }, { data: leadLists }, { data: senderAddresses }] = await Promise.all([
    supabase
      .from("letters")
      .select("id, title, source, page_count, sheet_count, has_placeholders")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("lead_lists")
      .select("id, name, lead_list_entries(count)")
      .order("created_at", { ascending: false }),
    supabase
      .from("sender_addresses")
      .select("id, label, is_default")
      .order("is_default", { ascending: false }),
  ]);

  return (
    <SendWizard
      letters={letters ?? []}
      leadLists={(leadLists ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        count: (l.lead_list_entries as unknown as { count: number }[])[0]?.count ?? 0,
      }))}
      senderAddresses={senderAddresses ?? []}
      preselectedLetterId={brief ?? null}
    />
  );
}
