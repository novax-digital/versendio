import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { UserActions } from "./user-actions";

export const metadata: Metadata = { title: de.admin.userDetail };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAdmin();
  const { id } = await params;
  const admin = createAdminClient();

  const [{ data: user }, { data: plans }, { data: transactions }, { count: letterCount }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, email, display_name, company, billing_street, billing_zip, billing_city, billing_country, role, status, plan_id, credit_balance_cents, cost_center, is_whitelabel, created_at",
        )
        .eq("id", id)
        .single(),
      admin.from("plans").select("id, name, discount_percent").order("name"),
      admin
        .from("credit_transactions")
        .select("id, type, amount_cents, balance_after_cents, comment, created_by, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("send_job_items")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id)
        .eq("status", "sent"),
    ]);

  if (!user) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            {user.display_name ?? user.email ?? "–"}
            {user.role === "admin" ? <Badge variant="secondary">Admin</Badge> : null}
            <Badge
              variant={
                user.status === "active"
                  ? "outline"
                  : user.status === "blocked"
                    ? "destructive"
                    : "secondary"
              }
            >
              {user.status === "active"
                ? de.admin.statusActive
                : user.status === "blocked"
                  ? de.admin.statusBlocked
                  : de.admin.statusDeleted}
            </Badge>
          </h2>
          <p className="text-muted-foreground text-sm">
            {user.email} · {user.company ?? "–"} · costCenter {user.cost_center}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.admin.balance}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCents(user.credit_balance_cents)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.dashboard.lettersSent}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{letterCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.admin.joined}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(
                new Date(user.created_at),
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <UserActions
        userId={user.id}
        status={user.status}
        planId={user.plan_id}
        plans={plans ?? []}
        isSelf={user.id === actor.id}
        isWhitelabel={user.is_whitelabel ?? false}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.credits.transactionsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {!transactions || transactions.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              {de.credits.transactionsEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{de.credits.date}</TableHead>
                    <TableHead>{de.credits.typeLabel}</TableHead>
                    <TableHead className="text-right">{de.credits.amount}</TableHead>
                    <TableHead className="text-right">{de.credits.balanceAfter}</TableHead>
                    <TableHead>{de.admin.auditActor}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Intl.DateTimeFormat("de-DE", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(tx.created_at))}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tx.amount_cents >= 0 ? "outline" : "secondary"}>
                          {de.credits.txType[tx.type] ?? tx.type}
                        </Badge>
                        {tx.comment ? (
                          <span className="text-muted-foreground block max-w-56 truncate text-xs">
                            {tx.comment}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tx.amount_cents >= 0 ? "+" : ""}
                        {formatCents(tx.amount_cents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(tx.balance_after_cents)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {tx.created_by}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
