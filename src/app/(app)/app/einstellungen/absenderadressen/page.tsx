import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { SenderAddressList, type SenderAddress } from "./sender-address-list";

export const metadata: Metadata = { title: de.senderAddresses.title };

export default async function SenderAddressesPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("sender_addresses")
    .select(
      "id, label, company, first_name, last_name, street, zip, city, country, sender_line, is_default",
    )
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground max-w-2xl text-sm">{de.senderAddresses.subtitle}</p>
      <SenderAddressList addresses={(data ?? []) as SenderAddress[]} />
    </div>
  );
}
