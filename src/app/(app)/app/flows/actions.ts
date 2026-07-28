"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { flowSchema } from "@/lib/shared/schemas/flow";
import { parseDelay } from "@/lib/shared/flows";
import { de } from "@/lib/i18n/de";

/**
 * Creates or updates a flow. The target list is either an existing owned list or
 * a newly auto-created "Flow: <name>" list. Letter/list/sender ownership is
 * verified through the RLS-scoped client before writing.
 */
export async function upsertFlowAction(_prev: unknown, input: unknown): Promise<ActionResult<{ flowId: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = flowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }
  const data = parsed.data;
  const supabase = await createClient();

  // Letter must exist, be owned and be ready to send. Ownership is pinned
  // explicitly — the RLS policy alone must not be the only guard.
  const { data: letter } = await supabase
    .from("letters")
    .select("id, status, source, use_cover_letter")
    .eq("id", data.letterId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!letter) return { ok: false, error: de.flows.letterNotFound };
  if (letter.status !== "ready") return { ok: false, error: de.flows.letterNotReady };
  // A static upload without cover letter can match at most one printed
  // address, but a flow targets arbitrary future recipients (E203 guard).
  if (letter.source === "upload" && !letter.use_cover_letter) {
    return { ok: false, error: de.flows.uploadNeedsCover };
  }

  // Sender (optional): must be owned if given.
  if (data.senderAddressId) {
    const { data: sender } = await supabase
      .from("sender_addresses")
      .select("id")
      .eq("id", data.senderAddressId)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!sender) return { ok: false, error: de.flows.senderNotFound };
  }

  // MOCO source: requires a connected MOCO account; the backing list is
  // always auto-created (the MOCO scanner feeds it, nobody else should).
  if (data.source === "moco") {
    const admin = createAdminClient();
    const { data: account } = await admin
      .from("moco_accounts")
      .select("user_id, status")
      .eq("user_id", profile.id)
      .maybeSingle();
    // An 'error' connection (revoked key) must not silently accept new
    // automation that can never run.
    if (!account || account.status !== "active") {
      return { ok: false, error: de.flows.mocoNotConnected };
    }
  }

  const delayMinutes = parseDelay(data.delayValue, data.delayUnit);
  const id = typeof data.id === "string" && data.id ? data.id : null;

  if (id) {
    // EDIT: never re-points the list (that would strand existing
    // enrollments), never flips the source, and never creates a list —
    // a stray create here orphaned one "MOCO-Flow: <name>" list per save.
    // MOCO fields are only writable on an actual MOCO flow, and changing
    // the trigger or invoice status on an ACTIVE flow restarts the
    // watermark: the new matching set must not be applied retroactively
    // over the whole since-activation window.
    const { data: currentFlow } = await supabase
      .from("flows")
      .select("source, is_active, moco_trigger, moco_invoice_status")
      .eq("id", id)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!currentFlow) return { ok: false, error: de.common.genericError };

    const editable: Record<string, unknown> = {
      name: data.name,
      letter_id: data.letterId,
      delay_minutes: delayMinutes,
      is_color: data.options.isColor,
      is_duplex: data.options.isDuplex,
      registered: data.options.registered,
      sender_address_id: data.senderAddressId ?? null,
    };
    if (currentFlow.source === "moco" && data.mocoTrigger) {
      editable.moco_trigger = data.mocoTrigger;
      editable.moco_invoice_status = data.mocoInvoiceStatus;
      const configChanged =
        currentFlow.moco_trigger !== data.mocoTrigger ||
        currentFlow.moco_invoice_status !== data.mocoInvoiceStatus;
      if (configChanged && currentFlow.is_active) {
        editable.activated_at = new Date().toISOString();
      }
    }
    const { error } = await supabase
      .from("flows")
      .update(editable)
      .eq("id", id)
      .eq("user_id", profile.id);
    if (error) {
      console.error("flow_update_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
    revalidatePath("/app/flows");
    revalidatePath(`/app/flows/${id}`);
    return { ok: true, data: { flowId: id } };
  }

  // CREATE: resolve the target list. Existing → verify ownership. New/MOCO →
  // auto-create.
  let listId: string;
  let createdListId: string | null = null;
  if (data.source === "list" && data.listMode === "existing") {
    const { data: list } = await supabase
      .from("lead_lists")
      .select("id")
      .eq("id", data.listId!)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (!list) return { ok: false, error: de.flows.listNotFound };
    listId = list.id;
  } else {
    const prefix = data.source === "moco" ? "MOCO-Flow" : "Flow";
    const { data: list, error } = await supabase
      .from("lead_lists")
      .insert({ user_id: profile.id, name: `${prefix}: ${data.name}`, source: "flow" })
      .select("id")
      .single();
    if (error || !list) {
      console.error("flow_list_create_failed", { error: error?.message });
      return { ok: false, error: de.common.genericError };
    }
    listId = list.id;
    createdListId = list.id;
  }

  const values = {
    user_id: profile.id,
    name: data.name,
    source: data.source === "moco" ? ("moco" as const) : ("manual" as const),
    moco_trigger: data.source === "moco" ? data.mocoTrigger : null,
    moco_invoice_status: data.mocoInvoiceStatus,
    list_id: listId,
    letter_id: data.letterId,
    delay_minutes: delayMinutes,
    is_color: data.options.isColor,
    is_duplex: data.options.isDuplex,
    registered: data.options.registered,
    sender_address_id: data.senderAddressId ?? null,
  };

  const { data: flow, error } = await supabase.from("flows").insert(values).select("id").single();
  if (error || !flow) {
    console.error("flow_create_failed", { error: error?.message });
    // Compensate a half-created auto-list so we don't leave an orphan.
    if (createdListId) await supabase.from("lead_lists").delete().eq("id", createdListId);
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/flows");
  return { ok: true, data: { flowId: flow.id } };
}

export async function toggleFlowActiveAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = z
    .object({ id: z.string().uuid(), active: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const activate = parsed.data.active === "true";
  const supabase = await createClient();

  // Activation re-checks the letter's cover invariant — the cover may have
  // been switched off after the flow was created (E203 guard).
  if (activate) {
    const { data: flow } = await supabase
      .from("flows")
      .select("letter_id, letters(source, use_cover_letter)")
      .eq("id", parsed.data.id)
      .eq("user_id", profile.id)
      .maybeSingle();
    const letter = (flow?.letters as unknown as { source: string; use_cover_letter: boolean | null } | null);
    if (letter && letter.source === "upload" && !letter.use_cover_letter) {
      return { ok: false, error: de.flows.uploadNeedsCover };
    }
  }

  // Only NEW contacts are enrolled (no backfill): activating just flips the flag;
  // the enrollment trigger picks up contacts added from now on.
  const { error } = await supabase
    .from("flows")
    .update({ is_active: activate, activated_at: activate ? new Date().toISOString() : null })
    .eq("id", parsed.data.id)
    .eq("user_id", profile.id);
  if (error) {
    console.error("flow_toggle_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/flows");
  revalidatePath(`/app/flows/${parsed.data.id}`);
  return { ok: true };
}

export async function deleteFlowAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  // Enrollments cascade; the (possibly auto-created) list is kept so its contacts
  // and any send history remain intact.
  const supabase = await createClient();
  const { error } = await supabase
    .from("flows")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", profile.id);
  if (error) {
    console.error("flow_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/flows");
  return { ok: true };
}
