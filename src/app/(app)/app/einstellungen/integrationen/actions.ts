"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile, blockedActionError } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/server/api-keys";
import { checkRateLimit, checkCustomLimit, clientIp } from "@/lib/server/rate-limit";
import { getJsonSetting } from "@/lib/server/settings";
import { encryptSecret } from "@/lib/server/crypto";
import { isValidMocoSubdomain, verifyMocoCredentials, MocoError } from "@/lib/server/moco/client";
import { syncMocoAccountForUser } from "@/lib/server/moco/sync";
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
  revalidatePath("/app/einstellungen/integrationen/api");
  // Plaintext returned exactly once — never stored.
  return { ok: true, data: { key } };
}

// --- MOCO integration ------------------------------------------------------
// moco_accounts is service-role only (encrypted third-party credential, no
// client RLS policies) — every access here goes through the admin client and
// is pinned to the authenticated profile id.

const mocoConnectSchema = z.object({
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    // Accept a pasted full host ("acme.mocoapp.com") and reduce it to the label.
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/\.mocoapp\.com.*$/, ""))
    .refine(isValidMocoSubdomain, de.integrations.mocoInvalidSubdomain),
  apiKey: z.string().trim().min(8).max(200),
});

export async function connectMocoAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `moco:${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = mocoConnectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? de.common.genericError };
  }

  try {
    const valid = await verifyMocoCredentials({
      subdomain: parsed.data.subdomain,
      apiKey: parsed.data.apiKey,
    });
    if (!valid) return { ok: false, error: de.integrations.mocoInvalidCredentials };
  } catch {
    return { ok: false, error: de.integrations.mocoConnectFailed };
  }

  const admin = createAdminClient();
  // Switching to a DIFFERENT MOCO tenant is a fresh integration: auto-send
  // must never silently continue with inherited rules/watermarks against a
  // new account's document space.
  const { data: existing } = await admin
    .from("moco_accounts")
    .select("subdomain")
    .eq("user_id", profile.id)
    .maybeSingle();
  const tenantSwitch = existing != null && existing.subdomain !== parsed.data.subdomain;

  const { error } = await admin.from("moco_accounts").upsert(
    {
      user_id: profile.id,
      subdomain: parsed.data.subdomain,
      api_key_enc: encryptSecret(parsed.data.apiKey),
      status: "active",
      last_error: null,
      ...(tenantSwitch
        ? {
            auto_send_invoices: false,
            auto_send_reminders: false,
            invoices_activated_at: null,
            reminders_activated_at: null,
          }
        : {}),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("moco_connect_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/integrationen");
  revalidatePath("/app/einstellungen/integrationen/moco");
  return { ok: true };
}

const mocoRulesSchema = z.object({
  autoInvoices: z.enum(["true", "false"]).transform((v) => v === "true"),
  invoiceTrigger: z.enum(["created", "sent"]),
  autoReminders: z.enum(["true", "false"]).transform((v) => v === "true"),
  duplex: z.enum(["true", "false"]).transform((v) => v === "true"),
  color: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export async function updateMocoRulesAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const parsed = mocoRulesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("moco_accounts")
    .select(
      "auto_send_invoices, auto_send_reminders, invoice_trigger_status, invoices_activated_at, reminders_activated_at",
    )
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!account) return { ok: false, error: de.integrations.mocoNotConnected };

  // PER-RULE watermarks: each rule that transitions off→on starts fresh at
  // "now" — enabling a second rule months later (or after a pause) must never
  // inherit an old watermark and mail the backlog. Changing the invoice
  // trigger status widens the matching set the same way, so it also resets.
  const now = new Date().toISOString();
  const invoicesActivatedAt =
    parsed.data.autoInvoices &&
    (!account.auto_send_invoices ||
      account.invoice_trigger_status !== parsed.data.invoiceTrigger ||
      !account.invoices_activated_at)
      ? now
      : account.invoices_activated_at;
  const remindersActivatedAt =
    parsed.data.autoReminders && (!account.auto_send_reminders || !account.reminders_activated_at)
      ? now
      : account.reminders_activated_at;

  const { error } = await admin
    .from("moco_accounts")
    .update({
      auto_send_invoices: parsed.data.autoInvoices,
      invoice_trigger_status: parsed.data.invoiceTrigger,
      auto_send_reminders: parsed.data.autoReminders,
      is_duplex: parsed.data.duplex,
      is_color: parsed.data.color,
      invoices_activated_at: invoicesActivatedAt,
      reminders_activated_at: remindersActivatedAt,
    })
    .eq("user_id", profile.id);
  if (error) {
    console.error("moco_rules_save_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/einstellungen/integrationen");
  revalidatePath("/app/einstellungen/integrationen/moco");
  return { ok: true };
}

export async function disconnectMocoAction(): Promise<ActionResult> {
  const profile = await requireProfile();

  const admin = createAdminClient();
  // The document ledger survives on purpose: it is the dedup anchor — a
  // reconnect must not re-send documents that already went out.
  const { error } = await admin.from("moco_accounts").delete().eq("user_id", profile.id);
  if (error) {
    console.error("moco_disconnect_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/einstellungen/integrationen");
  revalidatePath("/app/einstellungen/integrationen/moco");
  return { ok: true };
}

export async function syncMocoNowAction(): Promise<
  ActionResult<{ sent: number; failed: number; insufficientFunds: number }>
> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  // The operator kill switch must cover the manual path too — during an
  // incident every connected user could otherwise still trigger dispatches.
  if (!(await getJsonSetting<boolean>("moco_enabled", true))) {
    return { ok: false, error: de.integrations.mocoSyncDisabled };
  }

  // Manual syncs hit the MOCO API — keep them well under MOCO's rate budget.
  if (!(await checkCustomLimit(`moco_sync:${profile.id}`, 6, 3600))) {
    return { ok: false, error: de.common.rateLimited };
  }

  try {
    const result = await syncMocoAccountForUser(profile.id);
    if (!result) return { ok: false, error: de.integrations.mocoNotConnected };
    revalidatePath("/app/einstellungen/integrationen/moco");
    if (result.accountError === "auth") {
      return { ok: false, error: de.integrations.mocoInvalidCredentials };
    }
    if (result.accountError === "transient") {
      return { ok: false, error: de.integrations.mocoConnectFailed };
    }
    return {
      ok: true,
      data: {
        sent: result.sent,
        failed: result.failed,
        insufficientFunds: result.insufficientFunds,
      },
    };
  } catch (err) {
    if (err instanceof MocoError && !err.transient) {
      return { ok: false, error: de.integrations.mocoInvalidCredentials };
    }
    console.error("moco_manual_sync_failed", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, error: de.common.genericError };
  }
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
  revalidatePath("/app/einstellungen/integrationen/api");
  return { ok: true };
}
