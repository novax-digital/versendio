import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { de } from "@/lib/i18n/de";
import { VouchersTable, type VoucherRow } from "./vouchers-table";

export const metadata: Metadata = { title: de.admin.voucherTitle };

export default async function AdminVouchersPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("vouchers")
    .select(
      "id, code, amount_cents, max_redemptions, redemption_count, valid_until, is_active, comment, created_at",
    )
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{de.admin.voucherTitle}</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">{de.admin.voucherHint}</p>
      </div>
      <VouchersTable vouchers={(data ?? []) as VoucherRow[]} />
    </div>
  );
}
