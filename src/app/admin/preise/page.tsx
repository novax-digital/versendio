import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Separator } from "@/components/ui/separator";
import { de } from "@/lib/i18n/de";
import { PricingTable, type PricingOption } from "./pricing-table";
import { ConditionsTable, type Plan } from "./conditions-table";

export const metadata: Metadata = { title: de.admin.pricingTitle };

export default async function AdminPricingPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const [{ data: rows }, { data: plans }] = await Promise.all([
    admin
      .from("pricing_table")
      .select("id, option_key, display_name_de, kind, zone, ek_cents, vk_cents, active, sort_order")
      .order("sort_order"),
    admin
      .from("plans")
      .select("id, name, discount_percent, is_default")
      .order("is_default", { ascending: false })
      .order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-muted-foreground max-w-3xl text-sm">{de.admin.pricingHint}</p>
        <PricingTable options={(rows ?? []) as PricingOption[]} />
      </div>
      <Separator />
      <ConditionsTable
        plans={(plans ?? []).map((p) => ({
          ...p,
          discount_percent: Number(p.discount_percent),
        })) as Plan[]}
      />
    </div>
  );
}
