import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentProfile } from "@/lib/server/auth-context";
import { serverEnv } from "@/lib/server/env";
import { buildCanvaAuthUrl, canvaConfigured, generatePkcePair } from "@/lib/server/canva/client";

export const dynamic = "force-dynamic";

/**
 * Starts the Canva OAuth flow: mints PKCE verifier + CSRF state into
 * short-lived httpOnly cookies and redirects to Canva's consent screen.
 */
export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!canvaConfigured()) {
    return NextResponse.redirect(
      new URL("/app/einstellungen/integrationen/canva?fehler=konfiguration", request.url),
    );
  }

  const { verifier, challenge } = generatePkcePair();
  const state = randomBytes(24).toString("base64url");
  const appUrl = (serverEnv().APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/integrations/canva/callback`;

  const jar = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: appUrl.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/api/integrations/canva",
    maxAge: 600,
  };
  jar.set("canva_oauth_verifier", verifier, cookieOpts);
  jar.set("canva_oauth_state", state, cookieOpts);

  return NextResponse.redirect(buildCanvaAuthUrl({ state, codeChallenge: challenge, redirectUri }));
}
