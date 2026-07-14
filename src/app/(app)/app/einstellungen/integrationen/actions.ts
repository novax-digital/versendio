"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/server/api-keys";
import { checkRateLimit, clientIp } from "@/lib/server/rate-limit";
import type { ActionResult } from "@/lib/server/action-result";
import { de } from "@/lib/i18n/de";

const MAX_KEYS = 10;

export async function createApiKeyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ key: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = z
    .object({ name: z.string().trim().min(1).max(60) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.validation.fieldRequired };

  const supabase = await createClient();
  // Explicit owner scope: the RLS policy widens for admins, so the per-user
  // cap must filter by user_id rather than rely on RLS.
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_KEYS) {
    return { ok: false, error: de.integrations.tooManyKeys };
  }

  const { key, hash, prefix } = generateApiKey();
  const { error } = await supabase.from("api_keys").insert({
    user_id: profile.id,
    name: parsed.data.name,
    key_hash: hash,
    key_prefix: prefix,
  });
  if (error) {
    console.error("api_key_create_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/integrationen");
  // Plaintext returned exactly once — never stored.
  return { ok: true, data: { key } };
}

export async function revokeApiKeyAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("user_id", profile.id)
    .is("revoked_at", null);
  if (error) {
    console.error("api_key_revoke_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/einstellungen/integrationen");
  return { ok: true };
}
