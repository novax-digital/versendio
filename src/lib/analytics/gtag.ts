/**
 * Client-side Google Ads conversion tracking (gtag.js base tag lives in the
 * root layout). Every entry point is defensive: if gtag never loads (consent
 * refused, ad blocker) or sessionStorage is unavailable, nothing throws and the
 * app carries on.
 */

const REGISTRATION_SEND_TO = "AW-18340516455/9YdCLGaqNQcEOekuKlE";

// Presence of this key = a registration conversion is pending. The value holds
// the user's e-mail for Enhanced Conversions. Set on signup success, cleared
// the moment the event is fired (or given up on) so it can never double-count.
const PENDING_KEY = "versendio.regConversion";

/** Called on signup success to arm the conversion for the /willkommen page. */
export function armRegistrationConversion(email: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, email);
  } catch {
    // Private mode / storage disabled — tracking is best-effort, never fatal.
  }
}

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fires the pending registration conversion exactly once. Safe to call on every
 * mount of the success page: it no-ops when nothing is armed, and clears the
 * flag before firing so a reload or a re-run (React StrictMode) cannot re-fire.
 *
 * gtag.js loads with strategy="afterInteractive", so window.gtag may not exist
 * yet at mount — we poll briefly for it. Returns a cleanup fn to cancel the
 * poll on unmount.
 */
export function fireRegistrationConversion(): () => void {
  const email = readPending();
  if (!email) return () => {};

  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = () => {
    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      // Clear first: the removeItem + gtag calls run synchronously with no
      // await between them, so exactly one caller ever reaches the fire.
      clearPending();
      // Enhanced Conversions: Google hashes the e-mail client-side before send.
      window.gtag("set", "user_data", { email });
      window.gtag("event", "conversion", { send_to: REGISTRATION_SEND_TO });
      return;
    }
    // Poll for gtag for ~4s; if it never shows, drop the flag so a later visit
    // to the success page can't fire a stale conversion.
    if (attempts++ < 20) {
      timer = setTimeout(attempt, 200);
    } else {
      clearPending();
    }
  };

  attempt();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
