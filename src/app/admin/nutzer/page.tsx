import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeSearchTerm } from "@/lib/shared/search-term";
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
import { AdminSearch } from "./admin-search";

export const metadata: Metadata = { title: de.admin.users };

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seite?: string }>;
}) {
  await requireAdmin();
  const { q, seite } = await searchParams;
  const page = Math.max(1, Number(seite) || 1);
  const admin = createAdminClient();

  let query = admin
    .from("profiles")
    .select("id, email, display_name, company, role, status, credit_balance_cents, created_at, plans(name)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const term = q ? sanitizeSearchTerm(q) : "";
  if (term) {
    query = query.or(
      `display_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }

  const { data: users, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  const statusBadge = (status: string) =>
    status === "active"
      ? { label: de.admin.statusActive, variant: "outline" as const }
      : status === "blocked"
        ? { label: de.admin.statusBlocked, variant: "destructive" as const }
        : { label: de.admin.statusDeleted, variant: "secondary" as const };

  return (
    <div className="space-y-4">
      <AdminSearch initialValue={q ?? ""} />

      {!users || users.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{de.admin.noUsers}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>E-Mail</TableHead>
                <TableHead>{de.admin.plan}</TableHead>
                <TableHead className="text-right">{de.admin.balance}</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const badge = statusBadge(user.status);
                const plan = user.plans as unknown as { name: string } | null;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/nutzer/${user.id}`} className="hover:underline">
                        {user.display_name ?? "–"}
                      </Link>
                      {user.company ? (
                        <span className="text-muted-foreground block text-xs">{user.company}</span>
                      ) : null}
                      {user.role === "admin" ? (
                        <Badge variant="secondary" className="mt-1">
                          Admin
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.email ?? "–"}
                    </TableCell>
                    <TableCell>{plan?.name ?? "–"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(user.credit_balance_cents)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-center gap-2 text-sm" aria-label="Seiten">
          {page > 1 ? (
            <Link
              className="underline underline-offset-4"
              href={`/admin/nutzer?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page - 1) })}`}
            >
              {de.common.back}
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              className="underline underline-offset-4"
              href={`/admin/nutzer?${new URLSearchParams({ ...(q ? { q } : {}), seite: String(page + 1) })}`}
            >
              {de.common.next}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
