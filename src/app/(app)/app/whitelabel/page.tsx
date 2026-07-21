import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Mail, Wallet } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { loadWlCustomersWithUsage } from "@/lib/server/whitelabel/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { CustomersTable } from "./customers-table";

export const metadata: Metadata = { title: de.whitelabel.title };

export default async function WhitelabelPage() {
  const profile = await requireProfile();
  if (!profile.is_whitelabel) redirect("/app");

  const customers = await loadWlCustomersWithUsage(profile.id);
  const monthLetters = customers.reduce((sum, c) => sum + c.month.lettersSent, 0);
  const monthCost = customers.reduce((sum, c) => sum + c.month.costCents, 0);

  const kpis = [
    { icon: Building2, label: de.whitelabel.kpiCustomers, value: String(customers.length) },
    { icon: Mail, label: de.whitelabel.kpiLettersMonth, value: String(monthLetters) },
    { icon: Wallet, label: de.whitelabel.kpiCostMonth, value: formatCents(monthCost) },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.whitelabel.title}</h1>
        <p className="text-muted-foreground text-sm">{de.whitelabel.subtitle}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4" aria-hidden />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      <CustomersTable customers={customers} />

      <p className="text-muted-foreground text-sm">
        {de.whitelabel.apiHintPrefix}{" "}
        <a href="/app/einstellungen/integrationen" className="text-primary underline underline-offset-4">
          {de.whitelabel.apiHintLink}
        </a>
        {de.whitelabel.apiHintSuffix}
      </p>
    </div>
  );
}
