import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.admin.auditTitle };

const ACTION_LABELS: Record<string, string> = {
  credit_adjust: "Guthaben gebucht",
  user_block: "Nutzer gesperrt",
  user_unblock: "Sperre aufgehoben",
  user_plan_change: "Preisstufe geändert",
  user_password_reset: "Passwort-Reset ausgelöst",
  pricing_update: "Preis geändert",
  setting_update: "Einstellung geändert",
  item_retry: "Brief erneut versendet",
  ledger_integrity_alert: "Ledger-Abweichung erkannt",
};

export default async function AdminAuditPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data: entries } = await admin
    .from("audit_log")
    .select("id, actor_user_id, action, target_type, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-4">
      {!entries || entries.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{de.admin.auditEmpty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.credits.date}</TableHead>
                <TableHead>{de.admin.auditAction}</TableHead>
                <TableHead>{de.admin.auditTarget}</TableHead>
                <TableHead>{de.admin.auditActor}</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {new Intl.DateTimeFormat("de-DE", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    }).format(new Date(entry.created_at))}
                  </TableCell>
                  <TableCell className="text-sm font-medium">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {entry.target_type === "user" && entry.target_id ? (
                      <Link href={`/admin/nutzer/${entry.target_id}`} className="hover:underline">
                        {entry.target_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      `${entry.target_type ?? "–"} ${entry.target_id?.slice(0, 12) ?? ""}`
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {entry.actor_user_id ? `${entry.actor_user_id.slice(0, 8)}…` : "system"}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-64 truncate font-mono text-xs">
                    {entry.details ? JSON.stringify(entry.details) : "–"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
