"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/auth-context";
import { writeAuditLog } from "@/lib/server/audit";
import { enqueueJob } from "@/lib/server/queue/enqueue";
import { serverEnv } from "@/lib/server/env";
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

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.userId);
  if (error) {
    console.error("admin_set_status_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: parsed.data.status === "blocked" ? "user_block" : "user_unblock",
    targetType: "user",
    targetId: parsed.data.userId,
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
  low_credit_threshold_cents: z.number().int().min(0),
  queue_batch_size: z.number().int().min(1).max(100),
  status_sync_interval_minutes: z.number().int().min(1).max(1440),
  status_sync_max_queries_per_run: z.number().int().min(1).max(500),
  mock_fail_percent: z.number().min(0).max(100),
  mock_status_step_minutes: z.number().min(0.1).max(1440),
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
