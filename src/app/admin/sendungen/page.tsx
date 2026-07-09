import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: de.admin.jobMonitor };

const STATUSES = [
  "pending",
  "on_hold_funds",
  "submitting",
  "submitted",
  "accepted",
  "checked",
  "print_center",
  "sent",
  "failed",
  "canceled",
];

export default async function AdminJobMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("send_job_items")
    .select(
      "id, job_id, user_id, status, vk_cents, error_code, error_message, refunded_at, retried_at, provider_letter_id, created_at, profiles(display_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (status && STATUSES.includes(status)) {
    query = query.eq("status", status);
  }

  const { data: items } = await query;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label={de.admin.filterStatus}>
        <Link
          href="/admin/sendungen"
          className={`rounded-md border px-2 py-1 text-xs ${!status ? "bg-muted font-medium" : ""}`}
        >
          {de.admin.allStatuses}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/sendungen?status=${s}`}
            className={`rounded-md border px-2 py-1 text-xs ${status === s ? "bg-muted font-medium" : ""}`}
          >
            {de.sendJobs.itemStatus[s] ?? s}
          </Link>
        ))}
      </nav>

      {!items || items.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{de.sendJobs.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.admin.users}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Fehler</TableHead>
                <TableHead className="text-right">VK</TableHead>
                <TableHead className="text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const profile = item.profiles as unknown as {
                  display_name: string | null;
                  email: string | null;
                } | null;
                return (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      <Link href={`/admin/nutzer/${item.user_id}`} className="hover:underline">
                        {profile?.display_name ?? profile?.email ?? "–"}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {new Intl.DateTimeFormat("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(item.created_at))}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.status === "failed"
                            ? "destructive"
                            : item.status === "sent"
                              ? "outline"
                              : "secondary"
                        }
                      >
                        {de.sendJobs.itemStatus[item.status] ?? item.status}
                      </Badge>
                      {item.refunded_at ? (
                        <Badge variant="secondary" className="ml-1">
                          {de.sendJobs.refunded}
                        </Badge>
                      ) : null}
                      {item.retried_at ? (
                        <Badge variant="secondary" className="ml-1">
                          {de.admin.alreadyRetried}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-64">
                      {item.error_code ? (
                        <span className="text-destructive text-xs">
                          <span className="font-mono">{item.error_code}</span>
                          {item.error_message ? (
                            <span className="block truncate" title={item.error_message}>
                              {item.error_message}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">–</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(item.vk_cents)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.status === "failed" && !item.retried_at ? (
                        <RetryButton itemId={item.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
