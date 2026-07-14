import "server-only";
import { serverEnv } from "@/lib/server/env";
import { escapeHtml } from "@/lib/server/mail";

/**
 * Shared branded wrapper for all transactional mails. Uses table layout +
 * inline styles for broad email-client support; the wordmark stays as text so
 * a blocked header image never leaves the mail unbranded. `paragraphs` are
 * developer-authored HTML (no user input); `displayName` is escaped here.
 */
export function renderBrandedEmail(opts: {
  displayName?: string | null;
  paragraphs: string[];
  cta?: { label: string; url: string };
}): { html: string; text: string } {
  const env = serverEnv();
  const appName = env.APP_NAME;
  const appUrl = (env.APP_URL ?? "https://app.versendio.de").replace(/\/$/, "");
  const brand = "#2C4BE8";
  const ink = "#101828";
  const muted = "#64748B";

  const greeting = opts.displayName
    ? `Guten Tag ${escapeHtml(opts.displayName)},`
    : "Guten Tag,";

  const bodyBlocks = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${ink}">${p}</p>`,
    )
    .join("");

  const ctaBlock = opts.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px"><tr><td style="border-radius:8px;background:${brand}">
        <a href="${opts.cta.url}" style="display:inline-block;padding:10px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(opts.cta.label)}</a>
      </td></tr></table>`
    : "";

  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
        <tr><td style="padding:20px 28px;border-bottom:1px solid #eef1fe">
          <img src="${appUrl}/brand/appicon-192.png" width="26" height="26" alt="" style="vertical-align:middle;border-radius:6px">
          <span style="vertical-align:middle;margin-left:8px;font-size:18px;font-weight:600;color:${ink}">${escapeHtml(appName)}</span>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${ink}">${greeting}</p>
          ${bodyBlocks}
          ${ctaBlock}
          <p style="margin:20px 0 0;font-size:15px;line-height:1.6;color:${ink}">Mit freundlichen Grüßen<br>${escapeHtml(appName)}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eef1fe">
          <p style="margin:0;font-size:12px;line-height:1.5;color:${muted}">
            Diese E-Mail wurde automatisch von <a href="${appUrl}" style="color:${brand};text-decoration:none">${escapeHtml(appName)}</a> versendet.
            <br>© ${new Date().getFullYear()} ${escapeHtml(appName)}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text =
    `${greeting}\n\n` +
    opts.paragraphs.map((p) => stripHtml(p)).join("\n\n") +
    (opts.cta ? `\n\n${opts.cta.label}: ${opts.cta.url}` : "") +
    `\n\nMit freundlichen Grüßen\n${appName}\n\n— Diese E-Mail wurde automatisch von ${appName} versendet (${appUrl}).`;

  return { html, text };
}

/** Plain-text fallback: unwrap links to "text (url)" and drop remaining tags. */
function stripHtml(html: string): string {
  return html
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
