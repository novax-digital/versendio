import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enqueueWelcomeOnce } from "@/lib/server/auth/welcome-once";

export const dynamic = "force-dynamic";

const OTP_TYPES: EmailOtpType[] = [
  "signup",
  "recovery",
  "magiclink",
  "email_change",
  "invite",
  "email",
];

/** Allow-lists `next` to a relative, same-origin path (see auth/callback). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/app";
  if (/[\\/]{2}/.test(raw)) return "/app";
  return raw;
}

/**
 * Own-domain confirmation endpoint for auth-mail links: the branded mails
 * (send-email hook) link HERE instead of Supabase's /auth/v1/verify, so
 * customers only ever see app.versendio.de. Verifies the token hash
 * server-side (establishes the session cookie) and forwards to `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const typeRaw = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  if (tokenHash && typeRaw && OTP_TYPES.includes(typeRaw)) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type: typeRaw, token_hash: tokenHash });
    if (!error) {
      await enqueueWelcomeOnce(data.user?.id);
      return NextResponse.redirect(new URL(next, url.origin));
    }
    console.error("auth_confirm_failed", { code: error.code });
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback", url.origin));
}
