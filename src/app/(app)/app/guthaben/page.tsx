import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { stripeEnabled } from "@/lib/server/stripe";
import { getJsonSetting, getNumberSetting } from "@/lib/server/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/shared/money";
import type { BonusTier } from "@/lib/shared/topup-bonus";
import { de } from "@/lib/i18n/de";
import { TopupSection } from "./topup-section";
import { AutoTopupSection } from "./auto-topup-section";
import { BillingAddressCard } from "./billing-address-card";
import { StatusToast } from "./status-toast";

export const metadata: Metadata = { title: de.credits.title };

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; setup?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;
  const supabase = await createClient();

  const [transactions, amounts, minCents, bonusTiers] = await Promise.all([
    supabase
      .from("credit_transactions")
      .select(
        "id, type, amount_cents, balance_after_cents, comment, receipt_url, stripe_invoice_id, created_at",
      )
      // Explicit own-scope: the RLS policy widens for admins, and this page is
      // always the caller's personal view.
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(200)
      .then((r) => r.data ?? []),
    getJsonSetting<number[]>("topup_amounts_cents", [1000, 2500, 5000, 10000]),
    getNumberSetting("topup_min_cents", 1000),
    getJsonSetting<BonusTier[]>("topup_bonus_tiers", []),
  ]);

  const stripeOn = stripeEnabled();

  let autoTopup: {
    enabled: boolean;
    thresholdCents: number;
    amountCents: number;
    hasPaymentMethod: boolean;
  } | null = null;
  if (stripeOn) {
    const admin = createAdminClient();
    const { data: account } = await admin
      .from("billing_accounts")
      .select(
        "auto_topup_enabled, auto_topup_threshold_cents, auto_topup_amount_cents, default_payment_method_id",
      )
      .eq("user_id", profile.id)
      .maybeSingle();
    autoTopup = {
      enabled: account?.auto_topup_enabled ?? false,
      thresholdCents: account?.auto_topup_threshold_cents ?? 500,
      amountCents: account?.auto_topup_amount_cents ?? 2500,
      hasPaymentMethod: !!account?.default_payment_method_id,
    };
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <StatusToast status={params.status ?? null} setup={params.setup ?? null} />
      <div>
        <h1 className="text-2xl font-semibold">{de.credits.title}</h1>
        <p className="text-muted-foreground text-sm">{de.credits.subtitle}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Wallet className="size-4" aria-hidden />
              {de.credits.currentBalance}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold">{formatCents(profile.credit_balance_cents)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.credits.topupTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {stripeOn ? (
              <TopupSection amountsCents={amounts} minCents={minCents} bonusTiers={bonusTiers} />
            ) : (
              <p className="text-muted-foreground text-sm">{de.credits.betaHint}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <BillingAddressCard
        defaults={{
          displayName: profile.display_name ?? "",
          company: profile.company ?? "",
          billingStreet: profile.billing_street ?? "",
          billingZip: profile.billing_zip ?? "",
          billingCity: profile.billing_city ?? "",
          billingCountry: profile.billing_country ?? "DE",
        }}
      />

      {stripeOn && autoTopup ? (
        <AutoTopupSection
          enabled={autoTopup.enabled}
          thresholdCents={autoTopup.thresholdCents}
          amountCents={autoTopup.amountCents}
          hasPaymentMethod={autoTopup.hasPaymentMethod}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.credits.transactionsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {de.credits.transactionsEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{de.credits.date}</TableHead>
                    <TableHead>{de.credits.typeLabel}</TableHead>
                    <TableHead className="text-right">{de.credits.amount}</TableHead>
                    <TableHead className="text-right">{de.credits.balanceAfter}</TableHead>
                    <TableHead>{de.credits.receiptColumn}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Intl.DateTimeFormat("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(tx.created_at))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tx.amount_cents >= 0 ? "outline" : "secondary"}>
                          {de.credits.txType[tx.type] ?? tx.type}
                        </Badge>
                        {tx.comment ? (
                          <span className="text-muted-foreground block max-w-56 truncate text-xs">
                            {tx.comment}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${tx.amount_cents >= 0 ? "text-emerald-700 dark:text-emerald-400" : ""}`}
                      >
                        {tx.amount_cents >= 0 ? "+" : ""}
                        {formatCents(tx.amount_cents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(tx.balance_after_cents)}
                      </TableCell>
                      <TableCell>
                        {tx.stripe_invoice_id ? (
                          // Fresh PDF via Stripe (survives expired snapshot URLs).
                          <a
                            href={`/app/guthaben/rechnung/${tx.id}`}
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
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
