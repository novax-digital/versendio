import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "@/lib/server/api-keys";

describe("api keys", () => {
  it("generates a vk_live_ key, its sha256 hash, and a display prefix", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(key).toMatch(/^vk_live_[0-9a-f]{40}$/);
    expect(hash).toBe(createHash("sha256").update(key).digest("hex"));
    expect(hash).toHaveLength(64);
    expect(prefix).toBe(`${key.slice(0, 12)}…`);
    // The stored prefix must not reveal the full secret.
    expect(key.startsWith(prefix.replace("…", ""))).toBe(true);
    expect(prefix).not.toContain(key.slice(12));
  });

  it("hashing is stable and unique per key", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.hash).not.toBe(b.hash);
    expect(hashApiKey(a.key)).toBe(a.hash);
  });

  it("validates the key shape", () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    expect(looksLikeApiKey("vk_live_short")).toBe(false);
    expect(looksLikeApiKey("nope")).toBe(false);
    expect(looksLikeApiKey("sk_live_" + "a".repeat(40))).toBe(false);
    expect(looksLikeApiKey("vk_live_" + "A".repeat(40))).toBe(false); // uppercase not hex
  });
});
