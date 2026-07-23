/**
 * Google Consent Mode v2 — strict Basic Mode, identical cookie contract to the
 * marketing site (versendio.de) so a decision made there is honored in the app
 * and vice versa. No external CMP library.
 *
 * Basic Mode means: with no marketing grant, gtag.js is never loaded and no
 * request ever reaches googletagmanager.com / google.com. The inline stub in
 * the root layout defines the consent *default* (all denied) before anything
 * runs, so gtag() calls never crash even when the library is absent.
 *
 * All functions are SSR-safe: they no-op outside the browser.
 */

const COOKIE_NAME = "versendio_consent";
const APEX_DOMAIN = "versendio.de";
const GOOGLE_ADS_ID = "AW-18340516455";

/** Bump when the consent schema/meaning changes → re-prompts everyone. */
export const CONSENT_VERSION = 1;

export type Consent = { v: number; ts: string; marketing: boolean };

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// ---------------------------------------------------------------------------
// Cookie read/write (shared contract with the website — do not change shape)
// ---------------------------------------------------------------------------

export function readConsent(): Consent | null {
  if (!isBrowser()) return null;
  const prefix = `${COOKIE_NAME}=`;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  if (!entry) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(entry.slice(prefix.length)));
    if (typeof parsed?.v === "number" && typeof parsed?.marketing === "boolean") {
      return parsed as Consent;
    }
  } catch {
    // Malformed cookie → treat as no decision.
  }
  return null;
}

/** True when we must (re-)ask: no cookie, or an older consent version. */
export function needsConsentDecision(): boolean {
  const c = readConsent();
  return !c || c.v < CONSENT_VERSION;
}

function writeConsentCookie(marketing: boolean): void {
  if (!isBrowser()) return;
  const value: Consent = { v: CONSENT_VERSION, ts: new Date().toISOString(), marketing };
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(value))}`,
    "Path=/",
    "Max-Age=31536000", // 12 months
    "SameSite=Lax",
  ];
  const host = window.location.hostname;
  if (host === APEX_DOMAIN || host.endsWith(`.${APEX_DOMAIN}`)) {
    // Production: share the decision across the apex + all subdomains.
    parts.push(`Domain=.${APEX_DOMAIN}`, "Secure");
  } else if (host === "localhost" || host === "127.0.0.1") {
    // Dev: host-only, no Secure (served over http) — a Domain attribute here
    // would silently drop the cookie.
  } else if (window.location.protocol === "https:") {
    // Preview deployments (e.g. *.vercel.app): host-only but Secure.
    parts.push("Secure");
  }
  document.cookie = parts.join("; ");
}

// ---------------------------------------------------------------------------
// gtag consent state + conditional library load
// ---------------------------------------------------------------------------

let gtagLoaded = false;

function loadGtagJs(): void {
  if (gtagLoaded || !isBrowser()) return;
  gtagLoaded = true;
  // Queued on the stub's dataLayer; processed once the library arrives. Any
  // conversion event pushed before the load completes is queued too (covers
  // the Stripe-return race).
  window.gtag("js", new Date());
  window.gtag("config", GOOGLE_ADS_ID);
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
  document.head.appendChild(script);
}

// Other tag modules (Meta Pixel) subscribe here instead of being imported —
// keeps the dependency one-way (tag module → consent) and this file vendor-free.
type ConsentListener = (marketing: boolean) => void;
const consentListeners = new Set<ConsentListener>();

/**
 * Registers a callback invoked every time a consent decision is APPLIED: the
 * stored decision on app start and every banner action. Callbacks must be
 * idempotent (a stored grant re-fires on each page load).
 */
export function onConsentApplied(cb: ConsentListener): void {
  consentListeners.add(cb);
}

// Identifier cookies the vendor libraries set under a grant. On withdrawal
// they must be removed, not just left to expire (~90 days): _fbp/_fbc are
// Meta's browser ids, _gcl_* Google's conversion linker.
const VENDOR_COOKIES = ["_fbp", "_fbc", "_gcl_au", "_gcl_aw", "_gcl_dc", "_gcl_gb"];

function expireVendorCookies(): void {
  if (!isBrowser()) return;
  const host = window.location.hostname;
  const onApex = host === APEX_DOMAIN || host.endsWith(`.${APEX_DOMAIN}`);
  for (const name of VENDOR_COOKIES) {
    // Both variants: the libraries set Domain=.versendio.de in production,
    // host-only on previews/localhost.
    if (onApex) document.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${APEX_DOMAIN}`;
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

/** The decision this tab last applied — drives the cross-tab cookie sync. */
let lastApplied: boolean | null = null;

/** Pushes the consent update, on grant loads gtag.js, and notifies listeners. */
function applyConsent(marketing: boolean): void {
  if (!isBrowser()) return;
  lastApplied = marketing;
  if (typeof window.gtag === "function") {
    if (marketing) {
      window.gtag("consent", "update", {
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
        // analytics_storage intentionally stays denied — we run Google Ads only.
      });
      loadGtagJs();
    } else {
      window.gtag("consent", "update", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    }
  }
  if (!marketing) expireVendorCookies();
  consentListeners.forEach((cb) => cb(marketing));
}

export function grantConsent(): void {
  writeConsentCookie(true);
  applyConsent(true);
}

export function denyConsent(): void {
  writeConsentCookie(false);
  applyConsent(false);
}

/** True iff the user actively granted marketing consent. */
export function hasMarketingConsent(): boolean {
  return readConsent()?.marketing === true;
}

// ---------------------------------------------------------------------------
// Banner open/close store (tiny external store so React can subscribe without
// a setState-in-effect lint smell)
// ---------------------------------------------------------------------------

let bannerOpen = false;
const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeBanner(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function isBannerOpen(): boolean {
  return bannerOpen;
}
export function openConsentBanner(): void {
  bannerOpen = true;
  emit();
}
export function closeConsentBanner(): void {
  bannerOpen = false;
  emit();
}

let initialized = false;

/**
 * The versendio_consent cookie is shared across the apex + subdomains, so the
 * user can grant/withdraw on the marketing site or another tab while this tab
 * stays open — without this, an already-loaded pixel would keep tracking
 * after a withdrawal elsewhere. On focus/visibility we diff the cookie
 * against what this tab last applied and re-apply on change (listeners are
 * idempotent). A decision arriving while our banner is still open adopts it
 * and closes the banner.
 */
function syncConsentFromCookie(): void {
  const c = readConsent();
  if (!c || c.v < CONSENT_VERSION) return;
  if (lastApplied === null) {
    applyConsent(c.marketing);
    if (isBannerOpen()) closeConsentBanner();
    return;
  }
  if (c.marketing !== lastApplied) applyConsent(c.marketing);
}

/**
 * Run once on app start (from the client ConsentManager). Applies a stored
 * decision (loading gtag.js only on grant) or opens the banner when none/stale.
 */
export function initConsent(): void {
  if (!isBrowser() || initialized) return;
  initialized = true;
  window.addEventListener("focus", syncConsentFromCookie);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncConsentFromCookie();
  });
  const c = readConsent();
  if (!c || c.v < CONSENT_VERSION) {
    openConsentBanner();
    return;
  }
  applyConsent(c.marketing);
}
