"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { deleteAccount } from "@/lib/server/gdpr/delete-account";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

const confirmSchema = z.object({
  confirm: z.literal("LÖSCHEN", { message: de.profile.deleteAccountConfirmMismatch }),
  password: z.string().min(1, de.validation.fieldRequired),
});

/**
 * Self-service account deletion (ADR-0009). Re-authenticates with the current
 * password first: a hijacked session must not be able to destroy the account.
 */
export async function deleteAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();

  const ip = await clientIp();
  if (!(await checkRateLimit("login", `delete:${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = confirmSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: { confirm: parsed.error.issues[0].message } };
  }

  if (!profile.email) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: profile.email,
    password: parsed.data.password,
  });
  if (reauthError) {
    return {
      ok: false,
      error: de.profile.currentPasswordWrong,
      fieldErrors: { password: de.profile.currentPasswordWrong },
    };
  }

  const result = await deleteAccount(profile.id, null);
  if (!result.ok) {
    return { ok: false, error: de.common.genericError };
  }

  await supabase.auth.signOut();
  redirect("/?konto=geloescht");
}
