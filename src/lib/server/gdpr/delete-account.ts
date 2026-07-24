import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKETS } from "@/lib/server/storage";
import { getStripe, stripeEnabled } from "@/lib/server/stripe";
import { sendMail } from "@/lib/server/mail";
import { renderBrandedEmail } from "@/lib/server/mail-template";
import { serverEnv } from "@/lib/server/env";

/**
 * GDPR account deletion (ADR-0009 §1). Order matters:
 * 1. capture the data we need before it is scrubbed (email, Stripe customer)
 * 2. wipe storage objects (SQL cannot reach them)
 * 3. anonymize + refund + hard-delete personal rows in one transaction (RPC)
 * 4. delete the Stripe customer and the auth user (login dies last so a
 *    failure earlier leaves the account usable rather than half-deleted)
 */
export async function deleteAccount(
  userId: string,
  actorUserId: string | null,
): Promise<{ ok: true; openProviderItems: number } | { ok: false; error: string }> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("email, display_name, status")
    .eq("id", userId)
    .single();
  if (!profile) return { ok: false, error: "user_not_found" };
  if (profile.status === "deleted") return { ok: true, openProviderItems: 0 };

  const { data: billing } = await admin
    .from("billing_accounts")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  const emailForFarewell = profile.email;
  const displayName = profile.display_name;

  // 2) Storage: everything under {user_id}/ in every bucket.
  for (const bucket of [BUCKETS.letters, BUCKETS.assets, BUCKETS.imports]) {
    await removePrefix(bucket, userId);
  }

  // 3) Transactional DB anonymization (refunds pending items, scrubs PII).
  const { data: openItems, error } = await admin.rpc("anonymize_account", {
    p_user_id: userId,
    p_actor_user_id: actorUserId,
  });
  if (error) {
    console.error("anonymize_account_failed", { error: error.message });
    return { ok: false, error: "anonymize_failed" };
  }
  await admin.rpc("purge_user_rate_limits", { p_user_id: userId });
  await admin.rpc("delete_user_api_keys", { p_user_id: userId });
  // End-customer rows carry THIRD-PARTY PII (names/e-mails) — detach job
  // attribution, then drop them (profiles are anonymized, cascades never
  // fire). Unlike the credential cleanups above, a failure here must fail the
  // deletion: reporting success while foreign PII persists would be a silent
  // GDPR violation with no retry path.
  const { error: wlError } = await admin.rpc("delete_user_wl_customers", { p_user_id: userId });
  if (wlError) {
    console.error("delete_wl_customers_failed", { error: wlError.message });
    return { ok: false, error: "wl_cleanup_failed" };
  }
  // MOCO connection (encrypted third-party credential) + document ledger
  // (third-party business identifiers) — same must-not-silently-persist rule.
  const { error: mocoError } = await admin.rpc("delete_user_moco_data", { p_user_id: userId });
  if (mocoError && mocoError.code !== "PGRST202") {
    // PGRST202: RPC missing (deploy racing the migration) — nothing to delete.
    console.error("delete_moco_data_failed", { error: mocoError.message });
    return { ok: false, error: "moco_cleanup_failed" };
  }

  // 4) External identities last.
  if (billing?.stripe_customer_id && stripeEnabled()) {
    try {
      await getStripe().customers.del(billing.stripe_customer_id);
    } catch (err) {
      console.error("stripe_customer_delete_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    // The profile is already anonymized and cannot log in meaningfully; surface
    // for manual cleanup rather than pretending everything succeeded.
    console.error("auth_user_delete_failed", { code: authError.code });
  }

  if (emailForFarewell) {
    const appName = serverEnv().APP_NAME;
    const { html, text } = renderBrandedEmail({
      displayName,
      paragraphs: [
        "Ihr Konto wurde gelöscht. Ihre persönlichen Daten, Briefe und Kontakte wurden entfernt. Abrechnungsdaten bewahren wir gesetzeskonform in anonymisierter Form auf.",
      ],
    });
    await sendMail({
      to: emailForFarewell,
      subject: `Ihr Konto wurde gelöscht – ${appName}`,
      html,
      text,
    });
  }

  return { ok: true, openProviderItems: Number(openItems ?? 0) };
}

/** Recursively removes every object under `{userId}/` in a bucket. */
async function removePrefix(bucket: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const queue: string[] = [userId];

  while (queue.length > 0) {
    const prefix = queue.pop()!;
    const { data: entries, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error || !entries) continue;

    const files: string[] = [];
    for (const entry of entries) {
      // Supabase marks folders with a null id.
      if (entry.id === null) queue.push(`${prefix}/${entry.name}`);
      else files.push(`${prefix}/${entry.name}`);
    }
    if (files.length > 0) {
      const { error: removeError } = await admin.storage.from(bucket).remove(files);
      if (removeError) {
        console.error("storage_prefix_remove_failed", { bucket, error: removeError.message });
      }
    }
  }
}
