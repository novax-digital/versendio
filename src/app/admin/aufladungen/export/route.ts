import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCsv } from "@/lib/shared/csv";
import { grossFromNetCents } from "@/lib/shared/money";

const euro = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/**
 * Admin CSV export of all top-ups and manual credit bookings (German Excel
 * dialect: semicolon, comma decimals, BOM). VAT/gross columns are computed
 * (19 %) for Stripe top-ups only — the Stripe invoice stays authoritative.
 */
export async function GET() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data } = await admin
    .from("credit_transactions")
    .select(
      "type, amount_cents, comment, receipt_url, stripe_invoice_id, created_at, profiles(email, display_name)",
    )
    .in("type", ["topup", "admin_adjust"])
    .order("created_at", { ascending: false })
    .limit(10000);

  const rows = (data ?? []).map((tx) => {
    const profile = tx.profiles as unknown as { email: string | null; display_name: string | null } | null;
    const isStripeTopup = tx.type === "topup";
    const gross = isStripeTopup ? grossFromNetCents(tx.amount_cents) : null;
    return [
      new Date(tx.created_at).toISOString(),
      profile?.email ?? "",
      profile?.display_name ?? "",
      tx.type,
      tx.comment ?? "",
      euro(tx.amount_cents),
      gross != null ? euro(gross - tx.amount_cents) : "",
      gross != null ? euro(gross) : "",
      tx.stripe_invoice_id ?? "",
      tx.receipt_url ?? "",
    ];
  });

  const csv = buildCsv(
    [
      "Datum (ISO)",
      "E-Mail",
      "Name",
      "Art",
      "Kommentar",
      "Netto (EUR)",
      "USt. 19% (EUR)",
      "Brutto (EUR)",
      "Stripe-Rechnungs-ID",
      "Beleg-URL",
    ],
    rows,
  );

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="versendio-aufladungen-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
