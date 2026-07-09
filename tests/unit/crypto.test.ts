import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.EPOST_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a secret", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/server/crypto");
    const secret = "geheimes-passwort-äöü-123";
    const stored = encryptSecret(secret);
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });

  it("produces distinct ciphertexts for the same input (fresh IV)", async () => {
    const { encryptSecret } = await import("@/lib/server/crypto");
    expect(encryptSecret("gleich")).not.toBe(encryptSecret("gleich"));
  });

  it("rejects tampered payloads (auth tag)", async () => {
    const { encryptSecret, decryptSecret } = await import("@/lib/server/crypto");
    const stored = encryptSecret("original");
    const parts = stored.split(":");
    const tampered = Buffer.from(parts[3], "base64");
    tampered[0] ^= 0xff;
    parts[3] = tampered.toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("rejects unsupported formats", async () => {
    const { decryptSecret } = await import("@/lib/server/crypto");
    expect(() => decryptSecret("v2:a:b:c")).toThrow();
    expect(() => decryptSecret("garbage")).toThrow();
  });
});
