"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/auth-context";
import { writeAuditLog } from "@/lib/server/audit";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Approves a review request and credits the customer atomically. The
 * approve_review_reward RPC flips pending → approved and books the snapshotted
 * amount via book_credit in one transaction; a second click finds the row no
 * longer pending and returns null (no double-credit).
 */
export async function approveReviewRewardAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: amount, error } = await admin.rpc("approve_review_reward", {
    p_id: parsed.data.id,
    p_actor: actor.id,
  });
  if (error) {
    console.error("review_reward_approve_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  if (amount == null) {
    // Already approved/rejected by someone else — nothing was credited.
    return { ok: false, error: de.admin.reviewAlreadyHandled };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "review_reward_approve",
    targetType: "review_reward",
    targetId: parsed.data.id,
    details: { amount_cents: amount },
  });
  revalidatePath("/admin/bewertungen");
  return { ok: true };
}

/** Rejects a pending review request. No credit is booked. */
export async function rejectReviewRewardAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireAdmin();
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  // Conditional single-row update: only a still-pending request flips, so a
  // race against approve cannot reject an already-credited request.
  const { data, error } = await admin
    .from("review_rewards")
    .update({
      status: "rejected",
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .eq("status", "pending")
    .select("id");
  if (error) {
    console.error("review_reward_reject_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  if (!data || data.length === 0) {
    return { ok: false, error: de.admin.reviewAlreadyHandled };
  }

  await writeAuditLog({
    actorUserId: actor.id,
    action: "review_reward_reject",
    targetType: "review_reward",
    targetId: parsed.data.id,
  });
  revalidatePath("/admin/bewertungen");
  return { ok: true };
}
