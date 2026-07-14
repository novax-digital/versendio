import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
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
import { REVIEW_PLATFORMS, type ReviewPlatform } from "@/lib/shared/review-rewards";
import { de } from "@/lib/i18n/de";
import { ReviewActionButtons } from "./review-actions-buttons";

export const metadata: Metadata = { title: de.admin.reviewRewardsTitle };

type ReviewRow = {
  id: string;
  platform: ReviewPlatform;
  amount_cents: number;
  url: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  profiles: { email: string | null; display_name: string | null } | null;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

function statusBadge(status: ReviewRow["status"]) {
  if (status === "approved")
    return (
      <Badge variant="outline" className="border-success text-success">
        {de.credits.rewardStatusApproved}
      </Badge>
    );
  if (status === "rejected") return <Badge variant="secondary">{de.credits.rewardStatusRejected}</Badge>;
  return (
    <Badge variant="outline" className="border-warning text-warning">
      {de.credits.rewardStatusPending}
    </Badge>
  );
}

export default async function AdminReviewRewardsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data } = await admin
    .from("review_rewards")
    .select(
      "id, platform, amount_cents, url, status, created_at, reviewed_at, profiles(email, display_name)",
    )
    // Pending first (oldest first within pending), then the processed history.
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as ReviewRow[];
  const pending = rows.filter((r) => r.status === "pending");
  const processed = rows.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{de.admin.reviewRewardsTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.admin.reviewRewardsSubtitle}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {de.admin.reviewOpen} ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            {de.admin.reviewNoneOpen}
          </p>
        ) : (
          <ReviewTable rows={pending} withActions />
        )}
      </section>

      {processed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">{de.admin.reviewProcessed}</h2>
          <ReviewTable rows={processed} withActions={false} />
        </section>
      ) : null}
    </div>
  );
}

function ReviewTable({ rows, withActions }: { rows: ReviewRow[]; withActions: boolean }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{de.credits.date}</TableHead>
            <TableHead>{de.credits.colCustomer}</TableHead>
            <TableHead>{de.admin.reviewPlatform}</TableHead>
            <TableHead className="text-right">{de.admin.reviewAmount}</TableHead>
            <TableHead>{de.admin.reviewLink}</TableHead>
            {withActions ? (
              <TableHead className="text-right">{de.admin.reviewAction}</TableHead>
            ) : (
              <TableHead>{de.admin.reviewStatus}</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="whitespace-nowrap">
                {formatDate(withActions ? row.created_at : (row.reviewed_at ?? row.created_at))}
              </TableCell>
              <TableCell className="max-w-56">
                <span className="block truncate">{row.profiles?.email ?? "–"}</span>
                {row.profiles?.display_name ? (
                  <span className="text-muted-foreground block truncate text-xs">
                    {row.profiles.display_name}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {REVIEW_PLATFORMS[row.platform]?.label ?? row.platform}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCents(row.amount_cents)}
              </TableCell>
              <TableCell className="max-w-48">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary inline-flex max-w-full items-center gap-1 text-sm hover:underline"
                >
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{de.admin.reviewOpenLink}</span>
                </a>
              </TableCell>
              {withActions ? (
                <TableCell>
                  <ReviewActionButtons id={row.id} />
                </TableCell>
              ) : (
                <TableCell>{statusBadge(row.status)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
