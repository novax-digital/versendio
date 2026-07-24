import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/server/crypto";
import { serverEnv } from "@/lib/server/env";

/**
 * Canva Connect API client (https://www.canva.dev/docs/connect/).
 * OAuth 2.0 Authorization Code + PKCE; access tokens live ~4 h, refresh
 * tokens are SINGLE-USE and rotate on every refresh — the rotated pair is
 * persisted (encrypted) before the access token is handed out. Scopes:
 * design:meta:read (list designs) + design:content:read (export PDFs).
 */

const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
const API_BASE = "https://api.canva.com/rest/v1";
export const CANVA_SCOPES = "design:meta:read design:content:read";

const TIMEOUT_MS = 15_000;

export class CanvaError extends Error {
  constructor(
    message: string,
    /** true → retry later; false → credentials/permanent (reconnect). */
    public readonly transient: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CanvaError";
  }
}

export function canvaConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.CANVA_CLIENT_ID && env.CANVA_CLIENT_SECRET);
}

function clientCredentials(): { id: string; secret: string } {
  const env = serverEnv();
  if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET) {
    throw new CanvaError("canva_not_configured", false);
  }
  return { id: env.CANVA_CLIENT_ID, secret: env.CANVA_CLIENT_SECRET };
}

// --- OAuth ------------------------------------------------------------------

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url"); // 64 chars, in 43–128 range
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildCanvaAuthUrl(opts: {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}): string {
  const { id } = clientCredentials();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: CANVA_SCOPES,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "s256",
    state: opts.state,
    redirect_uri: opts.redirectUri,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export type CanvaTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

async function tokenRequest(body: URLSearchParams): Promise<CanvaTokens> {
  const { id, secret } = clientCredentials();
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CanvaError("network_error", true);
  }
  if (!res.ok) {
    // 400/401 on a token grant = invalid/expired/reused code or refresh token.
    throw new CanvaError(`token_${res.status}`, res.status >= 500, res.status);
  }
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || !data.refresh_token) {
    throw new CanvaError("token_malformed", false);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 14400) * 1000),
  };
}

export function exchangeCanvaCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<CanvaTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  );
}

function refreshCanvaTokens(refreshToken: string): Promise<CanvaTokens> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

/** Persists a token pair (encrypted) for the user. */
export async function storeCanvaTokens(userId: string, tokens: CanvaTokens): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.from("canva_accounts").upsert(
    {
      user_id: userId,
      access_token_enc: encryptSecret(tokens.accessToken),
      refresh_token_enc: encryptSecret(tokens.refreshToken),
      token_expires_at: tokens.expiresAt.toISOString(),
      status: "active",
      last_error: null,
    },
    { onConflict: "user_id" },
  );
  if (error) console.error("canva_token_store_failed", { error: error.message });
  return !error;
}

/**
 * Returns a currently valid access token for the user, refreshing when the
 * stored one is near expiry. Canva refresh tokens are SINGLE-USE, so the
 * rotation is guarded against concurrent callers (two tabs, page render +
 * import action):
 * - the rotated pair is persisted via CAS on the refresh token we consumed —
 *   a concurrent reconnect can never be clobbered;
 * - a refresh rejection re-reads the row first: if another request already
 *   rotated, we use its fresh pair instead of falsely flagging the account;
 * - a persist failure retries once and then surfaces as TRANSIENT (the next
 *   caller re-reads) instead of silently handing out an unpersisted pair.
 * Returns null when not connected; throws CanvaError(transient=false) only
 * when the grant is genuinely dead — the account is flagged for reconnect.
 */
export async function getValidCanvaAccessToken(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("canva_accounts")
    .select("access_token_enc, refresh_token_enc, token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!account) return null;

  const expiresAt = new Date(account.token_expires_at).getTime();
  if (expiresAt - Date.now() > 5 * 60 * 1000) {
    return decryptSecret(account.access_token_enc);
  }

  const consumedRefreshEnc = account.refresh_token_enc;
  let tokens: CanvaTokens;
  try {
    tokens = await refreshCanvaTokens(decryptSecret(consumedRefreshEnc));
  } catch (err) {
    if (err instanceof CanvaError && !err.transient) {
      // Lost the single-use race? If another request rotated the pair since
      // our read, ITS tokens are live — use them and do not flag anything.
      const { data: current } = await admin
        .from("canva_accounts")
        .select("access_token_enc, refresh_token_enc")
        .eq("user_id", userId)
        .maybeSingle();
      if (current && current.refresh_token_enc !== consumedRefreshEnc) {
        return decryptSecret(current.access_token_enc);
      }
      await admin
        .from("canva_accounts")
        .update({ status: "error", last_error: err.message })
        .eq("user_id", userId);
    }
    throw err;
  }

  // CAS persist: only overwrite the pair we actually consumed.
  const patch = {
    access_token_enc: encryptSecret(tokens.accessToken),
    refresh_token_enc: encryptSecret(tokens.refreshToken),
    token_expires_at: tokens.expiresAt.toISOString(),
    status: "active",
    last_error: null,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: updated, error } = await admin
      .from("canva_accounts")
      .update(patch)
      .eq("user_id", userId)
      .eq("refresh_token_enc", consumedRefreshEnc)
      .select("user_id")
      .maybeSingle();
    if (updated) return tokens.accessToken;
    if (!error) {
      // CAS mismatch: a concurrent reconnect/rotation won — its stored pair
      // is the live one (ours consumed the now-dead predecessor).
      const { data: current } = await admin
        .from("canva_accounts")
        .select("access_token_enc")
        .eq("user_id", userId)
        .maybeSingle();
      return current ? decryptSecret(current.access_token_enc) : null;
    }
    console.error("canva_token_persist_failed", { attempt, error: error.message });
  }
  // Unpersisted rotation must not be handed out — the stored refresh token is
  // consumed; surfacing transient lets the caller retry (and see the flag
  // only if the NEXT refresh genuinely fails).
  throw new CanvaError("token_persist_failed", true);
}

/**
 * Best-effort revocation of the user's grant at Canva (disconnect/GDPR):
 * removes the integration from the user's "connected apps" instead of
 * leaving live token material behind. Failures are logged, never fatal —
 * local deletion is the source of truth.
 */
export async function revokeCanvaGrant(userId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: account } = await admin
      .from("canva_accounts")
      .select("refresh_token_enc")
      .eq("user_id", userId)
      .maybeSingle();
    if (!account) return;
    const { id, secret } = clientCredentials();
    await fetch("https://api.canva.com/rest/v1/oauth/revoke", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: decryptSecret(account.refresh_token_enc) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.error("canva_revoke_failed", { error: err instanceof Error ? err.message : "?" });
  }
}

// --- API --------------------------------------------------------------------

async function canvaFetch(accessToken: string, path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new CanvaError("network_error", true);
  }
  if (res.status === 401 || res.status === 403) throw new CanvaError("auth_failed", false, res.status);
  if (res.status === 429) throw new CanvaError("rate_limited", true, 429);
  if (!res.ok) throw new CanvaError(`http_${res.status}`, res.status >= 500, res.status);
  return res;
}

export type CanvaDesign = {
  id: string;
  title: string;
  updatedAt: number | null;
  pageCount: number | null;
  thumbnailUrl: string | null;
};

export async function listCanvaDesigns(
  accessToken: string,
  opts: { continuation?: string } = {},
): Promise<{ designs: CanvaDesign[]; continuation: string | null }> {
  const params = new URLSearchParams({ ownership: "owned", sort_by: "modified_descending" });
  if (opts.continuation) params.set("continuation", opts.continuation);
  const res = await canvaFetch(accessToken, `/designs?${params}`);
  const body = (await res.json()) as {
    items?: Array<Record<string, unknown>>;
    continuation?: string;
  };
  const designs: CanvaDesign[] = (body.items ?? []).map((raw) => {
    const thumbnail = raw.thumbnail as { url?: unknown } | undefined;
    return {
      id: String(raw.id ?? ""),
      title: typeof raw.title === "string" && raw.title ? raw.title : "Ohne Titel",
      updatedAt: typeof raw.updated_at === "number" ? raw.updated_at : null,
      pageCount: typeof raw.page_count === "number" ? raw.page_count : null,
      thumbnailUrl: typeof thumbnail?.url === "string" ? thumbnail.url : null,
    };
  });
  return { designs, continuation: body.continuation ?? null };
}

/** True when the error means the GRANT is dead (reconnect), not the design. */
export function isCanvaAuthError(err: unknown): boolean {
  return (
    err instanceof CanvaError &&
    !err.transient &&
    (err.message === "auth_failed" ||
      err.message.startsWith("token_") ||
      err.message === "canva_not_configured")
  );
}

async function downloadCanvaExport(urlString: string): Promise<Uint8Array> {
  // Download URLs come from Canva's response but stay pinned to Canva
  // infrastructure — never fetch arbitrary hosts from the server.
  const url = new URL(urlString);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".canva.com")) {
    throw new CanvaError("export_url_invalid", false);
  }
  let file: Response;
  try {
    file = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new CanvaError("network_error", true);
  }
  if (!file.ok) throw new CanvaError(`download_${file.status}`, file.status >= 500);
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Exports a design as an A4 PDF and downloads the bytes. The export job is
 * asynchronous — poll bounded (~15 s worst case; letter-sized designs finish
 * in seconds). Canva may return ONE url for the whole document or one url
 * PER PAGE depending on design type — multiple parts are merged into a
 * single PDF so no page is ever silently dropped.
 */
export async function exportCanvaDesignPdf(
  accessToken: string,
  designId: string,
): Promise<Uint8Array> {
  const createRes = await canvaFetch(accessToken, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: { type: "pdf", size: "a4" } }),
  });
  const created = (await createRes.json()) as { job?: { id?: string; status?: string } };
  const jobId = created.job?.id;
  if (!jobId) throw new CanvaError("export_malformed", true);

  let urls: string[] | null = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((r) => setTimeout(r, attempt < 5 ? 600 : 1200));
    const pollRes = await canvaFetch(accessToken, `/exports/${jobId}`);
    const poll = (await pollRes.json()) as {
      job?: { status?: string; urls?: string[]; error?: { message?: string } };
    };
    if (poll.job?.status === "success") {
      urls = poll.job.urls ?? null;
      break;
    }
    if (poll.job?.status === "failed") {
      throw new CanvaError("export_failed", false);
    }
  }
  if (!urls || urls.length === 0) throw new CanvaError("export_timeout", true);

  if (urls.length === 1) return downloadCanvaExport(urls[0]);

  // Per-page export: merge in order. Hard cap well above the letter limit.
  if (urls.length > 100) throw new CanvaError("export_too_many_parts", false);
  const merged = await PDFDocument.create();
  for (const partUrl of urls) {
    const bytes = await downloadCanvaExport(partUrl);
    const part = await PDFDocument.load(bytes, { throwOnInvalidObject: false });
    const pages = await merged.copyPages(part, part.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}
