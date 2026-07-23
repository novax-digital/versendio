/**
 * Meta (Facebook) Pixel — strict consent gating, mirroring the Google Ads
 * integration (gtag.ts): without a marketing grant fbevents.js is never
 * loaded and no request ever reaches Meta.
 *
 * The fbq stub and the queued `init` are created eagerly at module load so
 * early event calls (e.g. the /willkommen Lead effect racing consent init)
 * queue in memory in the right order and are flushed once the library loads
 * after a grant. Events fired without consent are consciously lost: their
 * sessionStorage guards are consumed so nothing back-fires on a later grant
 * (same contract as gtag.ts).
 *
 * Meta's <noscript> image fallback is deliberately NOT used — it would fire
 * unconditionally and bypass consent.
 */

import { hasMarketingConsent, onConsentApplied } from "./consent";

const PIXEL_ID = "999313472929811";
// Lead: armed at signup, read+cleared on the success page.
const LEAD_KEY = "versendio.metaLead";
// Purchase: fired once per Stripe transaction id (reload-safe).
const PURCHASE_KEY_PREFIX = "versendio.metaPurchase.";

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: Fbq;
  loaded: boolean;
  version: string;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
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

/** Ports Meta's boilerplate stub: queues calls until fbevents.js takes over. */
function ensureStub(): Fbq | null {
  if (!isBrowser()) return null;
  if (window.fbq) return window.fbq;
  const stub = function (...args: unknown[]) {
    if (stub.callMethod) {
      stub.callMethod(...args);
    } else {
      stub.queue.push(args);
    }
  } as Fbq;
  stub.push = stub;
  stub.loaded = true;
  stub.version = "2.0";
  stub.queue = [];
  window.fbq = stub;
  if (!window._fbq) window._fbq = stub;
  return stub;
}

let pixelLoaded = false;

/**
 * Injects fbevents.js and fires the initial PageView. Only ever invoked from
 * the consent listener below, i.e. strictly after a marketing grant. Route
 * changes are tracked separately by trackMetaPageView (which skips the first
 * render so this initial PageView is never double-counted).
 */
function loadMetaPixel(): void {
  const fbq = ensureStub();
  if (!fbq) return;
  if (pixelLoaded) {
    // Re-grant after an in-session revoke: the library is already present.
    fbq("consent", "grant");
    return;
  }
  pixelLoaded = true;
  fbq("track", "PageView");
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
}

if (isBrowser()) {
  // Queue `init` ahead of every possible event; no network happens until the
  // library is injected on a marketing grant.
  ensureStub()?.("init", PIXEL_ID);
  onConsentApplied((marketing) => {
    if (marketing) {
      loadMetaPixel();
      return;
    }
    const fbq = window.fbq;
    if (!fbq || !pixelLoaded) return;
    if (!fbq.callMethod && fbq.queue) {
      // Withdrawal while fbevents.js is still loading: the stub queue drains
      // strictly FIFO, so an APPENDED revoke would run only after the queued
      // init (+_fbp cookie) and PageView already fired. Scrub pending tracks
      // and make the revoke precede init instead.
      const kept = fbq.queue.filter((args) => args[0] !== "track");
      fbq.queue.length = 0;
      fbq.queue.push(["consent", "revoke"], ...kept);
    } else {
      // Library is live: stop the already-loaded pixel from tracking.
      fbq("consent", "revoke");
    }
  });
}

function canFire(): boolean {
  return isBrowser() && typeof window.fbq === "function" && hasMarketingConsent();
}

/** PageView for client-side route changes (the initial one comes from load). */
export function trackMetaPageView(): void {
  if (!canFire()) return;
  window.fbq?.("track", "PageView");
}

/** Called on signup success to arm the Lead for the /willkommen page. */
export function armMetaLead(): void {
  safeSet(LEAD_KEY, "1");
}

/**
 * Fires the pending Lead at most once. Consumes the guard before firing so a
 * reload or a later consent grant can never re-fire it.
 */
export function fireMetaLead(): void {
  if (!isBrowser() || !safeGet(LEAD_KEY)) return;
  safeRemove(LEAD_KEY);
  if (!canFire()) return;
  window.fbq?.("track", "Lead");
}

export type MetaPurchase = {
  /** Stripe checkout session id — the dedup key across reloads. */
  transactionId: string;
  /** Order total in major currency units (e.g. 25.00). */
  value: number;
  /** ISO currency code, e.g. "EUR". */
  currency: string;
};

/**
 * Fires Purchase at most once per transaction id. The sessionStorage guard
 * covers reloads within the tab; the eventID (Meta dedups same event name +
 * id within 48 h) covers a reopened success URL in another tab or session.
 */
export function fireMetaPurchase(input: MetaPurchase): void {
  if (!isBrowser() || !input.transactionId || !Number.isFinite(input.value)) return;
  const guardKey = PURCHASE_KEY_PREFIX + input.transactionId;
  if (safeGet(guardKey)) return;
  safeSet(guardKey, "1");
  if (!canFire()) return;
  window.fbq?.(
    "track",
    "Purchase",
    { value: input.value, currency: input.currency.toUpperCase() },
    { eventID: `topup-${input.transactionId}` },
  );
}
