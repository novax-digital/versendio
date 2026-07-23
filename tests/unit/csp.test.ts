import { describe, expect, it } from "vitest";
import { buildCsp } from "@/lib/shared/csp";

const NONCE = "abc123";
const SUPABASE = "https://proj.supabase.co";

describe("buildCsp", () => {
  it("uses a nonce with strict-dynamic and never 'unsafe-inline' for scripts", () => {
    const csp = buildCsp(NONCE, SUPABASE);
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("only allows unsafe-eval in development (React Refresh)", () => {
    expect(buildCsp(NONCE, SUPABASE, false)).not.toContain("'unsafe-eval'");
    expect(buildCsp(NONCE, SUPABASE, true)).toContain("'unsafe-eval'");
  });

  it("allows the Supabase origin and Stripe API for XHR", () => {
    const csp = buildCsp(NONCE, SUPABASE);
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain("https://api.stripe.com");
  });

  it("allows Meta Pixel event delivery (img + connect), scripts via strict-dynamic", () => {
    const csp = buildCsp(NONCE, SUPABASE);
    const img = csp.split("; ").find((d) => d.startsWith("img-src"))!;
    const connect = csp.split("; ").find((d) => d.startsWith("connect-src"))!;
    expect(img).toContain("https://www.facebook.com");
    expect(connect).toContain("https://www.facebook.com");
    expect(connect).toContain("https://connect.facebook.net");
  });

  it("permits same-origin framing so the letter preview iframe works", () => {
    const csp = buildCsp(NONCE, SUPABASE);
    expect(csp).toContain("frame-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it("locks down objects, base-uri and form targets", () => {
    const csp = buildCsp(NONCE, SUPABASE);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://checkout.stripe.com");
  });

  it("tolerates a missing Supabase origin without emitting a stray space", () => {
    const csp = buildCsp(NONCE, "");
    expect(csp).toContain("connect-src 'self' https://api.stripe.com");
    expect(csp).not.toContain("  ");
  });
});
