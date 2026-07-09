import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/server/env";

/**
 * AES-256-GCM encryption for provider credentials and cached tokens
 * (ADR-0005 §6). Versioned format `v1:<iv>:<authTag>:<ciphertext>` (base64
 * segments) so the key/format can be rotated later.
 */

const VERSION = "v1";

function key(): Buffer {
  const raw = serverEnv().EPOST_CREDENTIALS_KEY;
  if (!raw) {
    throw new Error("EPOST_CREDENTIALS_KEY is not configured");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("EPOST_CREDENTIALS_KEY must be 32 bytes, base64-encoded");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored: string): string {
  const [version, ivB64, tagB64, dataB64] = stored.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unsupported encrypted payload format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
