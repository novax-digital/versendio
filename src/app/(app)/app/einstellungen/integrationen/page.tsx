import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/server/env";
import { de } from "@/lib/i18n/de";
import { ApiKeysManager, type ApiKey } from "./api-keys-manager";
import { ApiDocs } from "./api-docs";
import { MocoCard, type MocoAccountView, type MocoDocumentView } from "./moco-card";

export const metadata: Metadata = { title: de.integrations.title };

export default async function IntegrationsSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  // key_hash is intentionally NOT selected — it never leaves the server.
  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  // moco_accounts is service-role only; select safe display fields, never the
  // encrypted key. The document ledger is RLS-readable (select-own policy).
  const admin = createAdminClient();
  const { data: moco } = await admin
    .from("moco_accounts")
    .select(
      "subdomain, status, last_error, last_sync_at, auto_send_invoices, invoice_trigger_status, auto_send_reminders, is_duplex, is_color",
    )
    .eq("user_id", profile.id)
    .maybeSingle();
  const mocoAccount: MocoAccountView | null = moco
    ? {
        subdomain: moco.subdomain,
        status: moco.status,
        lastError: moco.last_error,
        lastSyncAt: moco.last_sync_at,
        autoInvoices: moco.auto_send_invoices,
        invoiceTrigger: moco.invoice_trigger_status === "sent" ? "sent" : "created",
        autoReminders: moco.auto_send_reminders,
        duplex: moco.is_duplex,
        color: moco.is_color,
      }
    : null;

  let mocoDocuments: MocoDocumentView[] = [];
  if (mocoAccount) {
    const { data: docs } = await supabase
      .from("moco_documents")
      .select("id, doc_type, identifier, title, status, detail, created_at, send_job_id")
      .order("created_at", { ascending: false })
      .limit(10);
    mocoDocuments = (docs ?? []).map((d) => ({
      id: d.id,
      docType: d.doc_type,
      identifier: d.identifier,
      title: d.title,
      status: d.status,
      detail: d.detail,
      createdAt: d.created_at,
      sendJobId: d.send_job_id,
    }));
  }

  const base = (serverEnv().APP_URL ?? "https://app.versendio.de").replace(/\/$/, "");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-muted-foreground text-sm">{de.integrations.subtitle}</p>
      </div>
      <MocoCard account={mocoAccount} documents={mocoDocuments} />
      <ApiKeysManager keys={(keys ?? []) as ApiKey[]} />
      <ApiDocs baseUrl={base} showWhitelabel={profile.is_whitelabel} />
    </div>
  );
}
