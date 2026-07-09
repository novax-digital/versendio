import "server-only";
import { Resend } from "resend";
import { serverEnv } from "@/lib/server/env";

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Escapes user-supplied values before interpolation into mail HTML.
 * Display names are user-controlled and must never reach a raw HTML context.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Transactional mail with graceful degradation: Resend when configured,
 * otherwise structured console log (dev/mock). SMTP fallback can be added
 * behind SMTP_URL without touching call sites.
 * Never include letter contents or recipient addresses in mails/logs.
 */
export async function sendMail(message: MailMessage): Promise<{ ok: boolean; error?: string }> {
  const env = serverEnv();

  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    try {
      const resend = new Resend(env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (error) {
        console.error("mail_send_failed", { subject: message.subject, error: error.message });
        return { ok: false, error: error.message };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("mail_send_failed", { subject: message.subject, error: msg });
      return { ok: false, error: msg };
    }
  }

  // No mail provider configured: log delivery intent only (no recipient
  // address — an email is PII and must not be logged in cleartext).
  console.info("mail_skipped_no_provider", { subject: message.subject });
  return { ok: true };
}
