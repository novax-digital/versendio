/**
 * Pure helpers for e-mail notification preferences and digest texts. The
 * enforcement gate lives in processSendEmail (single choke point covering all
 * enqueue sites and queue retries); this module only maps templates to their
 * pref column and formats aggregate counts — no I/O, unit-testable.
 */

export const NOTIFICATION_PREF_COLUMNS = [
  "notify_send_status",
  "notify_epost_updates",
  "notify_topup",
  "notify_flow_activity",
] as const;

export type NotificationPrefColumn = (typeof NOTIFICATION_PREF_COLUMNS)[number];

export type NotificationPrefs = Record<NotificationPrefColumn, boolean>;

/** Everything on by default (opt-out model, mirrors the DB column defaults). */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  notify_send_status: true,
  notify_epost_updates: true,
  notify_topup: true,
  notify_flow_activity: true,
};

/**
 * Template → pref column. Templates missing here are ALWAYS sent — that is the
 * deliberate default for account/action-critical mail (welcome, items_on_hold,
 * auto-top-up failure, account deletion), so a new template is opt-outable
 * only by explicit listing.
 */
const TEMPLATE_PREF: Record<string, NotificationPrefColumn> = {
  job_completed: "notify_send_status",
  job_completed_with_errors: "notify_send_status",
  job_status_update: "notify_epost_updates",
  topup_confirmed: "notify_topup",
  flow_summary: "notify_flow_activity",
};

/** Whether the given template may be sent under the user's prefs. */
export function templateAllowed(
  template: string,
  prefs: Record<string, boolean | null | undefined> | null | undefined,
): boolean {
  const column = TEMPLATE_PREF[template];
  if (!column) return true;
  // Missing/null column values (e.g. row predating the migration) fall back
  // to the opt-out default: send.
  return (prefs?.[column] ?? DEFAULT_NOTIFICATION_PREFS[column]) !== false;
}

/**
 * German digest lines for a per-job status update, e.g.
 * "3 Briefe sind jetzt: Versendet". Statuses keep the item-status vocabulary;
 * labels are passed in (i18n stays centralized at the call site). Unknown
 * statuses fall back to the raw key so a vocabulary drift never drops counts.
 * Order follows the given label map to keep the mail stable and logical.
 */
export function formatStatusDigest(
  counts: Record<string, number>,
  labels: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const ordered = [
    ...Object.keys(labels).filter((s) => counts[s]),
    ...Object.keys(counts).filter((s) => !(s in labels)),
  ];
  for (const status of ordered) {
    const n = counts[status];
    if (!n || n <= 0) continue;
    const label = labels[status] ?? status;
    lines.push(n === 1 ? `1 Brief ist jetzt: ${label}` : `${n} Briefe sind jetzt: ${label}`);
  }
  return lines;
}
