import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadDiscountPercent, loadPricingRows } from "@/lib/server/pricing/load";
import { getNumberSetting } from "@/lib/server/settings";
import { calculateLetterPrice, type PricingRow } from "@/lib/shared/pricing";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { isMockMode } from "@/lib/server/env";

type SupabaseAdmin = ReturnType<typeof createAdminClient>;

/** Stay well under the 60s function budget so a large backlog resumes next tick. */
const TIME_BUDGET_MS = 45_000;
/** Retry backoff (minutes) for held enrollments, indexed by prior attempt count. */
const HOLD_BACKOFF_MIN = [10, 30, 60, 180, 360];

type Outcome = "sent" | "held" | "failed" | "skipped" | "canceled";

type DueEnrollment = {
  id: string;
  user_id: string;
  contact_id: string;
  letter_id: string;
  is_color: boolean;
  is_duplex: boolean;
  registered: "none" | "einwurf" | "einschreiben" | "rueckschein";
  scheduled_send_at: string;
  attempts: number;
  flows: { is_active: boolean; list_id: string; sender_address_id: string | null };
};

export type FlowSchedulerReport = {
  scanned: number;
  sent: number;
  held: number;
  failed: number;
  skipped: number;
  canceled: number;
};

type TickContext = {
  admin: SupabaseAdmin;
  maxHoldDays: number;
  rows: PricingRow[];
  /** Memoized plan discount per plan_id within this tick. */
  discountCache: Map<string, number>;
};

/**
 * Scans due flow enrollments and fires each one through the existing
 * confirm_send_job RPC (1 letter → 1 item), charging at fire time. Idempotent:
 * the enrollment id is the RPC client_token, so a crash between the RPC commit
 * and the status update never double-charges — the next run reuses the same
 * token and confirm_send_job returns the existing job.
 */
export async function runFlowScheduler(): Promise<FlowSchedulerReport> {
  const admin = createAdminClient();
  const start = Date.now();
  const batch = await getNumberSetting("flows_scan_batch_size", 200);
  const maxHoldDays = await getNumberSetting("flows_max_hold_days", 14);

  const report: FlowSchedulerReport = {
    scanned: 0,
    sent: 0,
    held: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
  };

  // Pricing rows are identical for the whole tick — load once, not per row.
  let rows: PricingRow[];
  try {
    rows = await loadPricingRows();
  } catch (err) {
    console.error("flow_pricing_load_failed", { error: err instanceof Error ? err.message : "?" });
    return report; // nothing can be priced this tick; rows retry next tick.
  }

  // Ready rows on an ACTIVE flow, gated by next_attempt_at so held (retrying)
  // rows don't starve freshly-due pending ones. Oldest-ready first.
  const { data, error } = await admin
    .from("flow_enrollments")
    .select(
      "id, user_id, contact_id, letter_id, is_color, is_duplex, registered, scheduled_send_at, attempts, flows!inner(is_active, list_id, sender_address_id)",
    )
    .in("status", ["pending", "held"])
    .lte("next_attempt_at", new Date().toISOString())
    .eq("flows.is_active", true)
    .order("next_attempt_at", { ascending: true })
    .limit(batch);

  if (error) {
    console.error("flow_scan_failed", { error: error.message });
    return report;
  }

  const due = (data ?? []) as unknown as DueEnrollment[];
  report.scanned = due.length;

  const ctx: TickContext = { admin, maxHoldDays, rows, discountCache: new Map() };

  for (const enrollment of due) {
    if (Date.now() - start > TIME_BUDGET_MS) break;
    let outcome: Outcome;
    try {
      outcome = await processEnrollment(ctx, enrollment);
    } catch (err) {
      // One row's unexpected failure must not abort the whole tick.
      console.error("flow_enrollment_error", {
        enrollmentId: enrollment.id,
        error: err instanceof Error ? err.message : "?",
      });
      outcome = await hold(admin, enrollment, "unexpected_error", maxHoldDays).catch(() => "held");
    }
    report[outcome] += 1;
  }

  return report;
}

async function planDiscount(ctx: TickContext, planId: string | null): Promise<number> {
  const key = planId ?? "__none__";
  const cached = ctx.discountCache.get(key);
  if (cached !== undefined) return cached;
  const discount = await loadDiscountPercent(planId);
  ctx.discountCache.set(key, discount);
  return discount;
}

async function processEnrollment(ctx: TickContext, e: DueEnrollment): Promise<Outcome> {
  const { admin, maxHoldDays } = ctx;
  const flow = e.flows;

  // Contact must still be a member of the flow's list. A transient read error is
  // NOT a "left the list" — hold and retry, never terminally cancel on a blip.
  const { data: entry, error: entryErr } = await admin
    .from("lead_list_entries")
    .select("id")
    .eq("list_id", flow.list_id)
    .eq("contact_id", e.contact_id)
    .maybeSingle();
  if (entryErr) return hold(admin, e, "membership_read_error", maxHoldDays);
  if (!entry) return finalize(admin, e, "canceled", "contact_left_list");

  const { data: contact, error: contactErr } = await admin
    .from("contacts")
    .select("id, salutation, first_name, last_name, company, street, address_extra, zip, city, country")
    .eq("id", e.contact_id)
    .eq("user_id", e.user_id)
    .maybeSingle();
  if (contactErr) return hold(admin, e, "contact_read_error", maxHoldDays);
  // Contact rows cascade-delete enrollments, so a genuine null is a rare safety net.
  if (!contact) return finalize(admin, e, "canceled", "contact_missing");

  // Owner must be active — a blocked/deleted user must not keep sending mail.
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("plan_id, status")
    .eq("id", e.user_id)
    .maybeSingle();
  if (profileErr || !profile) return hold(admin, e, "profile_read_error", maxHoldDays);
  if (profile.status !== "active") return hold(admin, e, "user_not_active", maxHoldDays);

  const { data: letter, error: letterErr } = await admin
    .from("letters")
    .select("id, status, sheet_count")
    .eq("id", e.letter_id)
    .eq("user_id", e.user_id)
    .maybeSingle();
  if (letterErr || !letter) return hold(admin, e, "letter_read_error", maxHoldDays);
  // Not ready is treated as transient (user may be editing) → retried, bounded.
  if (letter.status !== "ready") return hold(admin, e, "letter_not_ready", maxHoldDays);

  // Sender: the flow's chosen address, else the user's default.
  let senderQuery = admin
    .from("sender_addresses")
    .select("id, label, company, first_name, last_name, street, zip, city, country, sender_line")
    .eq("user_id", e.user_id);
  senderQuery = flow.sender_address_id
    ? senderQuery.eq("id", flow.sender_address_id)
    : senderQuery.eq("is_default", true);
  const { data: sender, error: senderErr } = await senderQuery.maybeSingle();
  if (senderErr || !sender) return hold(admin, e, "no_sender_address", maxHoldDays);

  // Price via the single pricing truth, using the enrollment's frozen options.
  const sheets = Math.max(1, letter.sheet_count ?? 1);
  const discountPercent = await planDiscount(ctx, profile.plan_id ?? null);

  let price;
  try {
    price = calculateLetterPrice(ctx.rows, {
      sheets,
      isColor: e.is_color,
      isDuplex: e.is_duplex,
      registered: e.registered,
      discountPercent,
    });
  } catch {
    // e.g. a registered surcharge row was deactivated after the flow was built.
    return hold(admin, e, "pricing_unavailable", maxHoldDays);
  }

  const snapshot = {
    salutation: contact.salutation,
    firstName: contact.first_name,
    lastName: contact.last_name,
    company: contact.company,
    street: contact.street,
    addressExtra: contact.address_extra,
    zip: contact.zip,
    city: contact.city,
    country: contact.country,
  };

  const { data: jobId, error } = await admin.rpc("confirm_send_job", {
    p_user_id: e.user_id,
    p_client_token: e.id, // enrollment id → exactly-once charge across retries
    p_letter_id: letter.id,
    p_sender_snapshot: sender,
    p_is_color: e.is_color,
    p_is_duplex: e.is_duplex,
    p_registered: e.registered,
    p_is_test: false,
    p_scheduled_release_at: null, // fire now — the enrollment IS the schedule
    p_provider: isMockMode() ? "mock" : "epost",
    p_total_vk_cents: price.vkCents,
    p_total_ek_cents: price.ekCents,
    p_items: [
      {
        contact_id: contact.id,
        recipient_snapshot: snapshot,
        sheet_count: sheets,
        vk_cents: price.vkCents,
        ek_cents: price.ekCents,
        pricing_snapshot: { discountPercent, rows: ctx.rows, sheets },
      },
    ],
  });

  if (error) {
    // Insufficient funds at fire time: park and retry (bounded), like on_hold_funds.
    if (error.message.includes("insufficient_funds")) {
      return hold(admin, e, "insufficient_funds", maxHoldDays);
    }
    console.error("flow_send_failed", { enrollmentId: e.id, error: error.message });
    return hold(admin, e, "send_error", maxHoldDays);
  }

  // Only flip a row that is still pending/held (a concurrent run may have won —
  // harmless, confirm_send_job returned the same job for both).
  await admin
    .from("flow_enrollments")
    .update({ status: "sent", send_job_id: jobId as string, sent_at: new Date().toISOString(), last_error: null })
    .eq("id", e.id)
    .in("status", ["pending", "held"]);

  // The debit may have crossed the auto-top-up threshold.
  await enqueueJob("auto_topup", { userId: e.user_id }).catch(() => {});
  return "sent";
}

/**
 * Park a due enrollment for retry with backoff (so held rows don't starve
 * pending ones), escalating to failed once it is maxHoldDays overdue.
 */
async function hold(
  admin: SupabaseAdmin,
  e: DueEnrollment,
  reason: string,
  maxHoldDays: number,
): Promise<"held" | "failed"> {
  const overdueMs = Date.now() - Date.parse(e.scheduled_send_at);
  if (overdueMs > maxHoldDays * 86_400_000) {
    await admin
      .from("flow_enrollments")
      .update({ status: "failed", attempts: e.attempts + 1, last_error: reason })
      .eq("id", e.id)
      .in("status", ["pending", "held"]);
    return "failed";
  }
  const backoffMin = HOLD_BACKOFF_MIN[Math.min(e.attempts, HOLD_BACKOFF_MIN.length - 1)];
  await admin
    .from("flow_enrollments")
    .update({
      status: "held",
      attempts: e.attempts + 1,
      last_error: reason,
      next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
    })
    .eq("id", e.id)
    .in("status", ["pending", "held"]);
  return "held";
}

/** Terminal resolution that is neither a send nor a retry (canceled/skipped). */
async function finalize(
  admin: SupabaseAdmin,
  e: DueEnrollment,
  status: "canceled" | "skipped",
  reason: string,
): Promise<"canceled" | "skipped"> {
  await admin
    .from("flow_enrollments")
    .update({ status, last_error: reason })
    .eq("id", e.id)
    .in("status", ["pending", "held"]);
  return status;
}
