import { z } from "zod";
import {
  authenticateApiRequest,
  requireWhitelabelApi,
  apiError,
  apiJson,
} from "@/lib/server/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadWlCustomerUsage } from "@/lib/server/whitelabel/queries";

export const dynamic = "force-dynamic";

// ISO dates or full timestamps; must also parse to a real date (2026-13-40
// matches the regex but is invalid and would throw at toISOString).
const isoDate = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
  .refine((s) => !Number.isNaN(Date.parse(s)), "invalid date");

const usageQuery = z.object({
  // from is inclusive, to exclusive.
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/**
 * GET /api/v1/customers/{id}/usage?from&to — billing values for one
 * end-customer, for re-charging by the whitelabel customer. Counts only
 * letters with status "sent" (what DP actually invoices), excludes test
 * sends, reports refunded failures separately. Amounts are VK cents (net,
 * what the account was charged).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const result = await authenticateApiRequest(request);
  if ("error" in result) return apiError(result.error);
  const { userId } = result.auth;
  const wlErr = await requireWhitelabelApi(userId);
  if (wlErr) return apiError(wlErr);

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiJson({ error: "validation_error", message: "Ungültige Endkunden-ID." }, 422);
  }
  const url = new URL(request.url);
  const q = usageQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) {
    return apiJson(
      { error: "validation_error", message: "Ungültige Query-Parameter (from/to als ISO-Datum)." },
      422,
    );
  }

  // Ownership: the end-customer must belong to the key owner.
  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("wl_customers")
    .select("id, name, external_ref")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!customer) {
    return apiJson({ error: "not_found", message: "Endkunde nicht gefunden." }, 404);
  }

  const from = q.data.from ? new Date(q.data.from).toISOString() : undefined;
  const to = q.data.to ? new Date(q.data.to).toISOString() : undefined;

  try {
    const usage = await loadWlCustomerUsage(userId, id, from, to);
    return apiJson({
      customerId: customer.id,
      externalRef: customer.external_ref,
      periodFrom: from ?? null,
      periodTo: to ?? null,
      lettersSent: usage.lettersSent,
      costCents: usage.costCents,
      lettersFailedRefunded: usage.lettersFailedRefunded,
    });
  } catch {
    return apiJson(
      { error: "server_error", message: "Die Verbrauchswerte konnten nicht geladen werden." },
      500,
    );
  }
}
