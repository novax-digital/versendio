"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { leadListSchema } from "@/lib/shared/schemas/contact";
import { de } from "@/lib/i18n/de";

export async function upsertLeadListAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ listId: string }>> {
  const profile = await requireProfile();
  const raw = Object.fromEntries(formData);
  const parsed = leadListSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const values = {
    user_id: profile.id,
    name: parsed.data.name,
    description: parsed.data.description || null,
  };

  const supabase = await createClient();
  if (id) {
    // Explicit user scoping — the RLS policy alone must not be the only guard.
    const { error } = await supabase
      .from("lead_lists")
      .update(values)
      .eq("id", id)
      .eq("user_id", profile.id);
    if (error) {
      console.error("lead_list_save_failed", { error: error.message });
      return { ok: false, error: de.common.genericError };
    }
    revalidatePath("/app/leadlisten");
    return { ok: true, data: { listId: id } };
  }

  const { data, error } = await supabase.from("lead_lists").insert(values).select("id").single();
  if (error || !data) {
    console.error("lead_list_save_failed", { error: error?.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/leadlisten");
  return { ok: true, data: { listId: data.id } };
}

export async function deleteLeadListAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();

  // A list bound to a flow is protected by an ON DELETE RESTRICT FK — give a
  // friendly hint instead of a raw FK violation.
  const { data: flowsUsing } = await supabase
    .from("flows")
    .select("id")
    .eq("user_id", profile.id)
    .eq("list_id", parsed.data.id)
    .limit(1);
  if (flowsUsing && flowsUsing.length > 0) {
    return { ok: false, error: de.flows.listInUse };
  }

  const { error } = await supabase
    .from("lead_lists")
    .delete()
    .eq("id", parsed.data.id)
    .eq("user_id", profile.id);
  if (error) {
    console.error("lead_list_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/leadlisten");
  return { ok: true };
}

const entrySchema = z.object({
  listId: z.string().uuid(),
  contactId: z.string().uuid(),
});

export async function addListEntryAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const parsed = entrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase.from("lead_list_entries").insert({
    list_id: parsed.data.listId,
    contact_id: parsed.data.contactId,
  });
  if (error) {
    // 23505 = unique violation (already in list) — a user-level message, not a bug.
    if (error.code === "23505") {
      return { ok: false, error: de.leadLists.alreadyInList };
    }
    console.error("lead_list_entry_add_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath(`/app/leadlisten/${parsed.data.listId}`);
  return { ok: true };
}

export async function removeListEntryAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = z
    .object({ entryId: z.string().uuid(), listId: z.string().uuid() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();

  // lead_list_entries has no user_id column — ownership is pinned via the
  // parent list, and the delete is then constrained to that owned list.
  const { data: ownedList } = await supabase
    .from("lead_lists")
    .select("id")
    .eq("id", parsed.data.listId)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!ownedList) return { ok: false, error: de.common.genericError };

  const { error } = await supabase
    .from("lead_list_entries")
    .delete()
    .eq("id", parsed.data.entryId)
    .eq("list_id", parsed.data.listId);
  if (error) {
    console.error("lead_list_entry_remove_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath(`/app/leadlisten/${parsed.data.listId}`);
  return { ok: true };
}
