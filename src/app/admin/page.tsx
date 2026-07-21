import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/server/auth-context";
import { loadDashboardKpis } from "@/lib/server/admin/queries";
import { getLetterProvider } from "@/lib/server/providers";
import { isMockMode, serverEnv } from "@/lib/server/env";
import { stripeMode } from "@/lib/server/stripe";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.dashboard };

export default async function AdminDashboardPage() {
  await requireAdmin();
  const env = serverEnv();
  const [kpis, health] = await Promise.all([
    loadDashboardKpis(),
    getLetterProvider()
      .healthCheck()
      .catch(() => ({ ok: false, message: "nicht erreichbar" })),
  ]);

  const kpiCards = [
    { label: de.admin.usersTotal, value: String(kpis.usersTotal) },
    { label: de.admin.usersNew, value: String(kpis.usersNew30d) },
    { label: de.admin.lettersToday, value: String(kpis.lettersSentToday) },
    { label: de.admin.lettersMonth, value: String(kpis.lettersSentMonth) },
    {
      label: de.admin.topupRevenue,
      value: formatCents(kpis.topupRevenueMonthCents),
      hint: de.admin.topupSplitHint(
        formatCents(kpis.topupPaidMonthCents),
        formatCents(kpis.topupFreeMonthCents),
      ),
    },
    {
      label: de.admin.grossProfit,
      value: formatCents(kpis.grossProfitMonthCents),
      hint: de.admin.grossProfitHint,
    },
    {
      label: de.admin.errorRate,
      value: `${(kpis.errorRate30d * 100).toFixed(1).replace(".", ",")} %`,
    },
    { label: de.admin.activeJobs, value: String(kpis.jobsActive) },
    { label: de.admin.queueJobs, value: String(kpis.queuePending), hint: de.admin.queueJobsHint },
  ];

  return (
    <div className="space-y-6">
      {kpis.ledgerMismatches > 0 ? (
        <p className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm font-medium">
          <AlertTriangle className="size-4" aria-hidden />
          {de.admin.ledgerAlert(kpis.ledgerMismatches)}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-4" aria-hidden />
          {de.admin.ledgerOk}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {kpi.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{kpi.value}</p>
              {kpi.hint ? <p className="text-muted-foreground mt-1 text-xs">{kpi.hint}</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.admin.systemStatus}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground w-40">{de.admin.sendMode}</span>
            {isMockMode() ? (
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {de.common.mockBadge} (MockProvider)
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                {de.admin.liveMode}
              </Badge>
            )}
            <span className="text-muted-foreground text-xs">
              {env.MOCK_MODE
                ? de.admin.mockModeSet
                : isMockMode()
                  ? de.admin.mockConfigIncomplete
                  : de.admin.epostConfigured}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground w-40">{de.admin.providerHealth}</span>
            <Badge
              variant="outline"
              className={
                health.ok ? "border-emerald-500 text-emerald-600" : "border-destructive text-destructive"
              }
            >
              {health.ok ? "OK" : "Fehler"}
            </Badge>
            {health.message ? (
              <span className="text-muted-foreground text-xs">{health.message}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground w-40">Stripe</span>
            <Badge
              variant={stripeMode() === "disabled" ? "secondary" : "outline"}
              className={stripeMode() === "live" ? "border-emerald-500 text-emerald-600" : ""}
            >
              {stripeMode() === "live"
                ? "Live-Modus aktiv"
                : stripeMode() === "test"
                  ? "Testmodus aktiv"
                  : "Deaktiviert (FEATURE_STRIPE=false)"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
