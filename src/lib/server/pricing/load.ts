import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PricingRow } from "@/lib/shared/pricing";

/**
 * Loads active pricing rows. Service-role only: the table has no client
 * policies because EK prices are a trade secret (ADR-0002 §4) — callers must
 * never pass EK values to the client.
 */
export async function loadPricingRows(): Promise<PricingRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pricing_table")
    .select("option_key, kind, zone, ek_cents, vk_cents, active")
    .eq("active", true);
  if (error || !data) {
    console.error("pricing_load_failed", { error: error?.message });
    throw new Error("pricing unavailable");
  }
  return data as PricingRow[];
}

export type RegisteredOption = "einwurf" | "einschreiben" | "rueckschein";

/**
 * Registered-mail options whose surcharge row is currently active. The wizard
 * only offers these — an inactive option would make calculateLetterPrice throw
 * (inactive_option) and the customer would hit "Preis nicht verfügbar".
 */
export async function loadActiveRegisteredOptions(): Promise<RegisteredOption[]> {
  const rows = await loadPricingRows();
  const active = new Set(rows.filter((r) => r.kind === "surcharge").map((r) => r.option_key));
  return (["einwurf", "einschreiben", "rueckschein"] as const).filter((k) =>
    active.has(`surcharge_registered_${k}`),
  );
}

/** Plan discount for a user (0 when no plan assigned). */
export async function loadDiscountPercent(planId: string | null): Promise<number> {
  if (!planId) return 0;
  const admin = createAdminClient();
  const { data } = await admin
    .from("plans")
    .select("discount_percent")
    .eq("id", planId)
    .maybeSingle();
  return Number(data?.discount_percent ?? 0);
}
