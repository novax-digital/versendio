import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/server/auth-context";
import { serverEnv } from "@/lib/server/env";
import { exchangeCanvaCode, storeCanvaTokens } from "@/lib/server/canva/client";

export const dynamic = "force-dynamic";

/**
 * Canva OAuth callback: verifies the CSRF state against the cookie, exchanges
 * the code (with the PKCE verifier) and stores the encrypted token pair.
 * Every failure lands back on the integration page with a coded error the UI
 * translates — never a broken white page mid-OAuth.
 */
export async function GET(request: Request) {
  const settingsUrl = (code: string | null) =>
    new URL(
      code
        ? `/app/einstellungen/integrationen/canva?fehler=${code}`
        : "/app/einstellungen/integrationen/canva?verbunden=1",
      request.url,
    );

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const jar = await cookies();
  const verifier = jar.get("canva_oauth_verifier")?.value;
  const state = jar.get("canva_oauth_state")?.value;
  // One-shot cookies: whatever happens next, they must not be replayable.
  // The PATH must match the one used at set time — a bare delete() defaults
  // to Path=/ and would expire a DIFFERENT cookie, leaving these alive.
  jar.delete({ name: "canva_oauth_verifier", path: "/api/integrations/canva" });
  jar.delete({ name: "canva_oauth_state", path: "/api/integrations/canva" });

  if (url.searchParams.get("error")) {
    // User canceled on Canva's consent screen.
    return NextResponse.redirect(settingsUrl("abgebrochen"));
  }
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !verifier || !state || returnedState !== state) {
    return NextResponse.redirect(settingsUrl("ungueltig"));
  }

  const appUrl = (serverEnv().APP_URL ?? url.origin).replace(/\/$/, "");
  try {
    const tokens = await exchangeCanvaCode(code, verifier, `${appUrl}/api/integrations/canva/callback`);
    const stored = await storeCanvaTokens(profile.id, tokens);
    if (!stored) return NextResponse.redirect(settingsUrl("speichern"));
  } catch (err) {
    console.error("canva_oauth_exchange_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.redirect(settingsUrl("token"));
  }

  return NextResponse.redirect(settingsUrl(null));
}
