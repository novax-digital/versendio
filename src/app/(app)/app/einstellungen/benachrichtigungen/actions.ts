"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import type { ActionResult } from "@/lib/server/action-result";
import { notificationPrefsSchema } from "@/lib/shared/schemas/profile";
import { de } from "@/lib/i18n/de";

/**
 * Saves the user's e-mail notification opt-outs. Plain profile columns —
 * writable through the standard profiles_update_own RLS policy, enforcement
 * happens centrally in processSendEmail.
 */
export async function updateNotificationPrefsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = notificationPrefsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      notify_send_status: parsed.data.sendStatus,
      notify_epost_updates: parsed.data.epostUpdates,
      notify_topup: parsed.data.topup,
      notify_flow_activity: parsed.data.flowActivity,
    })
    .eq("id", profile.id);

  if (error) {
    console.error("notification_prefs_save_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/benachrichtigungen");
  return { ok: true };
}
