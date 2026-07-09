import type { NextConfig } from "next";

/**
 * Static security headers (MASTERPROMPT §6.8). The Content-Security-Policy is
 * NOT set here: it carries a per-request nonce and is emitted by src/proxy.ts.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Note: script-src allows js.stripe.com only via the CSP in proxy.ts; no
  // Stripe.js is loaded today (hosted Checkout via redirect).
  // SAMEORIGIN, not DENY: the letter preview iframes our own PDF route.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
