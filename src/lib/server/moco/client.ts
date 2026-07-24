import "server-only";

/**
 * Minimal MOCO API client (https://everii-group.github.io/mocoapp-api-docs/).
 * Base URL is https://{subdomain}.mocoapp.com/api/v1, auth via
 * "Authorization: Token token=KEY". A read-only account key is sufficient —
 * we only ever list documents and download PDFs.
 *
 * Rate limits: 120 requests / 2 min per account. The sync engine keeps
 * per-tick batches far below that; this client only adds timeouts and typed
 * errors (transient vs auth) so the caller can decide between retry and
 * flagging the connection.
 */

// Strict subdomain shape — the subdomain is user input that becomes part of a
// server-side fetch URL. No dots (would allow "foo.evil.com"-style SSRF), no
// leading hyphen; MOCO subdomains are DNS labels.
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidMocoSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_RE.test(subdomain);
}

export type MocoAuth = { subdomain: string; apiKey: string };

export class MocoError extends Error {
  constructor(
    message: string,
    /** true → worth retrying next tick; false → credentials/permanent. */
    public readonly transient: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MocoError";
  }
}

const TIMEOUT_MS = 15_000;

function baseUrl(auth: MocoAuth): string {
  if (!isValidMocoSubdomain(auth.subdomain)) {
    throw new MocoError("invalid_subdomain", false);
  }
  return `https://${auth.subdomain}.mocoapp.com/api/v1`;
}

async function mocoFetch(auth: MocoAuth, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl(auth)}${path}`, {
      headers: { Authorization: `Token token=${auth.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MocoError("network_error", true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new MocoError("auth_failed", false, res.status);
  }
  if (res.status === 429) throw new MocoError("rate_limited", true, 429);
  if (!res.ok) throw new MocoError(`http_${res.status}`, res.status >= 500, res.status);
  return res;
}

/** Validates subdomain + key against GET /session. */
export async function verifyMocoCredentials(auth: MocoAuth): Promise<boolean> {
  try {
    await mocoFetch(auth, "/session");
    return true;
  } catch (err) {
    if (err instanceof MocoError && !err.transient) return false;
    throw err; // network problems are not a verdict about the credentials
  }
}

export type MocoInvoice = {
  id: number;
  identifier: string;
  title: string;
  date: string; // "2026-07-24"
  status: string;
  recipient_address: string;
  customer_id: number | null;
  currency?: string;
  gross_total?: number;
};

export type MocoReminder = {
  id: number;
  title: string | null;
  date: string;
  status: string; // "created" | "sent"
  file_url: string | null;
  invoice: { id: number; identifier: string | null; title: string | null } | null;
};

type RawInvoice = Record<string, unknown>;

function toInvoice(raw: RawInvoice): MocoInvoice {
  return {
    id: Number(raw.id),
    identifier: typeof raw.identifier === "string" ? raw.identifier : "",
    title: typeof raw.title === "string" ? raw.title : "",
    date: typeof raw.date === "string" ? raw.date : "",
    status: typeof raw.status === "string" ? raw.status : "",
    recipient_address: typeof raw.recipient_address === "string" ? raw.recipient_address : "",
    customer_id:
      raw.customer && typeof raw.customer === "object" && "id" in (raw.customer as object)
        ? Number((raw.customer as { id: unknown }).id)
        : typeof raw.customer_id === "number"
          ? raw.customer_id
          : null,
    currency: typeof raw.currency === "string" ? raw.currency : undefined,
    gross_total: typeof raw.gross_total === "number" ? raw.gross_total : undefined,
  };
}

/** Lists invoices with a given status, dated on/after dateFrom (YYYY-MM-DD). */
export async function listMocoInvoices(
  auth: MocoAuth,
  opts: { status: string; dateFrom: string },
): Promise<MocoInvoice[]> {
  const params = new URLSearchParams({ status: opts.status, date_from: opts.dateFrom });
  const res = await mocoFetch(auth, `/invoices?${params}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new MocoError("unexpected_response", true);
  return body.map((r) => toInvoice(r as RawInvoice));
}

export async function getMocoInvoice(auth: MocoAuth, id: number): Promise<MocoInvoice> {
  const res = await mocoFetch(auth, `/invoices/${id}`);
  return toInvoice((await res.json()) as RawInvoice);
}

/** Downloads the invoice PDF (with the account's letter paper). */
export async function getMocoInvoicePdf(auth: MocoAuth, id: number): Promise<Uint8Array> {
  const res = await mocoFetch(auth, `/invoices/${id}.pdf`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Lists payment reminders (Mahnungen) dated on/after dateFrom. */
export async function listMocoReminders(
  auth: MocoAuth,
  opts: { dateFrom: string },
): Promise<MocoReminder[]> {
  const params = new URLSearchParams({ date_from: opts.dateFrom });
  const res = await mocoFetch(auth, `/invoice_reminders?${params}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new MocoError("unexpected_response", true);
  return body.map((raw) => {
    const r = raw as Record<string, unknown>;
    const invoice =
      r.invoice && typeof r.invoice === "object"
        ? (r.invoice as { id?: unknown; identifier?: unknown; title?: unknown })
        : null;
    return {
      id: Number(r.id),
      title: typeof r.title === "string" ? r.title : null,
      date: typeof r.date === "string" ? r.date : "",
      status: typeof r.status === "string" ? r.status : "",
      file_url: typeof r.file_url === "string" ? r.file_url : null,
      invoice: invoice
        ? {
            id: Number(invoice.id),
            identifier: typeof invoice.identifier === "string" ? invoice.identifier : null,
            title: typeof invoice.title === "string" ? invoice.title : null,
          }
        : null,
    };
  });
}

/**
 * Downloads a reminder document via its file_url. The URL comes from MOCO's
 * API response but is still pinned to the connected account's own MOCO host —
 * a tampered/foreign URL must never turn this worker into an SSRF proxy.
 */
export async function getMocoReminderPdf(auth: MocoAuth, fileUrl: string): Promise<Uint8Array> {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new MocoError("invalid_file_url", false);
  }
  const allowedHost = `${auth.subdomain}.mocoapp.com`;
  if (parsed.protocol !== "https:" || parsed.hostname !== allowedHost) {
    throw new MocoError("invalid_file_url", false);
  }
  let res: Response;
  try {
    res = await fetch(parsed, {
      headers: { Authorization: `Token token=${auth.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MocoError("network_error", true);
  }
  if (!res.ok) throw new MocoError(`http_${res.status}`, res.status >= 500, res.status);
  return new Uint8Array(await res.arrayBuffer());
}
