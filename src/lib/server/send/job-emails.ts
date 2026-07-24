import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail, escapeHtml } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
import { serverEnv } from "@/lib/server/env";
import { formatCents } from "@/lib/shared/money";
import {
  templateAllowed,
  formatStatusDigest,
  NOTIFICATION_PREF_COLUMNS,
} from "@/lib/shared/notifications";
import { de } from "@/lib/i18n/de";

type EmailTemplate =
  | "job_completed"
  | "job_completed_with_errors"
  | "items_on_hold"
  | "welcome"
  | "topup_confirmed"
  | "job_status_update"
  | "flow_summary"
  | "moco_summary";

/**
 * Payload contract for send_email queue jobs. Kept in lockstep with the cast
 * in src/app/api/cron/queue/route.ts. Only the fields of the addressed
 * template are read; everything travels through the schemaless jsonb payload.
 */
export type SendEmailPayload = {
  template: string;
  userId: string;
  jobId?: string;
  /** topup_confirmed */
  amountCents?: number;
  bonusCents?: number;
  receiptUrl?: string | null;
  auto?: boolean;
  /** job_status_update — new item statuses since the last sync, per status. */
  statusCounts?: Record<string, number>;
  /** flow_summary */
  flowId?: string;
  flowName?: string;
  sentCount?: number;
  heldFundsCount?: number;
  failedCount?: number;
};

/**
 * Renders and sends a transactional mail for a send_email queue job.
 * Content is deliberately PII-light: no recipient addresses, no letter data.
 * User notification prefs are enforced HERE (single choke point, also covers
 * retries of jobs enqueued before a pref change); templates not mapped to a
 * pref column are always sent (account/action-critical mail).
 */
export async function processSendEmail(payload: SendEmailPayload): Promise<void> {
  const admin = createAdminClient();
  const first = await admin
    .from("profiles")
    .select(`email, display_name, ${NOTIFICATION_PREF_COLUMNS.join(", ")}`)
    .eq("id", payload.userId)
    .single<
      { email: string | null; display_name: string | null } & Record<string, boolean | null>
    >();
  let profile = first.data;
  if (first.error) {
    if (first.error.code === "42703") {
      // Deploy racing the prefs migration: notify_* columns don't exist yet.
      // Fall back to base columns + opt-out defaults so mail keeps flowing.
      const base = await admin
        .from("profiles")
        .select("email, display_name")
        .eq("id", payload.userId)
        .single();
      if (base.error && base.error.code !== "PGRST116") {
        throw new Error(`profile_load_failed: ${base.error.message}`);
      }
      profile = base.data as typeof profile;
    } else if (first.error.code === "PGRST116") {
      return; // user no longer exists — drop silently
    } else {
      // Transient failure: throw so the queue retries with backoff. Defaulting
      // the prefs here would mail users who explicitly opted out.
      throw new Error(`profile_load_failed: ${first.error.message}`);
    }
  }
  if (!profile?.email) return;

  // Funds-holds and terminal failures inside a flow summary are
  // action-critical: they bypass the flow-activity opt-out so the settings
  // page's "wichtige Hinweise erhalten Sie immer" promise stays true.
  const actionCritical =
    (payload.template === "flow_summary" || payload.template === "moco_summary") &&
    ((payload.heldFundsCount ?? 0) > 0 || (payload.failedCount ?? 0) > 0);
  if (!actionCritical && !templateAllowed(payload.template, profile)) return;

  const appName = serverEnv().APP_NAME;
  const appUrl = (serverEnv().APP_URL ?? "").replace(/\/$/, "");
  const jobUrl = payload.jobId && appUrl ? `${appUrl}/app/sendungen/${payload.jobId}` : null;
  const toSend = jobUrl ? { label: "Zur Sendung", url: jobUrl } : undefined;
  const toApp = appUrl ? { label: "Zum Dashboard", url: `${appUrl}/app` } : undefined;
  const toCredits = appUrl ? { label: "Zum Guthaben", url: `${appUrl}/app/guthaben` } : undefined;

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
    topup_confirmed: buildTopupConfirmed(payload, appName, toCredits),
    job_status_update: {
      subject: `Neuigkeiten zu Ihrer Sendung – ${appName}`,
      paragraphs: [
        "es gibt Neuigkeiten zum Zustellstatus Ihrer Sendung:",
        formatStatusDigest(payload.statusCounts ?? {}, de.sendJobs.itemStatus).join("<br>"),
      ],
      cta: toSend,
    },
    flow_summary: buildFlowSummary(payload, appName, appUrl),
    moco_summary: buildMocoSummary(payload, appName, appUrl),
  };

  const template = templates[payload.template as EmailTemplate];
  if (!template) {
    console.error("unknown_email_template", { template: payload.template });
    return;
  }

  const { html, text } = renderBrandedEmail({
    displayName: profile.display_name,
    paragraphs: template.paragraphs.filter(Boolean),
    cta: template.cta,
  });

  await sendMail({ to: profile.email, subject: template.subject, html, text });
}

/** Top-up confirmation (manual + auto), amounts formatted from integer cents. */
function buildTopupConfirmed(
  payload: SendEmailPayload,
  appName: string,
  toCredits?: { label: string; url: string },
): { subject: string; paragraphs: string[]; cta?: { label: string; url: string } } {
  const amount = formatCents(payload.amountCents ?? 0);
  const paragraphs = [
    payload.auto
      ? `Ihre automatische Guthaben-Aufladung über <strong>${amount}</strong> (netto) war erfolgreich und wurde Ihrem Konto gutgeschrieben.`
      : `Ihre Guthaben-Aufladung über <strong>${amount}</strong> (netto) war erfolgreich und wurde Ihrem Konto gutgeschrieben.`,
  ];
  if (payload.bonusCents && payload.bonusCents > 0) {
    paragraphs.push(
      `Zusätzlich wurde Ihnen ein Bonus von <strong>${formatCents(payload.bonusCents)}</strong> gutgeschrieben.`,
    );
  }
  // Stripe-hosted receipt link, best-effort; only ever https URLs.
  if (payload.receiptUrl && payload.receiptUrl.startsWith("https://")) {
    paragraphs.push(
      `Ihre Rechnung können Sie <a href="${escapeHtml(payload.receiptUrl)}">hier abrufen</a>.`,
    );
  }
  return {
    subject: `Guthaben aufgeladen: ${amount} – ${appName}`,
    paragraphs,
    cta: toCredits,
  };
}

/** Per-tick MOCO digest: dispatched / failed / blocked by missing funds. */
function buildMocoSummary(
  payload: SendEmailPayload,
  appName: string,
  appUrl: string,
): { subject: string; paragraphs: string[]; cta?: { label: string; url: string } } {
  const sent = payload.sentCount ?? 0;
  const held = payload.heldFundsCount ?? 0;
  const failed = payload.failedCount ?? 0;
  const paragraphs: string[] = [];
  if (sent > 0) {
    paragraphs.push(
      sent === 1
        ? "Ihre MOCO-Integration hat soeben 1 Dokument automatisch als Brief versendet."
        : `Ihre MOCO-Integration hat soeben ${sent} Dokumente automatisch als Briefe versendet.`,
    );
  }
  if (held > 0) {
    paragraphs.push(
      `<strong>${held === 1 ? "1 Dokument konnte" : `${held} Dokumente konnten`} nicht versendet werden, weil Ihr Guthaben nicht ausreicht.</strong> Bitte laden Sie Guthaben auf und stoßen Sie die Synchronisierung in den Einstellungen erneut an.`,
    );
  }
  if (failed > 0) {
    paragraphs.push(
      `${failed === 1 ? "1 Dokument konnte" : `${failed} Dokumente konnten`} nicht verarbeitet werden (z. B. Adresse nicht erkannt oder PDF ungeeignet) und ${failed === 1 ? "wurde" : "wurden"} nicht berechnet. Details finden Sie in den Integrations-Einstellungen.`,
    );
  }
  const cta = appUrl
    ? { label: "Zu den Integrationen", url: `${appUrl}/app/einstellungen/integrationen` }
    : undefined;
  return {
    subject: `Ihre MOCO-Integration war aktiv – ${appName}`,
    paragraphs,
    cta,
  };
}

/** Per-tick flow digest: sent / waiting-for-funds / permanently failed. */
function buildFlowSummary(
  payload: SendEmailPayload,
  appName: string,
  appUrl: string,
): { subject: string; paragraphs: string[]; cta?: { label: string; url: string } } {
  const name = escapeHtml(payload.flowName ?? "");
  const sent = payload.sentCount ?? 0;
  const held = payload.heldFundsCount ?? 0;
  const failed = payload.failedCount ?? 0;
  const paragraphs: string[] = [];
  if (sent > 0) {
    paragraphs.push(
      sent === 1
        ? `Ihr Flow „${name}“ hat soeben 1 Brief automatisch versendet.`
        : `Ihr Flow „${name}“ hat soeben ${sent} Briefe automatisch versendet.`,
    );
  }
  if (held > 0) {
    paragraphs.push(
      `<strong>${held === 1 ? "1 Brief konnte" : `${held} Briefe konnten`} nicht versendet werden, weil Ihr Guthaben nicht ausreicht.</strong> Bitte laden Sie Guthaben auf – der Versand wird danach automatisch nachgeholt.`,
    );
  }
  if (failed > 0) {
    paragraphs.push(
      `${failed === 1 ? "1 Brief ist" : `${failed} Briefe sind`} endgültig fehlgeschlagen und ${failed === 1 ? "wurde" : "wurden"} nicht berechnet. Details finden Sie in Ihrem Flow.`,
    );
  }
  const cta =
    appUrl && payload.flowId
      ? { label: "Zum Flow", url: `${appUrl}/app/flows/${payload.flowId}` }
      : undefined;
  return {
    subject: `Ihr Flow „${payload.flowName ?? ""}“ war aktiv – ${appName}`,
    paragraphs,
    cta,
  };
}
