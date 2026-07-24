import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/server/env";
import { sendMail } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
import { de } from "@/lib/i18n/de";

export const dynamic = "force-dynamic";

/**
 * Supabase Auth "Send Email" hook: GoTrue POSTs every auth mail (confirmation,
 * password reset, magic link, e-mail change, reauth code) here instead of
 * using its own SMTP. We render the branded Versendio template and deliver
 * via the regular mail path (Resend) — consistent design AND none of the
 * default SMTP's 2-mails/hour rate limit.
 *
 * Security: Standard-Webhooks signature (HMAC-SHA256 over
 * "<id>.<timestamp>.<body>", key from SUPABASE_AUTH_HOOK_SECRET). Requests
 * older than 5 minutes or with a bad signature are rejected. A non-2xx
 * response FAILS the auth operation at Supabase — deliberate: a signup whose
 * confirmation mail cannot be sent should error, not strand a user.
 */

type HookPayload = {
  user?: { email?: string; user_metadata?: { display_name?: string; full_name?: string } };
  email_data?: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    token_hash_new?: string;
  };
};

function decodeSecret(raw: string): Buffer {
  // Dashboard copies vary: "v1,whsec_<base64>", "v1_whsec_<base64>" or the
  // bare base64 — tolerate every prefix variant so a pasted secret just works.
  const stripped = raw.trim().replace(/^v1[,_]/, "").replace(/^whsec_/, "");
  return Buffer.from(stripped, "base64");
}

function verifySignature(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;
  const expected = createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  // Header may carry several space-separated "v1,<sig>" entries.
  for (const part of header.split(" ")) {
    const sig = part.startsWith("v1,") ? part.slice(3) : part;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function POST(request: Request) {
  const secret = serverEnv().SUPABASE_AUTH_HOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "hook_not_configured" }, { status: 500 });
  }

  const body = await request.text();
  const id = request.headers.get("webhook-id") ?? "";
  const timestamp = request.headers.get("webhook-timestamp") ?? "";
  const signature = request.headers.get("webhook-signature") ?? "";
  if (!id || !timestamp || !signature || !verifySignature(secret, id, timestamp, body, signature)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(body) as HookPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const email = payload.user?.email;
  const data = payload.email_data;
  if (!email || !data?.email_action_type) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const env = serverEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  const appUrl = (env.APP_URL ?? "https://app.versendio.de").replace(/\/$/, "");
  const redirect = data.redirect_to || `${appUrl}/app`;
  const verifyUrl = (type: string, tokenHash: string) =>
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}&type=${type}&redirect_to=${encodeURIComponent(redirect)}`;

  const displayName =
    payload.user?.user_metadata?.display_name ?? payload.user?.user_metadata?.full_name ?? null;

  const m = de.authMails;
  let subject: string;
  let paragraphs: string[];
  let cta: { label: string; url: string } | undefined;

  switch (data.email_action_type) {
    case "signup":
      subject = m.confirmSubject;
      paragraphs = [m.confirmBody];
      cta = { label: m.confirmCta, url: verifyUrl("signup", data.token_hash ?? "") };
      break;
    case "recovery":
      subject = m.recoverySubject;
      paragraphs = [m.recoveryBody, m.recoveryIgnore];
      cta = { label: m.recoveryCta, url: verifyUrl("recovery", data.token_hash ?? "") };
      break;
    case "magiclink":
      subject = m.magicSubject;
      paragraphs = [m.magicBody];
      cta = { label: m.magicCta, url: verifyUrl("magiclink", data.token_hash ?? "") };
      break;
    case "email_change":
      subject = m.emailChangeSubject;
      paragraphs = [m.emailChangeBody];
      cta = {
        label: m.emailChangeCta,
        url: verifyUrl("email_change", data.token_hash_new || (data.token_hash ?? "")),
      };
      break;
    case "invite":
      subject = m.inviteSubject;
      paragraphs = [m.inviteBody];
      cta = { label: m.inviteCta, url: verifyUrl("invite", data.token_hash ?? "") };
      break;
    case "reauthentication":
      subject = m.reauthSubject;
      paragraphs = [m.reauthBody(data.token ?? "")];
      break;
    default:
      console.error("auth_email_unknown_type", { type: data.email_action_type });
      return NextResponse.json({ error: "unknown_action_type" }, { status: 400 });
  }

  const { html, text } = renderBrandedEmail({ displayName, paragraphs, cta });
  const result = await sendMail({ to: email, subject, html, text });
  if (!result.ok) {
    console.error("auth_email_send_failed", { type: data.email_action_type });
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
  return NextResponse.json({});
}
