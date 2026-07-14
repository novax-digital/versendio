import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Integration API keys. The plaintext key is shown to the user exactly once;
 * only its SHA-256 hash is stored. Format: vk_live_<40 hex chars>.
 */
const KEY_PREFIX = "vk_live_";

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(20).toString("hex"); // 40 hex chars
  const key = `${KEY_PREFIX}${secret}`;
  return { key, hash: hashApiKey(key), prefix: `${key.slice(0, 12)}…` };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Cheap shape check before hitting the DB. */
export function looksLikeApiKey(value: string): boolean {
  return /^vk_live_[0-9a-f]{40}$/.test(value);
}
