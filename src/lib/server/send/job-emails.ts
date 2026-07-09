import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail, escapeHtml } from "@/lib/server/mail";
import { serverEnv } from "@/lib/server/env";

type EmailTemplate = "job_completed" | "job_completed_with_errors" | "items_on_hold" | "welcome";

/**
 * Renders and sends a transactional mail for a send_email queue job.
 * Content is deliberately PII-light: no recipient addresses, no letter data.
 */
export async function processSendEmail(payload: {
  template: string;
  userId: string;
  jobId?: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("email, display_name")
    .eq("id", payload.userId)
    .single();
  if (!profile?.email) return;

  const appName = serverEnv().APP_NAME;
  const appUrl = serverEnv().APP_URL ?? "";
  const jobLink = payload.jobId && appUrl ? `${appUrl}/app/sendungen/${payload.jobId}` : null;

  const templates: Record<EmailTemplate, { subject: string; body: string }> = {
    job_completed: {
      subject: `Ihre Sendung wurde abgeschlossen – ${appName}`,
      body: `alle Briefe Ihrer Sendung wurden erfolgreich verarbeitet und versendet.`,
    },
    job_completed_with_errors: {
      subject: `Ihre Sendung wurde mit Fehlern abgeschlossen – ${appName}`,
      body: `Ihre Sendung wurde abgeschlossen, einzelne Briefe konnten jedoch nicht zugestellt werden. Die betroffenen Beträge wurden Ihrem Guthaben automatisch wieder gutgeschrieben.`,
    },
    items_on_hold: {
      subject: `Briefe zurückgestellt: Guthaben reicht nicht aus – ${appName}`,
      body: `einige Briefe Ihrer Sendung benötigen mehr Blätter als geschätzt, Ihr Guthaben reicht für die Differenz derzeit nicht aus. Bitte laden Sie Guthaben auf – die Briefe werden danach automatisch versendet. Alternativ können Sie die zurückgestellten Briefe stornieren.`,
    },
    welcome: {
      subject: `Willkommen bei ${appName}`,
      body: `herzlich willkommen! Legen Sie eine Absenderadresse an, laden Sie Guthaben auf und versenden Sie Ihren ersten Brief in wenigen Minuten.`,
    },
  };

  const template = templates[payload.template as EmailTemplate];
  if (!template) {
    console.error("unknown_email_template", { template: payload.template });
    return;
  }

  const safeName = profile.display_name ? escapeHtml(profile.display_name) : null;
  const greeting = safeName ? `Guten Tag ${safeName},` : "Guten Tag,";
  const linkHtml = jobLink
    ? `<p><a href="${jobLink}">Zur Sendung</a></p>`
    : "";

  await sendMail({
    to: profile.email,
    subject: template.subject,
    html: `<p>${greeting}</p><p>${template.body}</p>${linkHtml}<p>Mit freundlichen Grüßen<br/>${appName}</p>`,
    text: `${greeting}\n\n${template.body}\n${jobLink ?? ""}\n\nMit freundlichen Grüßen\n${appName}`,
  });
}
