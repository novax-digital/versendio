import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail, escapeHtml } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
import { serverEnv } from "@/lib/server/env";
import { getJsonSetting } from "@/lib/server/settings";
import { extractPdfText } from "@/lib/server/pdf/extract-text";
import { SAMPLE_RECIPIENT_ADDRESS } from "@/lib/server/pdf/sample-recipient";
import { buildRecipientAddressLines } from "@/lib/shared/address";
import { computeReviewFlags, type ReviewFlag } from "@/lib/shared/send-review";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { renderItemPdf } from "./process-item";

type SenderSnapshot = {
  company?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  sender_line?: string;
  city?: string | null;
};

const BERLIN = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export function formatBerlin(iso: string): string {
  return de.admin.review.at(BERLIN.format(new Date(iso)));
}

/** Recipient of admin notifications: app setting, falling back to ADMIN_EMAIL. */
export async function adminNotificationEmail(): Promise<string | null> {
  const email = z.string().email();
  const fallback = email.safeParse(serverEnv().ADMIN_EMAIL);
  const value = await getJsonSetting<unknown>("admin_notification_email", null);
  const parsed = email.safeParse(value);
  if (parsed.success) return parsed.data;
  return fallback.success ? fallback.data : null;
}

/**
 * Renders a job's letter for a SAMPLE recipient — what the reviewing admin
 * sees — plus the hash of the content consumed (see renderItemPdf).
 */
export async function renderReviewPreview(
  letterId: string | null,
  senderSnapshot: unknown,
): Promise<{ pdf: Uint8Array; contentHash: string }> {
  const sender = (senderSnapshot ?? {}) as SenderSnapshot;
  return renderItemPdf(
    letterId,
    SAMPLE_RECIPIENT_ADDRESS,
    sender.sender_line ?? "",
    sender.city ?? null,
    buildRecipientAddressLines(SAMPLE_RECIPIENT_ADDRESS),
  );
}

export function flagText(flag: ReviewFlag): string {
  return de.admin.review.flag[flag.code](flag.detail);
}

/**
 * send_email job `admin_send_review` (enqueued by confirm_send_job for every
 * paid job, and by restart_send_review after a content change): renders the
 * letter, stores the reviewed content hash and the warning flags, then mails
 * the admin. Deliberately NO attachment — uploaded letters and MOCO invoices
 * carry real recipient data; the mail links to the login-protected preview.
 * Throws on load/mail failure so the queue retries.
 */
export async function processAdminSendReview(jobId: string, restart = false): Promise<void> {
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("send_jobs")
    .select(
      "id, user_id, letter_id, sender_snapshot, total_items, total_vk_cents, status, scheduled_release_at, review_hold_until, review_released_at, review_stopped_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) throw new Error(`review_job_load_failed: ${jobError.message}`);
  if (!job || job.status === "canceled" || job.review_stopped_at) return;

  const [profileRes, letterRes, completedRes, openRes] = await Promise.all([
    admin
      .from("profiles")
      .select("email, display_name, company, created_at")
      .eq("id", job.user_id)
      .single(),
    job.letter_id
      ? admin
          .from("letters")
          .select("title, source, page_count, use_cover_letter")
          .eq("id", job.letter_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("send_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", job.user_id)
      .eq("is_test", false)
      .in("status", ["completed", "completed_with_errors"]),
    admin
      .from("send_jobs")
      .select("total_items")
      .eq("user_id", job.user_id)
      .eq("is_test", false)
      .in("status", ["queued", "processing"])
      .limit(1000),
  ]);
  const profile = profileRes.data;
  if (profileRes.error || !profile) throw new Error("review_profile_load_failed");
  const letter = letterRes.data;

  let rendered: { pdf: Uint8Array; contentHash: string } | null = null;
  try {
    rendered = await renderReviewPreview(job.letter_id, job.sender_snapshot);
  } catch (err) {
    console.error("review_preview_failed", {
      jobId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
  // Our own cover page carries text; only the customer's pages count.
  const extracted = rendered
    ? await extractPdfText(rendered.pdf, {
        skipFirstPage: letter?.source === "upload" && letter.use_cover_letter === true,
      })
    : null;

  const sender = (job.sender_snapshot ?? {}) as SenderSnapshot;
  const openRecipients = (openRes.data ?? []).reduce((sum, j) => sum + (j.total_items ?? 0), 0);
  const flags = computeReviewFlags({
    sender: { company: sender.company, firstName: sender.first_name, lastName: sender.last_name },
    accountCompany: profile.company,
    accountCreatedAt: new Date(profile.created_at),
    now: new Date(),
    completedJobs: completedRes.count ?? 0,
    openRecipients: Math.max(openRecipients, job.total_items),
    letterTitle: letter?.title ?? "",
    letterText: extracted?.text ?? null,
    contentPages: extracted?.pages ?? 0,
    contentChanged: restart,
  });
  // High warnings ⇒ no automatic release when the hold ends (I-035), unless
  // switched off. Only ever raised here, never cleared: a later re-review of
  // the same job keeps it manual. The hash is what the worker compares
  // against what it is about to send.
  const high = flags.some((f) => f.level === "high");
  const manual = high && (await getJsonSetting<unknown>("send_review_manual_on_high", true)) !== false;
  await admin
    .from("send_jobs")
    .update({
      review_flags: flags,
      review_content_hash: rendered?.contentHash ?? null,
      ...(manual ? { review_manual_required: true } : {}),
    })
    .eq("id", jobId);

  const to = await adminNotificationEmail();
  if (!to) {
    console.error("admin_review_no_recipient", { jobId });
    return;
  }

  const t = de.admin.review;
  const releaseAt = [job.review_hold_until, job.scheduled_release_at]
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1);
  const amount = formatCents(job.total_vk_cents);
  const source = letter?.source === "editor" ? t.sourceEditor : t.sourceUpload;

  const rows: [string, string][] = [
    [t.account, `${profile.email ?? "–"}${profile.display_name ? ` (${profile.display_name})` : ""}`],
    [t.companyLabel, profile.company?.trim() || "–"],
    [t.registeredLabel, formatBerlin(profile.created_at)],
    [t.previousJobsLabel, String(completedRes.count ?? 0)],
    [t.letter, `${letter?.title ?? "–"} (${source}, ${t.pages(letter?.page_count ?? null)})`],
    [t.senderLabel, sender.sender_line ?? "–"],
    [t.recipients, String(job.total_items)],
    [t.amount, amount],
  ];
  const table = rows
    .map(([k, v]) => `${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong>`)
    .join("<br>");
  const warnings = flags.length
    ? flags
        .map((f) =>
          f.level === "high"
            ? `⚠️ <strong>${escapeHtml(flagText(f))}</strong>`
            : `• ${escapeHtml(flagText(f))}`,
        )
        .join("<br>")
    : escapeHtml(t.noWarnings);

  const intro = job.review_released_at
    ? t.mailIntroReleased
    : manual
      ? t.mailIntroManual
      : !job.review_hold_until
        ? t.mailIntroNoHold
        : t.mailIntro(releaseAt ? formatBerlin(releaseAt) : "–");
  const appUrl = (serverEnv().APP_URL ?? "").replace(/\/$/, "");
  const { html, text } = renderBrandedEmail({
    paragraphs: [
      intro,
      table,
      `<strong>${escapeHtml(t.warnings)}:</strong><br>${warnings}`,
      rendered ? t.mailPreviewNote : t.mailPreviewFailed,
    ],
    cta: appUrl ? { label: t.mailCta, url: `${appUrl}/admin/pruefung` } : undefined,
  });

  // Subject without the customer's e-mail: mail.ts logs subjects on failure.
  const result = await sendMail({
    to,
    subject: t.mailSubject(high, job.user_id.slice(0, 8), job.total_items, amount),
    html,
    text,
  });
  if (!result.ok) throw new Error(`admin_review_mail_failed: ${result.error ?? "unknown"}`);
}
