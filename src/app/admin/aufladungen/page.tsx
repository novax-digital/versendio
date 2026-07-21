import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents, grossFromNetCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.credits.topupsTitle };

type TopupRow = {
  id: string;
  type: string;
  reference_type: string | null;
  amount_cents: number;
  comment: string | null;
  receipt_url: string | null;
  stripe_invoice_id: string | null;
  created_at: string;
  profiles: { email: string | null; display_name: string | null } | null;
};

export default async function AdminTopupsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data } = await admin
    .from("credit_transactions")
    .select(
      "id, type, reference_type, amount_cents, comment, receipt_url, stripe_invoice_id, created_at, profiles(email, display_name)",
    )
    .in("type", ["topup", "admin_adjust"])
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as TopupRow[];

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  // Sums cover real top-ups only (type 'topup'); admin corrections stay in the
  // table but out of the figures. Paid = actual Stripe money (net,
  // reference_type 'stripe_event'); everything else is gift credit (top-up
  // bonus, vouchers, review rewards) — a 10 € purchase with 2 € bonus is two
  // ledger rows and splits cleanly.
  const monthRows = rows.filter(
    (r) => r.type === "topup" && new Date(r.created_at) >= monthStart && r.amount_cents > 0,
  );
  const paidSum = monthRows
    .filter((r) => r.reference_type === "stripe_event")
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const freeSum = monthRows
    .filter((r) => r.reference_type !== "stripe_event")
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const monthSum = paidSum + freeSum;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{de.credits.topupsTitle}</h1>
          <p className="text-muted-foreground text-sm">{de.credits.topupsSubtitle}</p>
        </div>
        {/* Plain anchor: file download route, not a page. */}
        <a
          href="/admin/aufladungen/export"
          className="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
        >
          <FileDown className="size-4" aria-hidden />
          {de.credits.topupsExportCsv}
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.credits.topupsSumMonth}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCents(monthSum)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.credits.topupsSumPaid}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCents(paidSum)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.credits.topupsSumFree}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCents(freeSum)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.credits.topupsCount}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">{rows.length}</CardContent>
        </Card>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{de.credits.date}</TableHead>
              <TableHead>{de.credits.colCustomer}</TableHead>
              <TableHead>{de.credits.typeLabel}</TableHead>
              <TableHead className="text-right">{de.credits.colNet}</TableHead>
              <TableHead className="text-right">{de.credits.colVat}</TableHead>
              <TableHead className="text-right">{de.credits.colGross}</TableHead>
              <TableHead>{de.credits.receiptColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((tx) => {
              const isStripeTopup = tx.type === "topup";
              const gross = isStripeTopup ? grossFromNetCents(tx.amount_cents) : null;
              return (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(tx.created_at))}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <span className="block truncate">{tx.profiles?.email ?? "–"}</span>
                    {tx.profiles?.display_name ? (
                      <span className="text-muted-foreground block truncate text-xs">
                        {tx.profiles.display_name}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{de.credits.txType[tx.type] ?? tx.type}</Badge>
                    {tx.comment ? (
                      <span className="text-muted-foreground block max-w-48 truncate text-xs">
                        {tx.comment}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCents(tx.amount_cents)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {gross != null ? formatCents(gross - tx.amount_cents) : "–"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {gross != null ? formatCents(gross) : "–"}
                  </TableCell>
                  <TableCell>
                    {tx.stripe_invoice_id ? (
                      <a
                        href={`/admin/aufladungen/rechnung/${tx.id}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm underline underline-offset-4"
                      >
                        {de.credits.invoice}
                      </a>
                    ) : tx.receipt_url ? (
                      <a
                        href={tx.receipt_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm underline underline-offset-4"
                      >
                        {de.credits.receipt}
                      </a>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
