import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { de } from "@/lib/i18n/de";
import { PricingTable, type PricingOption } from "./pricing-table";

export const metadata: Metadata = { title: de.admin.pricingTitle };

export default async function AdminPricingPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("pricing_table")
    .select("id, option_key, display_name_de, kind, zone, ek_cents, vk_cents, active, sort_order")
    .order("sort_order");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground max-w-3xl text-sm">{de.admin.pricingHint}</p>
      <PricingTable options={(rows ?? []) as PricingOption[]} />
    </div>
  );
}
