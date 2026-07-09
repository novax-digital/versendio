"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import { type ActionResult, fieldErrorsFromZod } from "@/lib/server/action-result";
import { profileSchema, senderAddressSchema } from "@/lib/shared/schemas/profile";
import { changePasswordSchema } from "@/lib/shared/schemas/auth";
import { de } from "@/lib/i18n/de";
import { z } from "zod";

export async function updateProfileAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      company: parsed.data.company || null,
      billing_street: parsed.data.billingStreet || null,
      billing_zip: parsed.data.billingZip || null,
      billing_city: parsed.data.billingCity || null,
      billing_country: parsed.data.billingCountry,
    })
    .eq("id", profile.id);

  if (error) {
    console.error("profile_update_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function changePasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();

  // Throttle the re-auth below: without this, a hijacked session could
  // brute-force the current password through repeated change attempts.
  const ip = await clientIp();
  if (!(await checkRateLimit("login", `pwchange:${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = changePasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const supabase = await createClient();

  // Re-authenticate with the current password before changing it, so a merely
  // hijacked session cannot silently lock the owner out (security hardening).
  if (profile.email) {
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: parsed.data.currentPassword,
    });
    if (reauthError) {
      return {
        ok: false,
        error: de.profile.currentPasswordWrong,
        fieldErrors: { currentPassword: de.profile.currentPasswordWrong },
      };
    }
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.error("change_password_failed", { code: error.code });
    return { ok: false, error: de.common.genericError };
  }

  return { ok: true };
}

// --- sender addresses ------------------------------------------------------

const senderAddressIdSchema = z.object({ id: z.string().uuid() });

export async function upsertSenderAddressAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const raw = Object.fromEntries(formData);
  const parsed = senderAddressSchema.safeParse({
    ...raw,
    isDefault: raw.isDefault === "on" || raw.isDefault === "true",
  });
  if (!parsed.success) {
    return { ok: false, error: "", fieldErrors: fieldErrorsFromZod(parsed.error.issues) };
  }

  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const supabase = await createClient();

  // Atomic clear-old-default + upsert in one transaction (see RPC): a failing
  // write can never leave the account without a default sender address.
  const { error } = await supabase.rpc("upsert_sender_address", {
    p_id: id,
    p_label: parsed.data.label,
    p_company: parsed.data.company || null,
    p_first_name: parsed.data.firstName || null,
    p_last_name: parsed.data.lastName || null,
    p_street: parsed.data.street,
    p_zip: parsed.data.zip,
    p_city: parsed.data.city,
    p_country: parsed.data.country,
    p_sender_line: parsed.data.senderLine,
    p_is_default: parsed.data.isDefault,
  });

  if (error) {
    console.error("sender_address_save_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/absenderadressen");
  return { ok: true };
}

export async function deleteSenderAddressAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const parsed = senderAddressIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: de.common.genericError };
  }

  const supabase = await createClient();
  const { data: address } = await supabase
    .from("sender_addresses")
    .select("id, is_default")
    .eq("id", parsed.data.id)
    .single();

  if (address?.is_default) {
    return { ok: false, error: de.senderAddresses.cannotDeleteDefault };
  }

  const { error } = await supabase.from("sender_addresses").delete().eq("id", parsed.data.id);
  if (error) {
    console.error("sender_address_delete_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/absenderadressen");
  return { ok: true };
}

export async function setDefaultSenderAddressAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const parsed = senderAddressIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: de.common.genericError };
  }

  const supabase = await createClient();
  // Atomic clear-then-set via RPC (guards ownership, avoids the zero-default window).
  const { error } = await supabase.rpc("set_default_sender_address", {
    p_id: parsed.data.id,
  });
  if (error) {
    console.error("sender_address_set_default_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/absenderadressen");
  return { ok: true };
}
