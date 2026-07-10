import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export type RateLimitScope = "login" | "register" | "forgot_password" | "upload" | "send" | "ai";

const LIMITS: Record<RateLimitScope, { limit: number; windowSeconds: number }> = {
  login: { limit: 10, windowSeconds: 300 },
  register: { limit: 5, windowSeconds: 3600 },
  forgot_password: { limit: 5, windowSeconds: 3600 },
  upload: { limit: 30, windowSeconds: 3600 },
  send: { limit: 20, windowSeconds: 3600 },
  ai: { limit: 5, windowSeconds: 60 },
};

/**
 * Trusted client IP for rate-limit keying. On Vercel the leftmost
 * x-forwarded-for entry is client-supplied and spoofable, so we prefer the
 * platform-set x-real-ip and otherwise take the rightmost XFF hop (appended
 * by the trusted proxy), never the leftmost.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * Postgres-backed fixed-window rate limit (ADR-0002). Returns true while
 * under the limit. Fails open on infrastructure errors — availability over
 * strictness for a soft control.
 */
export async function checkRateLimit(scope: RateLimitScope, key: string): Promise<boolean> {
  const { limit, windowSeconds } = LIMITS[scope];
  // "ai" guards metered external spend — deny on infrastructure errors.
  return checkCustomLimit(`${scope}:${key}`, limit, windowSeconds, { failClosed: scope === "ai" });
}

/**
 * Same RPC with a caller-supplied limit/window — for quotas whose limit comes
 * from app_settings (e.g. the daily AI draft quota). `failClosed` inverts the
 * availability trade-off for resources where an unmetered call is worse than
 * a denied one.
 */
export async function checkCustomLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: { failClosed?: boolean } = {},
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("rate_limit_check_failed", { key: key.split(":")[0], error: error.message });
    return !opts.failClosed;
  }
  return data === true;
}
