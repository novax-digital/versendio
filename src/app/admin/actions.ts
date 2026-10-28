"use server";

import { randomInt, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/auth-context";
import { bonusTiersSchema } from "@/lib/shared/topup-bonus";
import { createVoucherSchema, VOUCHER_CODE_RE } from "@/lib/shared/schemas/voucher";
import { writeAuditLog } from "@/lib/server/audit";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { serverEnv } from "@/lib/server/env";
import { blockAccountAndStopSends } from "@/lib/server/send/block-account";
import { renderReviewPreview } from "@/lib/server/send/admin-review";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

// --- credits ----------------------------------------------------------------

const adjustCreditsSchema = z.object({
  userId: z.string().uuid(),
  // Signed euros as text, e.g. "25,00" or "-10". Comment is mandatory (§6.7).
  amountCents: z.coerce.number().int().refine((v) => v !== 0, "Betrag darf nicht 0 sein"),
  comment: z.string().trim().min(3, de.admin.commentRequired).max(500),
});

export async function adjustCreditsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = adjustCreditsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? de.common.genericError };
  }

  const admin = createAdminClient();
  const reference = randomUUID();
  const { error } = await admin.rpc("book_credit", {
    p_user_id: parsed.data.userId,
    p_type: "admin_adjust",
    p_amount_cents: parsed.data.amountCents,
    p_reference_type: "admin_adjust",
    p_reference_id: reference,
    p_comment: parsed.data.comment,
    p_created_by: `admin:${actor.id}`,
  });
  if (error) {
    if (error.message.includes("insufficient_funds")) {
      return { ok: false, error: de.admin.wouldGoNegative };
    }
    console.error("admin_adjust_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "credit_adjust",
    targetType: "user",
    targetId: parsed.data.userId,
    // Carry the justification and the ledger reference so the audit entry
    // stands on its own and can be correlated to the exact transaction.
    details: {
      amount_cents: parsed.data.amountCents,
      comment: parsed.data.comment,
      reference_id: reference,
    },
  });

  // Fresh funds may release parked letters.
  if (parsed.data.amountCents > 0) {
    const { data: held } = await admin
      .from("send_job_items")
      .select("id")
      .eq("user_id", parsed.data.userId)
      .eq("status", "on_hold_funds")
      .limit(200);
    for (const item of held ?? []) await enqueueJob("submit_item", { itemId: item.id });
  }

  revalidatePath(`/admin/nutzer/${parsed.data.userId}`);
  return { ok: true };
}

// --- user status / plan ------------------------------------------------------

const setStatusSchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(["active", "blocked"]),
});

export async function setUserStatusAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = setStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };
  if (parsed.data.userId === actor.id) {
    return { ok: false, error: de.admin.cannotBlockSelf };
  }

  // Blocking also stops the account's unsent letters and auto top-up (same
  // fraud response as the review console and the Stripe fraud webhooks).
  let jobsStopped: number | undefined;
  if (parsed.data.status === "blocked") {
    try {
      jobsStopped = await blockAccountAndStopSends(parsed.data.userId, `admin:${actor.id}`);
    } catch (err) {
      console.error("admin_set_status_failed", { error: err instanceof Error ? err.message : "?" });
      return { ok: false, error: de.common.genericError };
    }
  } else {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.userId);
    if (error) {
      console.error("admin_set_status_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: parsed.data.status === "blocked" ? "user_block" : "user_unblock",
    targetType: "user",
    targetId: parsed.data.userId,
    details: jobsStopped !== undefined ? { jobs_stopped: jobsStopped } : undefined,
  });
  revalidatePath(`/admin/nutzer/${parsed.data.userId}`);
  return { ok: true };
}

const setWhitelabelSchema = z.object({
  userId: z.string().uuid(),
  enabled: z.enum(["true", "false"]),
});

/** Grants/revokes the whitelabel-SaaS status (protected column, service-role). */
export async function setWhitelabelAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = setWhitelabelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const enabled = parsed.data.enabled === "true";
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ is_whitelabel: enabled })
    .eq("id", parsed.data.userId);
  if (error) {
    console.error("admin_set_whitelabel_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "user_whitelabel_change",
    targetType: "user",
    targetId: parsed.data.userId,
    details: { is_whitelabel: enabled },
  });
  revalidatePath(`/admin/nutzer/${parsed.data.userId}`);
  return { ok: true };
}

const setPlanSchema = z.object({
  userId: z.string().uuid(),
  planId: z.string().uuid(),
});

export async function setUserPlanAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = setPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ plan_id: parsed.data.planId })
    .eq("id", parsed.data.userId);
  if (error) {
    console.error("admin_set_plan_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "user_plan_change",
    targetType: "user",
    targetId: parsed.data.userId,
    details: { plan_id: parsed.data.planId },
  });
  revalidatePath(`/admin/nutzer/${parsed.data.userId}`);
  return { ok: true };
}

// --- Konditionen (plans) -----------------------------------------------------

const upsertPlanSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
  discountPercent: z.coerce.number().min(0).max(100),
  isDefault: z.enum(["true", "false"]).optional(),
});

/** Creates or updates a condition (plan). Setting default clears the previous one. */
export async function upsertPlanAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = upsertPlanSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const makeDefault = parsed.data.isDefault === "true";

  // Atomic: clear+set the default in one transaction so a name collision rolls
  // back without ever leaving zero (or two) defaults (admin_upsert_plan RPC).
  const { error } = await admin.rpc("admin_upsert_plan", {
    p_id: parsed.data.id ?? null,
    p_name: parsed.data.name,
    p_discount: parsed.data.discountPercent,
    p_make_default: makeDefault,
  });
  if (error) {
    if (error.message.includes("last_default")) {
      return { ok: false, error: de.admin.planDefaultRequired };
    }
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      return { ok: false, error: de.admin.planNameTaken };
    }
    console.error("plan_upsert_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "plan_upsert",
    targetType: "plan",
    targetId: parsed.data.id ?? parsed.data.name,
    details: { discount_percent: parsed.data.discountPercent, is_default: makeDefault },
  });
  revalidatePath("/admin/preise");
  return { ok: true };
}

export async function deletePlanAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("plans")
    .select("is_default")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (plan?.is_default) return { ok: false, error: de.admin.planDefaultUndeletable };

  // profiles.plan_id is ON DELETE RESTRICT — block if any customer uses it.
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", parsed.data.id);
  if ((count ?? 0) > 0) return { ok: false, error: de.admin.planInUse };

  const { error } = await admin.from("plans").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("plan_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "plan_delete",
    targetType: "plan",
    targetId: parsed.data.id,
  });
  revalidatePath("/admin/preise");
  return { ok: true };
}

export async function sendPasswordResetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", parsed.data.userId)
    .single();
  if (!profile?.email) return { ok: false, error: de.common.genericError };

  const env = serverEnv();
  const { error } = await admin.auth.resetPasswordForEmail(profile.email, {
    redirectTo: env.APP_URL ? `${env.APP_URL}/auth/callback?next=/passwort-zuruecksetzen` : undefined,
  });
  if (error) {
    console.error("admin_reset_failed", { code: error.code });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "user_password_reset",
    targetType: "user",
    targetId: parsed.data.userId,
  });
  return { ok: true };
}

export async function deleteUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ openProviderItems: number }>> {
  const actor = await requireAdmin();
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };
  if (parsed.data.userId === actor.id) {
    return { ok: false, error: de.admin.cannotDeleteSelf };
  }

  const { deleteAccount } = await import("@/lib/server/gdpr/delete-account");
  const result = await deleteAccount(parsed.data.userId, actor.id);
  if (!result.ok) return { ok: false, error: de.common.genericError };

  // anonymize_account already writes the audit entry (inside its transaction).
  revalidatePath("/admin/nutzer");
  return { ok: true, data: { openProviderItems: result.openProviderItems } };
}

// --- pricing -----------------------------------------------------------------

const pricingSchema = z.object({
  id: z.string().uuid(),
  ekCents: z.union([z.coerce.number().int().min(0), z.literal("")]),
  vkCents: z.coerce.number().int().min(0),
  active: z.enum(["true", "false"]),
  // Explicit acknowledgement required to sell an active option below cost.
  allowNegativeMargin: z.enum(["true", "false"]).optional(),
});

export async function updatePricingAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = pricingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const { ekCents, vkCents, active, allowNegativeMargin } = parsed.data;
  if (
    active === "true" &&
    ekCents !== "" &&
    vkCents < ekCents &&
    allowNegativeMargin !== "true"
  ) {
    return { ok: false, error: de.admin.marginNegativeBlocked };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("pricing_table")
    .update({
      ek_cents: ekCents === "" ? null : ekCents,
      vk_cents: vkCents,
      active: active === "true",
    })
    .eq("id", parsed.data.id);
  if (error) {
    console.error("admin_pricing_update_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "pricing_update",
    targetType: "pricing_option",
    targetId: parsed.data.id,
    details: { ek_cents: ekCents === "" ? null : ekCents, vk_cents: vkCents, active: active === "true" },
  });
  revalidatePath("/admin/preise");
  return { ok: true };
}

/**
 * Known settings with a per-key value schema. An allowlist prevents typo keys
 * (which would silently create an orphan row while the real setting stays
 * unchanged) and wrong-typed values that would break workers at runtime.
 */
const SETTING_SCHEMAS = {
  topup_amounts_cents: z.array(z.number().int().positive()).min(1).max(8),
  topup_min_cents: z.number().int().positive(),
  topup_max_cents: z.number().int().positive(),
  // Bonus-Guthaben je Aufladehöhe (unbezahltes Gratis-Guthaben, keine USt.).
  topup_bonus_tiers: bonusTiersSchema,
  low_credit_threshold_cents: z.number().int().min(0),
  queue_batch_size: z.number().int().min(1).max(100),
  status_sync_interval_minutes: z.number().int().min(1).max(1440),
  status_sync_max_queries_per_run: z.number().int().min(1).max(500),
  mock_fail_percent: z.number().min(0).max(100),
  mock_status_step_minutes: z.number().min(0.1).max(1440),
  // KI-Entwurf: limit 0 doubles as a soft kill switch.
  ai_drafts_enabled: z.boolean(),
  ai_daily_draft_limit: z.number().int().min(0).max(100),
  // Flows (automatischer zeitversetzter Versand).
  flows_enabled: z.boolean(),
  flows_scan_batch_size: z.number().int().min(1).max(1000),
  flows_max_hold_days: z.number().int().min(1).max(90),
  // Versandprüfung: Wartezeit vor Einlieferung (0 = aus) und Empfänger der Prüf-Mails.
  send_review_hold_hours: z.number().min(0).max(72),
  send_review_manual_on_high: z.boolean(),
  admin_notification_email: z.string().email(),
} as const;

const settingsSchema = z.object({
  key: z.enum(Object.keys(SETTING_SCHEMAS) as [string, ...string[]]),
  value: z.string().min(1).max(500),
});

export async function updateSettingAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.admin.unknownSetting };

  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.value);
  } catch {
    return { ok: false, error: de.admin.invalidJson };
  }

  const valueSchema = SETTING_SCHEMAS[parsed.data.key as keyof typeof SETTING_SCHEMAS];
  const valueParsed = valueSchema.safeParse(raw);
  if (!valueParsed.success) {
    return { ok: false, error: de.admin.invalidSettingValue };
  }
  const value = valueParsed.data;

  const admin = createAdminClient();
  const { error } = await admin
    .from("app_settings")
    .upsert({ key: parsed.data.key, value, updated_by: actor.id }, { onConflict: "key" });
  if (error) {
    console.error("admin_setting_update_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "setting_update",
    targetType: "app_setting",
    targetId: parsed.data.key,
  });
  revalidatePath("/admin/einstellungen");
  return { ok: true };
}

// --- send job monitor --------------------------------------------------------

/**
 * Retries a failed item via an atomic RPC: claim (exactly once) + clone +
 * debit + totals + queue job in one transaction. Never charges without
 * enqueueing; a second click finds no unclaimed failed row and aborts.
 */
export async function retryItemAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ itemId: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: cloneId, error } = await admin.rpc("admin_retry_item", {
    p_item_id: parsed.data.itemId,
    p_actor: `admin:${actor.id}`,
  });

  if (error) {
    if (error.message.includes("insufficient_funds")) {
      return { ok: false, error: de.admin.retryInsufficientFunds };
    }
    if (error.message.includes("item_not_retryable")) {
      return { ok: false, error: de.admin.retryOnlyFailed };
    }
    console.error("admin_retry_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "item_retry",
    targetType: "send_job_item",
    targetId: parsed.data.itemId,
    details: { clone_id: cloneId },
  });
  revalidatePath("/admin/sendungen");
  return { ok: true };
}

// --- send review (hold before submission) -----------------------------------

const reviewJobSchema = z.object({ jobId: z.string().uuid() });

/** Ends the review hold early; the job's letters go to the provider now. */
export async function releaseSendJobAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = reviewJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  // Released before the review mail ran: fingerprint what is releasable now,
  // otherwise the worker would read the missing hash as a content change.
  const { data: job } = await admin
    .from("send_jobs")
    .select("letter_id, sender_snapshot, review_content_hash")
    .eq("id", parsed.data.jobId)
    .maybeSingle();
  if (job && !job.review_content_hash) {
    try {
      const { contentHash } = await renderReviewPreview(job.letter_id, job.sender_snapshot);
      await admin
        .from("send_jobs")
        .update({ review_content_hash: contentHash })
        .eq("id", parsed.data.jobId)
        .is("review_content_hash", null);
    } catch (err) {
      console.error("admin_release_hash_failed", { error: err instanceof Error ? err.message : "?" });
    }
  }

  const { data: moved, error } = await admin.rpc("admin_release_send_job", {
    p_job_id: parsed.data.jobId,
  });
  if (error) {
    if (error.message.includes("job_not_releasable")) {
      return { ok: false, error: de.admin.review.notReleasable };
    }
    console.error("admin_release_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "send_job_release",
    targetType: "send_job",
    targetId: parsed.data.jobId,
    details: { queue_jobs_moved: moved },
  });
  revalidatePath("/admin/pruefung");
  return { ok: true };
}

const stopJobSchema = reviewJobSchema.extend({ block: z.enum(["true", "false"]) });

/**
 * Stops a job under review. The job-level stop marker comes first: items a
 * worker already claimed (`submitting`) are beyond cancel_pending_job_items
 * but are caught by the worker's pre-POST check. With block=true the owner
 * is blocked too and all their other open jobs stop. Returns the outcome
 * message (how many were stopped, intercepted or already out).
 */
export async function stopSendJobAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ message: string }>> {
  const actor = await requireAdmin();
  const parsed = stopJobSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: job } = await admin
    .from("send_jobs")
    .select("user_id, status")
    .eq("id", parsed.data.jobId)
    .maybeSingle();
  if (!job) return { ok: false, error: de.common.genericError };
  const block = parsed.data.block === "true";
  if (block && job.user_id === actor.id) return { ok: false, error: de.admin.cannotBlockSelf };
  if (!block && ["canceled", "completed", "completed_with_errors"].includes(job.status)) {
    return { ok: false, error: de.admin.review.nothingToStop };
  }

  const { error: markError } = await admin
    .from("send_jobs")
    .update({ review_stopped_at: new Date().toISOString() })
    .eq("id", parsed.data.jobId)
    .is("review_stopped_at", null);
  if (markError) {
    console.error("admin_stop_mark_failed", { error: markError.message });
    return { ok: false, error: de.common.genericError };
  }

  const actorLabel = `admin:${actor.id}`;
  const { error } = await admin.rpc("cancel_pending_job_items", {
    p_job_id: parsed.data.jobId,
    p_actor: actorLabel,
  });
  if (error) {
    console.error("admin_stop_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  const { data: items } = await admin
    .from("send_job_items")
    .select("status, provider_letter_id")
    .eq("job_id", parsed.data.jobId);
  const canceled = (items ?? []).filter((i) => i.status === "canceled").length;
  const inFlight = (items ?? []).filter((i) => i.status === "submitting").length;
  const submitted = (items ?? []).filter((i) => i.provider_letter_id).length;
  await writeAuditLog({
    actorUserId: actor.id,
    action: "send_job_stop",
    targetType: "send_job",
    targetId: parsed.data.jobId,
    details: { canceled, in_flight: inFlight, submitted },
  });

  let message = de.admin.review.stopped(canceled, inFlight, submitted);
  if (block) {
    try {
      const jobsStopped = await blockAccountAndStopSends(job.user_id, actorLabel);
      await writeAuditLog({
        actorUserId: actor.id,
        action: "user_block",
        targetType: "user",
        targetId: job.user_id,
        details: { reason: "send_review", jobs_stopped: jobsStopped },
      });
      message += de.admin.review.blockedSuffix;
    } catch (err) {
      console.error("admin_block_failed", { error: err instanceof Error ? err.message : "?" });
      return { ok: false, error: de.common.genericError };
    }
  }

  revalidatePath("/admin/pruefung");
  return { ok: true, data: { message } };
}

// --- Gutscheine (vouchers) ---------------------------------------------------

// Non-ambiguous alphabet (no O/0/I/1/L) for auto-generated codes.
const VOUCHER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cryptographically random, unbiased voucher code. */
function generateVoucherCode(length = 12): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += VOUCHER_ALPHABET[randomInt(VOUCHER_ALPHABET.length)];
  return out;
}

/**
 * Creates a gift-credit voucher. Code is admin-chosen or auto-generated; on a
 * collision an auto-generated code retries with a fresh value. Returns the final
 * code so the admin can copy it (an auto code is only shown here).
 */
export async function createVoucherAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ code: string }>> {
  const actor = await requireAdmin();
  const parsed = createVoucherSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? de.common.genericError };
  }
  const d = parsed.data;
  if (d.code && !VOUCHER_CODE_RE.test(d.code)) {
    return { ok: false, error: de.admin.voucherCodeInvalid };
  }
  // Inclusive end of the chosen day (UTC) so "gültig bis 31.12." covers it.
  const validUntil = d.validUntil ? `${d.validUntil}T23:59:59.999Z` : null;

  const admin = createAdminClient();
  const autoCode = !d.code;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < (autoCode ? 5 : 1); attempt += 1) {
    const code = d.code || generateVoucherCode();
    const { data, error } = await admin
      .from("vouchers")
      .insert({
        code,
        amount_cents: d.amountCents,
        max_redemptions: d.maxRedemptions,
        valid_until: validUntil,
        comment: d.comment || null,
        created_by: `admin:${actor.id}`,
      })
      .select("id, code")
      .single();

    if (!error && data) {
      await writeAuditLog({
        actorUserId: actor.id,
        action: "voucher_create",
        targetType: "voucher",
        targetId: data.id,
        details: {
          code: data.code,
          amount_cents: d.amountCents,
          max_redemptions: d.maxRedemptions,
          valid_until: validUntil,
        },
      });
      revalidatePath("/admin/gutscheine");
      return { ok: true, data: { code: data.code } };
    }
    if (error?.code === "23505" || error?.message.includes("duplicate key")) {
      lastError = de.admin.voucherCodeTaken;
      continue; // auto code collided — try another
    }
    console.error("voucher_create_failed", { error: error?.message });
    return { ok: false, error: de.common.genericError };
  }
  return { ok: false, error: lastError ?? de.common.genericError };
}

/** Activates / deactivates a voucher (deactivated codes can't be redeemed). */
export async function toggleVoucherAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z
    .object({ id: z.string().uuid(), active: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const active = parsed.data.active === "true";
  const { error } = await admin
    .from("vouchers")
    .update({ is_active: active })
    .eq("id", parsed.data.id);
  if (error) {
    console.error("voucher_toggle_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  await writeAuditLog({
    actorUserId: actor.id,
    action: "voucher_toggle",
    targetType: "voucher",
    targetId: parsed.data.id,
    details: { active },
  });
  revalidatePath("/admin/gutscheine");
  return { ok: true };
}

/** Deletes an unredeemed voucher. Redeemed ones must be deactivated instead. */
export async function deleteVoucherAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: voucher } = await admin
    .from("vouchers")
    .select("redemption_count")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if ((voucher?.redemption_count ?? 0) > 0) {
    return { ok: false, error: de.admin.voucherDeleteRedeemed };
  }

  const { error } = await admin.from("vouchers").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("voucher_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  await writeAuditLog({
    actorUserId: actor.id,
    action: "voucher_delete",
    targetType: "voucher",
    targetId: parsed.data.id,
  });
  revalidatePath("/admin/gutscheine");
  return { ok: true };
}
