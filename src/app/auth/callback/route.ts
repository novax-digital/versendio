import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Allow-lists `next` to a relative, same-origin path. Rejects protocol-relative
 * (`//host`) and backslash (`/\host`, which WHATWG normalizes to `//host`)
 * open-redirect payloads.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/app";
  if (/[\\/]{2}/.test(raw)) return "/app";
  return raw;
}

/**
 * PKCE callback for e-mail confirmation and password-recovery links.
 * Exchanges the code for a session and forwards to `next`
 * (allow-listed to relative paths to prevent open redirects).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("auth_callback_failed", { code: error.code });
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", url.origin));
}
