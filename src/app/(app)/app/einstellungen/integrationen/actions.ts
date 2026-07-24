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
import {
  CanvaError,
  exportCanvaDesignPdf,
  getValidCanvaAccessToken,
  isCanvaAuthError,
  revokeCanvaGrant,
} from "@/lib/server/canva/client";
import { LIMITS } from "@/lib/shared/schablone";
import { normalizePdfToA4 } from "@/lib/server/pdf/normalize";
import { validateLetterPdf } from "@/lib/server/pdf/validate";
import { isSubmittable } from "@/lib/shared/validation-result";
import { BUCKETS } from "@/lib/server/storage";
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

// --- Canva integration ------------------------------------------------------

const canvaImportSchema = z.object({
  designId: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  title: z.string().trim().min(1).max(180),
});

/**
 * Imports a Canva design as a ready-to-send letter: export as A4 PDF via the
 * Connect API, then the exact same normalize → validate → store path every
 * uploaded PDF takes. The letter is a regular letters row afterwards — usable
 * in manual sends and as a flow letter alike.
 */
export async function importCanvaDesignAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ letterId: string }>> {
  const profile = await requireProfile();
  const blocked = blockedActionError(profile);
  if (blocked) return { ok: false, error: blocked };

  const ip = await clientIp();
  if (!(await checkRateLimit("upload", `canva:${profile.id}:${ip}`))) {
    return { ok: false, error: de.common.rateLimited };
  }

  const parsed = canvaImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: de.common.genericError };

  let pdf: Uint8Array;
  try {
    const accessToken = await getValidCanvaAccessToken(profile.id);
    if (!accessToken) return { ok: false, error: de.integrations.canvaNotConnected };
    pdf = await exportCanvaDesignPdf(accessToken, parsed.data.designId);
  } catch (err) {
    // Only a dead GRANT means "reconnect" — a failed export of one design
    // must not send the user to re-authorize for nothing.
    if (isCanvaAuthError(err)) {
      return { ok: false, error: de.integrations.canvaReconnect };
    }
    if (err instanceof CanvaError && !err.transient) {
      return { ok: false, error: de.integrations.canvaExportRejected };
    }
    console.error("canva_export_failed", { error: err instanceof Error ? err.message : "?" });
    return { ok: false, error: de.integrations.canvaExportFailed };
  }
  if (pdf.byteLength > LIMITS.maxFileSizeBytes) {
    return { ok: false, error: de.letters.tooLarge };
  }

  const { bytes, adjusted } = await normalizePdfToA4(pdf);
  const validation = await validateLetterPdf(bytes, { a4Normalized: adjusted });
  if (!isSubmittable(validation)) {
    const firstError = validation.rules.find((r) => r.severity === "error");
    // The A4 hint only helps for FORMAT failures; other rules (page count,
    // encryption, ...) carry their own actionable message.
    const error =
      firstError?.id === "a4"
        ? `${de.integrations.canvaNotA4} ${firstError.message}`.trim()
        : (firstError?.message ?? de.integrations.canvaExportRejected);
    return { ok: false, error };
  }

  const admin = createAdminClient();
  const letterId = crypto.randomUUID();
  const storagePath = `${profile.id}/letters/${letterId}.pdf`;
  const { error: uploadError } = await admin.storage
    .from(BUCKETS.letters)
    .upload(storagePath, bytes as unknown as Blob, { contentType: "application/pdf" });
  if (uploadError) {
    console.error("canva_letter_store_failed", { error: uploadError.message });
    return { ok: false, error: de.common.genericError };
  }

  const coverSheets = validation.needsCoverLetter ? 1 : 0;
  const { error: insertError } = await admin.from("letters").insert({
    id: letterId,
    user_id: profile.id,
    title: `Canva: ${parsed.data.title}`.slice(0, 200),
    source: "upload",
    storage_path: storagePath,
    page_count: validation.pageCount,
    sheet_count: (validation.sheetCountSimplex ?? 0) + coverSheets,
    file_size_bytes: validation.fileSizeBytes,
    validation: validation as unknown as Record<string, unknown>,
    address_zone_result: validation.addressZoneResult,
    needs_cover_letter: validation.needsCoverLetter,
    use_cover_letter: validation.needsCoverLetter,
    has_placeholders: false,
    status: "ready",
  });
  if (insertError) {
    await admin.storage.from(BUCKETS.letters).remove([storagePath]);
    console.error("canva_letter_insert_failed", { error: insertError.message });
    return { ok: false, error: de.common.genericError };
  }

  revalidatePath("/app/briefe");
  return { ok: true, data: { letterId } };
}

export async function disconnectCanvaAction(): Promise<ActionResult> {
  const profile = await requireProfile();
  // Best-effort: remove the grant at Canva so the integration disappears
  // from the user's "connected apps" instead of leaving live tokens behind.
  await revokeCanvaGrant(profile.id);
  const admin = createAdminClient();
  const { error } = await admin.from("canva_accounts").delete().eq("user_id", profile.id);
  if (error) {
    console.error("canva_disconnect_failed", { error: error.message });
    return { ok: false, error: de.common.genericError };
  }
  revalidatePath("/app/einstellungen/integrationen");
  revalidatePath("/app/einstellungen/integrationen/canva");
  return { ok: true };
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
