/**
 * Client-side Google Ads conversion tracking. The gtag.js library is loaded by
 * the consent module (src/lib/analytics/consent.ts) and ONLY after a marketing
 * grant — this file never loads it. Every event is gated on marketing consent;
 * without it the conversion is consciously lost: the sessionStorage guard is
 * still consumed so nothing fires later if consent is granted afterwards
 * (no queuing, strict Basic Mode).
 *
 * The consent stub always defines window.gtag, so pushing an event queues it on
 * the dataLayer and it is processed once gtag.js finishes loading — this covers
 * the Stripe-return race where the success page fires while the library loads.
 */

import { hasMarketingConsent } from "./consent";

const REGISTRATION_SEND_TO = "AW-18340516455/9YdCLGaqNQcEOekuKlE";

// TODO(conversion): Echtes Google-Ads-Conversion-Label für "Guthaben
// aufgeladen" eintragen (Format: AW-18340516455/xxxxxxxxxxxxxxxxx). Solange der
// Platzhalter steht, ist der Request strukturell korrekt, wird von Google aber
// nicht zugeordnet.
const TOPUP_SEND_TO = "AW-18340516455/TODO_TOPUP_LABEL";

// Registration: armed at signup, read+cleared on the success page.
const REG_KEY = "versendio.regConversion";
// Topup: fired once per Stripe transaction id (reload-safe).
const TOPUP_KEY_PREFIX = "versendio.topupFired.";

const NOOP = () => {};

function canFire(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.gtag === "function" &&
    hasMarketingConsent()
  );
}

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
function safeRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Registration conversion
// ---------------------------------------------------------------------------

/** Called on signup success to arm the conversion for the /willkommen page. */
export function armRegistrationConversion(email: string): void {
  safeSet(REG_KEY, email);
}

/**
 * Fires the pending registration conversion at most once. No-ops when nothing
 * is armed. Consumes the guard before firing so a reload can never re-fire.
 * Returns a (currently no-op) cleanup for use as a useEffect callback.
 */
export function fireRegistrationConversion(): () => void {
  const email = safeGet(REG_KEY);
  if (!email) return NOOP;
  // Consume the guard regardless of consent — the conversion is either sent now
  // or consciously lost; it must never fire on a later consent grant.
  safeRemove(REG_KEY);
  if (!canFire()) return NOOP;

  // Enhanced Conversions: Google hashes the e-mail client-side before send.
  window.gtag("set", "user_data", { email });
  window.gtag("event", "conversion", { send_to: REGISTRATION_SEND_TO });
  return NOOP;
}

// ---------------------------------------------------------------------------
// Topup ("Guthaben aufgeladen") conversion
// ---------------------------------------------------------------------------

export type TopupConversion = {
  /** Stripe checkout session id — the transaction id and the dedup key. */
  transactionId: string;
  /** Net credit amount in major currency units (e.g. 25.00). */
  value: number;
  currency: string;
  /** For Enhanced Conversions (optional). */
  email?: string;
};

/**
 * Fires the topup conversion at most once per transaction id (survives reload).
 * Consumes the per-transaction guard even without consent so a later grant
 * cannot back-fire it.
 */
export function fireTopupConversion(input: TopupConversion): () => void {
  if (!input.transactionId || !Number.isFinite(input.value)) return NOOP;
  const guardKey = TOPUP_KEY_PREFIX + input.transactionId;
  if (safeGet(guardKey)) return NOOP; // already handled (reload / re-render)
  safeSet(guardKey, "1");
  if (!canFire()) return NOOP;

  if (input.email) window.gtag("set", "user_data", { email: input.email });
  window.gtag("event", "conversion", {
    send_to: TOPUP_SEND_TO,
    value: input.value,
    currency: input.currency,
    transaction_id: input.transactionId,
  });
  return NOOP;
}
