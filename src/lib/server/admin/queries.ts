import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin data access via the service-role client (bypasses RLS). Every caller
 * must be behind requireAdmin() first (defense in depth). EK/margin figures
 * are admin-only and computed here, never on user-facing pages.
 */

export type AdminDashboardKpis = {
  usersTotal: number;
  usersNew30d: number;
  lettersSentToday: number;
  lettersSentMonth: number;
  topupRevenueMonthCents: number;
  topupPaidMonthCents: number;
  topupFreeMonthCents: number;
  grossProfitMonthCents: number;
  errorRate30d: number;
  queuePending: number;
  ledgerMismatches: number;
};

const BUSINESS_TZ = "Europe/Berlin";

/** Start of the current day/month in the business timezone, as an ISO instant. */
function businessBoundaries(now: Date): { dayStart: string; monthStart: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");

  // Resolve the local wall-clock midnight back to a UTC instant by measuring
  // the zone offset at that moment.
  const toInstant = (isoLocal: string): string => {
    const guess = new Date(`${isoLocal}Z`);
    const asZoned = new Date(guess.toLocaleString("en-US", { timeZone: BUSINESS_TZ }));
    const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    const offsetMs = asZoned.getTime() - asUtc.getTime();
    return new Date(guess.getTime() - offsetMs).toISOString();
  };

  return {
    dayStart: toInstant(`${year}-${month}-${day}T00:00:00`),
    monthStart: toInstant(`${year}-${month}-01T00:00:00`),
  };
}

export async function loadDashboardKpis(): Promise<AdminDashboardKpis> {
  const admin = createAdminClient();
  const now = new Date();
  const { dayStart, monthStart } = businessBoundaries(now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const [
    { count: usersTotal },
    { count: usersNew30d },
    { data: stats },
    { count: queuePending },
    { data: mismatches },
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).neq("status", "deleted"),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo),
    // Aggregated in SQL: transferring every row would not scale and would
    // silently under-report if a PostgREST max-rows limit were configured.
    admin.rpc("admin_dashboard_stats", {
      p_month_start: monthStart,
      p_day_start: dayStart,
      p_since: thirtyDaysAgo,
    }),
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.rpc("check_ledger_integrity"),
  ]);

  const row = Array.isArray(stats) ? stats[0] : stats;
  const finalItems = Number(row?.items_final_30d ?? 0);
  const failedItems = Number(row?.items_failed_30d ?? 0);

  return {
    usersTotal: usersTotal ?? 0,
    usersNew30d: usersNew30d ?? 0,
    lettersSentToday: Number(row?.letters_sent_today ?? 0),
    lettersSentMonth: Number(row?.letters_sent_month ?? 0),
    topupRevenueMonthCents: Number(row?.topup_revenue_month_cents ?? 0),
    topupPaidMonthCents: Number(row?.topup_paid_month_cents ?? 0),
    topupFreeMonthCents: Number(row?.topup_free_month_cents ?? 0),
    grossProfitMonthCents: Number(row?.gross_profit_month_cents ?? 0),
    errorRate30d: finalItems > 0 ? failedItems / finalItems : 0,
    queuePending: queuePending ?? 0,
    ledgerMismatches: Array.isArray(mismatches) ? mismatches.length : 0,
  };
}
