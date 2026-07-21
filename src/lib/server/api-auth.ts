import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { hashApiKey, looksLikeApiKey } from "@/lib/server/api-keys";

export type ApiAuth = { userId: string; keyId: string };

type ApiError = { status: number; body: { error: string; message: string } };

function err(status: number, error: string, message: string): ApiError {
  return { status, body: { error, message } };
}

/**
 * Authenticates an Integrations REST request from its `Authorization: Bearer`
 * key. Returns the owning user or a ready-to-send error response. Keys are
 * matched by SHA-256 hash; a revoked key or a non-active owner is rejected, so
 * blocking/anonymizing an account disables its keys everywhere.
 */
export async function authenticateApiRequest(
  request: Request,
): Promise<{ auth: ApiAuth } | { error: ApiError }> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const key = match?.[1]?.trim();
  if (!key || !looksLikeApiKey(key)) {
    return { error: err(401, "unauthorized", "Fehlender oder ungültiger API-Schlüssel.") };
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at, profiles!inner(status)")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();

  if (!row || row.revoked_at) {
    return { error: err(401, "unauthorized", "Der API-Schlüssel ist ungültig oder widerrufen.") };
  }
  const status = (row.profiles as unknown as { status: string } | null)?.status;
  if (status !== "active") {
    return { error: err(403, "forbidden", "Das Konto ist nicht aktiv.") };
  }

  // Per-key rate limit (shared Postgres limiter).
  if (!(await checkRateLimit("api", `key:${row.id}`))) {
    return { error: err(429, "rate_limited", "Zu viele Anfragen. Bitte später erneut versuchen.") };
  }

  // Best-effort usage timestamp; never blocks the request.
  void admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", row.id);

  return { auth: { userId: row.user_id, keyId: row.id } };
}

/**
 * Gate for whitelabel-only endpoints: the key owner's account must carry the
 * admin-granted is_whitelabel flag. Returns a ready-to-send 403 otherwise.
 */
export async function requireWhitelabelApi(userId: string): Promise<ApiError | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("is_whitelabel")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.is_whitelabel) {
    return err(403, "forbidden", "Whitelabel ist für dieses Konto nicht freigeschaltet.");
  }
  return null;
}

export function apiError(error: ApiError): NextResponse {
  return NextResponse.json(error.body, { status: error.status });
}

export function apiJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
