import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GDPR Art. 20 data export. Runs with the service-role client scoped
 * explicitly by user_id (the caller is always the data subject). EK/margin
 * fields are excluded — they are our cost basis, not the user's personal data.
 */
export async function exportUserData(userId: string): Promise<Record<string, unknown>> {
  const admin = createAdminClient();

  const [profile, senderAddresses, contacts, leadLists, letters, templates, jobs, items, ledger] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, email, display_name, company, billing_street, billing_zip, billing_city, billing_country, credit_balance_cents, created_at",
        )
        .eq("id", userId)
        .single()
        .then((r) => r.data),
      admin.from("sender_addresses").select("*").eq("user_id", userId).then((r) => r.data ?? []),
      admin.from("contacts").select("*").eq("user_id", userId).then((r) => r.data ?? []),
      admin
        .from("lead_lists")
        .select("id, name, description, source, created_at, lead_list_entries(contact_id)")
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
      admin
        .from("letters")
        .select("id, title, source, page_count, sheet_count, status, created_at")
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
      admin
        .from("letter_templates")
        .select("id, name, created_at")
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
      admin
        .from("send_jobs")
        .select(
          "id, status, is_test, is_color, is_duplex, registered, total_items, total_vk_cents, created_at, completed_at",
        )
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
      admin
        .from("send_job_items")
        .select(
          "id, job_id, status, recipient_snapshot, sheet_count, vk_cents, provider_letter_id, submitted_at, created_at",
        )
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
      admin
        .from("credit_transactions")
        .select("id, type, amount_cents, balance_after_cents, comment, receipt_url, created_at")
        .eq("user_id", userId)
        .then((r) => r.data ?? []),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    format: "e-post-mailer/gdpr-export/v1",
    profile,
    senderAddresses,
    contacts,
    leadLists,
    letters,
    letterTemplates: templates,
    sendJobs: jobs,
    sendJobItems: items,
    creditTransactions: ledger,
  };
}
