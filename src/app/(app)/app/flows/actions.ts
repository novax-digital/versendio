"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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

  // Letter must exist, be owned (RLS) and be ready to send.
  const { data: letter } = await supabase
    .from("letters")
    .select("id, status")
    .eq("id", data.letterId)
    .maybeSingle();
  if (!letter) return { ok: false, error: de.flows.letterNotFound };
  if (letter.status !== "ready") return { ok: false, error: de.flows.letterNotReady };

  // Sender (optional): must be owned if given.
  if (data.senderAddressId) {
    const { data: sender } = await supabase
      .from("sender_addresses")
      .select("id")
      .eq("id", data.senderAddressId)
      .maybeSingle();
    if (!sender) return { ok: false, error: de.flows.senderNotFound };
  }

  // Resolve the target list. Existing → verify ownership. New → auto-create.
  let listId: string;
  let createdListId: string | null = null;
  if (data.listMode === "existing") {
    const { data: list } = await supabase
      .from("lead_lists")
      .select("id")
      .eq("id", data.listId!)
      .maybeSingle();
    if (!list) return { ok: false, error: de.flows.listNotFound };
    listId = list.id;
  } else {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .insert({ user_id: profile.id, name: `Flow: ${data.name}`, source: "flow" })
      .select("id")
      .single();
    if (error || !list) {
      console.error("flow_list_create_failed", { error: error?.message });
      return { ok: false, error: de.common.genericError };
    }
    listId = list.id;
    createdListId = list.id;
  }

  const delayMinutes = parseDelay(data.delayValue, data.delayUnit);
  const values = {
    user_id: profile.id,
    name: data.name,
    list_id: listId,
    letter_id: data.letterId,
    delay_minutes: delayMinutes,
    is_color: data.options.isColor,
    is_duplex: data.options.isDuplex,
    registered: data.options.registered,
    sender_address_id: data.senderAddressId ?? null,
  };

  const id = typeof data.id === "string" && data.id ? data.id : null;
  if (id) {
    // Editing never re-points the list (that would strand existing enrollments).
    const { list_id: _omitListId, ...editable } = values;
    void _omitListId;
    const { error } = await supabase.from("flows").update(editable).eq("id", id);
    if (error) {
      console.error("flow_update_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
    revalidatePath("/app/flows");
    revalidatePath(`/app/flows/${id}`);
    return { ok: true, data: { flowId: id } };
  }

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
  // Only NEW contacts are enrolled (no backfill): activating just flips the flag;
  // the enrollment trigger picks up contacts added from now on.
  const { error } = await supabase
    .from("flows")
    .update({ is_active: activate, activated_at: activate ? new Date().toISOString() : null })
    .eq("id", parsed.data.id);
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
  const { error } = await supabase.from("flows").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("flow_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/flows");
  return { ok: true };
}
