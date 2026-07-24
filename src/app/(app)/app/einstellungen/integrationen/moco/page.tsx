import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { de } from "@/lib/i18n/de";
import { MocoCard, type MocoAccountView, type MocoDocumentView } from "../moco-card";

export const metadata: Metadata = { title: de.integrations.mocoTitle };

export default async function MocoIntegrationPage() {
  const profile = await requireProfile();

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
  const account: MocoAccountView | null = moco
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

  let documents: MocoDocumentView[] = [];
  if (account) {
    const supabase = await createClient();
    const { data: docs } = await supabase
      .from("moco_documents")
      .select("id, doc_type, identifier, title, status, detail, created_at, send_job_id")
      .order("created_at", { ascending: false })
      .limit(10);
    documents = (docs ?? []).map((d) => ({
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

  return (
    <div className="space-y-6">
      <Link
        href="/app/einstellungen/integrationen"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {de.integrations.backToOverview}
      </Link>
      <MocoCard account={account} documents={documents} />
    </div>
  );
}
