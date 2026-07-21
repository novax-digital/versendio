import { z } from "zod";
import {
  authenticateApiRequest,
  requireWhitelabelApi,
  apiError,
  apiJson,
} from "@/lib/server/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CUSTOMER_COLUMNS = "id, name, external_ref, email, is_active, created_at";

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  externalRef: z.string().trim().max(80).optional(),
  email: z.string().trim().email().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * POST /api/v1/customers — create an end-customer for the key owner
 * (whitelabel only). With an externalRef the call is idempotent: a duplicate
 * returns 409 with the existing record, so integrations can upsert blindly.
 */
export async function POST(request: Request) {
  const result = await authenticateApiRequest(request);
  if ("error" in result) return apiError(result.error);
  const { userId } = result.auth;
  const wlErr = await requireWhitelabelApi(userId);
  if (wlErr) return apiError(wlErr);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiJson({ error: "invalid_json", message: "Ungültiges JSON im Anfragekörper." }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiJson(
      {
        error: "validation_error",
        message: "Die Endkundendaten sind unvollständig oder ungültig.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      422,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("wl_customers")
    .insert({
      user_id: userId,
      name: parsed.data.name,
      external_ref: parsed.data.externalRef || null,
      email: parsed.data.email || null,
      notes: parsed.data.notes || null,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      const { data: existing } = await admin
        .from("wl_customers")
        .select(CUSTOMER_COLUMNS)
        .eq("user_id", userId)
        .eq("external_ref", parsed.data.externalRef ?? "")
        .maybeSingle();
      return apiJson(
        {
          error: "external_ref_exists",
          message: "Ein Endkunde mit dieser Kundennummer existiert bereits.",
          customer: existing ?? undefined,
        },
        409,
      );
    }
    console.error("api_wl_customer_create_failed", { error: error.message });
    return apiJson(
      { error: "server_error", message: "Der Endkunde konnte nicht angelegt werden." },
      500,
    );
  }

  return apiJson({ customer: data }, 201);
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/v1/customers — list the key owner's end-customers (paginated). */
export async function GET(request: Request) {
  const result = await authenticateApiRequest(request);
  if ("error" in result) return apiError(result.error);
  const { userId } = result.auth;
  const wlErr = await requireWhitelabelApi(userId);
  if (wlErr) return apiError(wlErr);

  const url = new URL(request.url);
  const q = listQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) {
    return apiJson({ error: "validation_error", message: "Ungültige Query-Parameter." }, 422);
  }

  const admin = createAdminClient();
  const { data, count, error } = await admin
    .from("wl_customers")
    .select(CUSTOMER_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(q.data.offset, q.data.offset + q.data.limit - 1);

  if (error) {
    console.error("api_wl_customer_list_failed", { error: error.message });
    return apiJson(
      { error: "server_error", message: "Die Endkunden konnten nicht geladen werden." },
      500,
    );
  }

  return apiJson({
    customers: data ?? [],
    total: count ?? 0,
    limit: q.data.limit,
    offset: q.data.offset,
  });
}
