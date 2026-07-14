import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
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
  const appUrl = (serverEnv().APP_URL ?? "").replace(/\/$/, "");
  const jobUrl = payload.jobId && appUrl ? `${appUrl}/app/sendungen/${payload.jobId}` : null;
  const toSend = jobUrl ? { label: "Zur Sendung", url: jobUrl } : undefined;
  const toApp = appUrl ? { label: "Zum Dashboard", url: `${appUrl}/app` } : undefined;

  const templates: Record<
    EmailTemplate,
    { subject: string; paragraphs: string[]; cta?: { label: string; url: string } }
  > = {
    job_completed: {
      subject: `Ihre Sendung wurde abgeschlossen – ${appName}`,
      paragraphs: ["alle Briefe Ihrer Sendung wurden erfolgreich verarbeitet und versendet."],
      cta: toSend,
    },
    job_completed_with_errors: {
      subject: `Ihre Sendung wurde mit Fehlern abgeschlossen – ${appName}`,
      paragraphs: [
        "Ihre Sendung wurde abgeschlossen, einzelne Briefe konnten jedoch nicht zugestellt werden. Die betroffenen Beträge wurden Ihrem Guthaben automatisch wieder gutgeschrieben.",
      ],
      cta: toSend,
    },
    items_on_hold: {
      subject: `Briefe zurückgestellt: Guthaben reicht nicht aus – ${appName}`,
      paragraphs: [
        "einige Briefe Ihrer Sendung benötigen mehr Blätter als geschätzt, Ihr Guthaben reicht für die Differenz derzeit nicht aus. Bitte laden Sie Guthaben auf – die Briefe werden danach automatisch versendet. Alternativ können Sie die zurückgestellten Briefe stornieren.",
      ],
      cta: toSend,
    },
    welcome: {
      subject: `Willkommen bei ${appName}`,
      paragraphs: [
        "herzlich willkommen! Legen Sie eine Absenderadresse an, laden Sie Guthaben auf und versenden Sie Ihren ersten Brief in wenigen Minuten.",
      ],
      cta: toApp,
    },
  };

  const template = templates[payload.template as EmailTemplate];
  if (!template) {
    console.error("unknown_email_template", { template: payload.template });
    return;
  }

  const { html, text } = renderBrandedEmail({
    displayName: profile.display_name,
    paragraphs: template.paragraphs,
    cta: template.cta,
  });

  await sendMail({ to: profile.email, subject: template.subject, html, text });
}
