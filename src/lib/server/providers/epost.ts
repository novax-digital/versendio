import "server-only";
import { serverEnv } from "@/lib/server/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/server/crypto";
import { normalizeCountry } from "@/lib/shared/postal-code";
import {
  ProviderError,
  type LetterProvider,
  type ProviderItemStatus,
  type ProviderStatusInfo,
  type SubmitLetterInput,
  type SubmitLetterResult,
} from "./types";

/**
 * E-POSTBUSINESS API adapter, implemented strictly against Swagger v2.6.1
 * (fetched 2026-07-09; verified constraints in docs/ASSUMPTIONS.md A-009).
 * Central account from ENV (Eigenversender model, ADR-0008). 24h JWT cached
 * encrypted in the DB so serverless instances share it (ADR-0005 §5).
 */

// Swagger: LetterStatus payload (subset we consume).
type ApiLetterStatus = {
  letterID: number;
  statusID: number;
  statusDetails: string | null;
  custom1: string | null;
  frankierID: string | null;
  destinationAreaStatus: string | null;
  destinationAreaStatusDate: string | null;
  registeredLetterStatus: string | null;
  errorList: { level: string; code: string; description: string }[] | null;
};

const REGISTERED_VALUES: Record<Exclude<SubmitLetterInput["registered"], "none">, string> = {
  einwurf: "Einwurf Einschreiben",
  einschreiben: "Einschreiben",
  rueckschein: "Einschreiben Rückschein",
};

// Address country: German uppercase name, omitted for domestic (W203).
const COUNTRY_NAMES_DE: Record<string, string> = {
  AT: "ÖSTERREICH",
  CH: "SCHWEIZ",
  NL: "NIEDERLANDE",
  BE: "BELGIEN",
  FR: "FRANKREICH",
  IT: "ITALIEN",
  PL: "POLEN",
  LU: "LUXEMBURG",
  DK: "DÄNEMARK",
  ES: "SPANIEN",
  GB: "GROSSBRITANNIEN",
  US: "USA",
};

/**
 * The API requires the German uppercase country NAME (A-009). A raw ISO code
 * would silently produce a W203 rejection at the provider — fail fast instead.
 */
function countryNameOrThrow(country: string): string {
  const name = COUNTRY_NAMES_DE[country];
  if (!name) {
    throw new ProviderError(`Zielland ${country} wird derzeit nicht unterstützt`, {
      retryable: false,
      providerCode: "unsupported_country",
    });
  }
  return name;
}

function mapStatus(statusID: number): ProviderItemStatus {
  switch (statusID) {
    case 1:
      return "accepted";
    case 2:
      return "checked";
    case 3:
      return "print_center";
    case 4:
      return "sent";
    case 99:
      return "failed";
    default:
      // Unknown ids stay at the lowest non-final state; sync will retry.
      return "accepted";
  }
}

function toInfo(status: ApiLetterStatus): ProviderStatusInfo {
  const firstError = status.errorList?.[0];
  return {
    providerLetterId: String(status.letterID),
    status: mapStatus(status.statusID),
    providerStatusId: status.statusID,
    details: status.statusDetails,
    frankierId: status.frankierID,
    destinationAreaStatus: status.destinationAreaStatus,
    destinationAreaStatusDate: status.destinationAreaStatusDate,
    registeredStatus: status.registeredLetterStatus,
    custom1: status.custom1,
    errorCode: firstError?.code ?? null,
    errorMessage: firstError?.description ?? null,
  };
}

const TOKEN_ACCOUNT_REF = "central";
const TOKEN_REFRESH_MARGIN_MS = 30 * 60 * 1000;

export class EpostProvider implements LetterProvider {
  readonly name = "epost" as const;

  async submitLetter(input: SubmitLetterInput): Promise<SubmitLetterResult> {
    const country = normalizeCountry(input.country);
    const [line1, line2, line3, line4, line5] = input.addressLines;

    const body = [
      {
        fileName: input.fileName,
        data: Buffer.from(input.pdfBytes).toString("base64"),
        isColor: input.isColor,
        isDuplex: input.isDuplex,
        batchID: input.providerBatchId,
        registeredLetter:
          input.registered === "none" ? null : REGISTERED_VALUES[input.registered],
        testFlag: input.isTest,
        testShowRestrictedArea: input.isTest ? (input.testShowRestrictedArea ?? true) : false,
        coverLetter: false,
        // Name/company, street, address extra only — NOT zip/city/country
        // (Swagger: "Empfängerzeile … (z.B. Name,Firma / Strasse,Adresszusatz)").
        addressLine1: line1 ?? "",
        addressLine2: line2 ?? null,
        addressLine3: line3 ?? null,
        addressLine4: line4 ?? null,
        // addressLine5 is documented as DE-only.
        addressLine5: country === "DE" ? (line5 ?? null) : null,
        // Foreign destinations without postal codes must send three blanks.
        zipCode: input.zipCode.trim() === "" ? "   " : input.zipCode,
        city: input.city,
        // Domestic letters must omit the country (mismatch → W203).
        country: country === "DE" ? null : countryNameOrThrow(country),
        senderAdressLineComplete: input.senderLine,
        custom1: input.itemId,
        costCenter: input.costCenter,
        activateDuplicateFailsafe: true,
      },
    ];

    const result = await this.request<{ fileName: string; letterID: number }[]>(
      "POST",
      "/api/Letter",
      body,
    );
    const ident = result?.[0];
    if (!ident?.letterID) {
      throw new ProviderError("submission returned no letterID", { retryable: false });
    }
    return { providerLetterId: String(ident.letterID) };
  }

  async getStatus(providerLetterId: string): Promise<ProviderStatusInfo | null> {
    const status = await this.request<ApiLetterStatus>(
      "GET",
      `/api/Letter/${encodeURIComponent(providerLetterId)}`,
    );
    return status ? toInfo(status) : null;
  }

  async listOpenLetters(): Promise<ProviderStatusInfo[]> {
    const list = await this.request<ApiLetterStatus[]>("GET", "/api/Letter/Open");
    return (list ?? []).map(toInfo);
  }

  async findByItemId(itemId: string): Promise<ProviderStatusInfo | null> {
    const list = await this.request<ApiLetterStatus[]>(
      "GET",
      `/api/Letter/Custom1?custom1=${encodeURIComponent(itemId)}`,
    );
    if (!list || list.length === 0) return null;
    return toInfo(list[0]);
  }

  async getTestResult(providerLetterId: string): Promise<Uint8Array | null> {
    const result = await this.request<{ letterID: number; data: string | null }>(
      "GET",
      `/api/Letter/TestResult?letterID=${encodeURIComponent(providerLetterId)}`,
    );
    if (!result?.data) return null;
    return new Uint8Array(Buffer.from(result.data, "base64"));
  }

  async cancelQueued(providerLetterId: string): Promise<boolean> {
    const result = await this.request<{ letterID: number; successful: boolean }[]>(
      "POST",
      "/api/Letter/CancelQueued",
      [Number(providerLetterId)],
    );
    return result?.[0]?.successful ?? false;
  }

  async releaseQueued(providerLetterId: string): Promise<boolean> {
    const result = await this.request<{ letterID: number; successful: boolean }[]>(
      "POST",
      "/api/Letter/ReleaseQueued",
      [Number(providerLetterId)],
    );
    return result?.[0]?.successful ?? false;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string | null }> {
    try {
      const env = serverEnv();
      const response = await fetch(`${env.EPOST_BASE_URL}/api/Login/HealthCheck`, {
        signal: AbortSignal.timeout(10000),
      });
      const body = (await response.json().catch(() => null)) as {
        level?: string;
        description?: string;
      } | null;
      return { ok: response.ok, message: body?.description ?? null };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "unreachable" };
    }
  }

  // --- HTTP + token handling -------------------------------------------------

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T | null> {
    const env = serverEnv();
    const attempt = async (token: string) =>
      fetch(`${env.EPOST_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });

    let token = await this.getToken();
    let response = await attempt(token);

    if (response.status === 401) {
      // Token expired server-side: force refresh once.
      token = await this.getToken(true);
      response = await attempt(token);
    }

    if (response.status === 404) return null;

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        code?: string;
        description?: string;
      } | null;
      const code = errorBody?.code ?? `http_${response.status}`;
      // E324 = duplicate failsafe hit: the previous attempt made it through.
      if (code === "E324") {
        throw new ProviderError("duplicate submission detected (E324)", {
          retryable: false,
          providerCode: code,
          duplicate: true,
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      throw new ProviderError(errorBody?.description ?? `E-Post API error ${response.status}`, {
        retryable,
        providerCode: code,
      });
    }

    return (await response.json().catch(() => null)) as T | null;
  }

  /**
   * 24h JWT from the DB cache (encrypted). Refresh is NOT hard-serialized:
   * with a 30-min refresh margin and one cron invocation per minute, at most
   * a handful of concurrent workers can race a refresh, each performing one
   * extra login per 23h — bounded and harmless. (ADR-0005 §5 envisioned an
   * advisory lock; PostgREST's per-statement transactions can't hold one
   * across the login HTTP call, so the bounded race is accepted.)
   */
  private async getToken(forceRefresh = false): Promise<string> {
    const admin = createAdminClient();

    if (!forceRefresh) {
      const { data } = await admin
        .from("epost_tokens")
        .select("token_enc, expires_at")
        .eq("account_ref", TOKEN_ACCOUNT_REF)
        .maybeSingle();
      if (data && Date.parse(data.expires_at) - Date.now() > TOKEN_REFRESH_MARGIN_MS) {
        return decryptSecret(data.token_enc);
      }
    }

    const env = serverEnv();
    if (!env.EPOST_VENDOR_ID || !env.EPOST_EKP || !env.EPOST_PASSWORD || !env.EPOST_SECRET) {
      throw new ProviderError("E-Post credentials not configured", { retryable: false });
    }

    const response = await fetch(`${env.EPOST_BASE_URL}/api/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorID: env.EPOST_VENDOR_ID,
        ekp: env.EPOST_EKP,
        secret: env.EPOST_SECRET,
        password: env.EPOST_PASSWORD,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new ProviderError(`E-Post login failed (${response.status})`, {
        retryable: response.status === 429 || response.status >= 500,
        providerCode: `login_${response.status}`,
      });
    }

    const { token } = (await response.json()) as { token: string };
    if (!token) throw new ProviderError("E-Post login returned no token", { retryable: true });

    // 24h validity; store with a conservative 23h expiry.
    const expiresAt = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from("epost_tokens").upsert(
      {
        account_ref: TOKEN_ACCOUNT_REF,
        token_enc: encryptSecret(token),
        expires_at: expiresAt,
      },
      { onConflict: "account_ref" },
    );
    if (error) {
      // Cache failure is non-fatal — the token is still usable this invocation.
      console.error("epost_token_cache_failed", { error: error.message });
    }

    return token;
  }
}
