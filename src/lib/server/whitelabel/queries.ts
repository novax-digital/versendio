import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whitelabel data access. Admin client with explicit user_id scoping (the
 * admin/queries pattern): callers must be behind requireProfile with the
 * is_whitelabel flag checked. All figures are VK-only.
 */

export type WlCustomerRow = {
  id: string;
  name: string;
  external_ref: string | null;
  email: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

export type WlUsage = {
  lettersSent: number;
  costCents: number;
  lettersFailedRefunded: number;
};

export type WlCustomerWithUsage = WlCustomerRow & {
  total: WlUsage;
  month: WlUsage;
};

const EMPTY_USAGE: WlUsage = { lettersSent: 0, costCents: 0, lettersFailedRefunded: 0 };

type UsageRow = {
  customer_id: string;
  letters_sent: number | string;
  cost_cents: number | string;
  letters_failed_refunded: number | string;
};

function toUsageMap(rows: UsageRow[] | null): Map<string, WlUsage> {
  const map = new Map<string, WlUsage>();
  for (const row of rows ?? []) {
    map.set(row.customer_id, {
      lettersSent: Number(row.letters_sent),
      costCents: Number(row.cost_cents),
      lettersFailedRefunded: Number(row.letters_failed_refunded),
    });
  }
  return map;
}

/** Customers with all-time and current-month usage, newest first. */
export async function loadWlCustomersWithUsage(userId: string): Promise<WlCustomerWithUsage[]> {
  const admin = createAdminClient();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: customers }, { data: totalRows }, { data: monthRows }] = await Promise.all([
    admin
      .from("wl_customers")
      .select("id, name, external_ref, email, notes, is_active, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin.rpc("wl_customer_usage", { p_user_id: userId }),
    admin.rpc("wl_customer_usage", { p_user_id: userId, p_from: monthStart.toISOString() }),
  ]);

  const total = toUsageMap(totalRows as UsageRow[] | null);
  const month = toUsageMap(monthRows as UsageRow[] | null);

  return ((customers ?? []) as WlCustomerRow[]).map((c) => ({
    ...c,
    total: total.get(c.id) ?? EMPTY_USAGE,
    month: month.get(c.id) ?? EMPTY_USAGE,
  }));
}

/** Usage for one end-customer (API endpoint), optional period. */
export async function loadWlCustomerUsage(
  userId: string,
  customerId: string,
  from?: string,
  to?: string,
): Promise<WlUsage> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("wl_customer_usage", {
    p_user_id: userId,
    p_from: from ?? null,
    p_to: to ?? null,
  });
  if (error) {
    console.error("wl_usage_failed", { error: error.message });
    throw new Error("usage_failed");
  }
  const map = toUsageMap(data as UsageRow[] | null);
  return map.get(customerId) ?? EMPTY_USAGE;
}
