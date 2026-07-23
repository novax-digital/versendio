/**
 * Content-Security-Policy with a per-request nonce (MASTERPROMPT §6.8).
 *
 * `script-src` uses a nonce plus `strict-dynamic` instead of `'unsafe-inline'`:
 * without this, any injected inline script would execute and the header would
 * provide no XSS mitigation at all. Next.js picks the nonce up from the
 * `Content-Security-Policy` REQUEST header and stamps it onto its own scripts.
 *
 * `style-src` still needs `'unsafe-inline'` — React/Tailwind emit inline
 * styles that carry no nonce.
 */
export function buildCsp(nonce: string, supabaseOrigin: string, isDev = false): string {
  // `https:` is an ignored fallback for browsers without strict-dynamic support.
  // Dev needs 'unsafe-eval' for React Refresh; production must not have it.
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    "https:",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    // Stripe embedded checkout renders payment-method icons from stripe.com.
    // Meta Pixel delivers events as image GETs to facebook.com/tr (fbevents.js
    // itself loads via script-src strict-dynamic; consent-gated).
    "img-src 'self' data: blob: https://*.stripe.com https://www.facebook.com",
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin} https://api.stripe.com https://checkout.stripe.com https://js.stripe.com https://connect.facebook.net https://www.facebook.com`
      .replace(/\s+/g, " ")
      .trim(),
    // 'self' (not 'none'): the letter preview embeds our own PDF route.
    // Stripe embedded checkout mounts an iframe from js/checkout.stripe.com.
    "frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
