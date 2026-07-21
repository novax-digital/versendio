"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import type { ActionResult } from "@/lib/server/action-result";
import { fieldErrorsFromZod } from "@/lib/server/action-result";
import { wlCustomerSchema } from "@/lib/shared/schemas/whitelabel";
import { de } from "@/lib/i18n/de";

/** Guard shared by all whitelabel actions: flag + active account. */
async function requireWhitelabel() {
  const profile = await requireProfile();
  if (!profile.is_whitelabel) return { profile, error: de.whitelabel.notEnabled };
  const blocked = blockedActionError(profile);
  if (blocked) return { profile, error: blocked };
  return { profile, error: null };
}

export async function upsertWlCustomerAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { error: guard } = await requireWhitelabel();
  if (guard) return { ok: false, error: guard };

  const parsed = wlCustomerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }
  const d = parsed.data;
  const values = {
    name: d.name,
    external_ref: d.externalRef || null,
    email: d.email || null,
    notes: d.notes || null,
  };

  const supabase = await createClient();
  const profile = await requireProfile();
  const { error } = d.id
    ? await supabase.from("wl_customers").update(values).eq("id", d.id)
    : await supabase.from("wl_customers").insert({ ...values, user_id: profile.id });

  if (error) {
    if (error.code === "23505" || error.message.includes("duplicate key")) {
      return { ok: false, error: de.whitelabel.externalRefTaken };
    }
    console.error("wl_customer_save_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/whitelabel");
  return { ok: true };
}

export async function toggleWlCustomerAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { error: guard } = await requireWhitelabel();
  if (guard) return { ok: false, error: guard };

  const parsed = z
    .object({ id: z.string().uuid(), active: z.enum(["true", "false"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("wl_customers")
    .update({ is_active: parsed.data.active === "true" })
    .eq("id", parsed.data.id);
  if (error) {
    console.error("wl_customer_toggle_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/whitelabel");
  return { ok: true };
}

export async function deleteWlCustomerAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const { error: guard } = await requireWhitelabel();
  if (guard) return { ok: false, error: guard };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase.from("wl_customers").delete().eq("id", parsed.data.id);
  if (error) {
    // FK restrict: the end-customer has attributed sends — billing history
    // must survive, deactivate instead.
    if (error.code === "23503" || error.message.includes("foreign key")) {
      return { ok: false, error: de.whitelabel.deleteHasSends };
    }
    console.error("wl_customer_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/whitelabel");
  return { ok: true };
}
