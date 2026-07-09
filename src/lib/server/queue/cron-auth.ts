import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/server/env";

/**
 * Guards worker endpoints: requires `Authorization: Bearer <CRON_SECRET>`.
 * Vercel Cron sends this header automatically when CRON_SECRET is set.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
