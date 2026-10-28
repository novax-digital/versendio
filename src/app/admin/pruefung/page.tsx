import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { flagText, formatBerlin } from "@/lib/server/send/admin-review";
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
import { reviewFlagsSchema, type ReviewFlag } from "@/lib/shared/send-review";
import { de } from "@/lib/i18n/de";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: de.admin.review.title };

export default async function AdminReviewPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const t = de.admin.review;

  // Everything not yet released or stopped that still waits — on the review
  // hold, on a manual release (high warnings) or on a later customer schedule
  // (stoppable until it goes out).
  const now = new Date().toISOString();
  const { data: jobs } = await admin
    .from("send_jobs")
    .select(
      "id, user_id, total_items, total_vk_cents, created_at, scheduled_release_at, review_hold_until, review_manual_required, review_flags, letters(title), profiles(email, display_name, company)",
    )
    .is("review_released_at", null)
    .is("review_stopped_at", null)
    .not("review_hold_until", "is", null)
    .eq("status", "queued")
    .or(
      `review_hold_until.gt.${now},scheduled_release_at.gt.${now},review_manual_required.eq.true`,
    )
    .order("created_at", { ascending: true })
    .limit(200);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="text-muted-foreground text-sm">{t.hint}</p>
      </div>

      {!jobs || jobs.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.received}</TableHead>
                <TableHead>{t.account}</TableHead>
                <TableHead>{t.letter}</TableHead>
                <TableHead className="text-right">{t.recipients}</TableHead>
                <TableHead className="text-right">{t.amount}</TableHead>
                <TableHead>{t.warnings}</TableHead>
                <TableHead>{t.autoRelease}</TableHead>
                <TableHead className="text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const profile = job.profiles as unknown as {
                  email: string | null;
                  display_name: string | null;
                  company: string | null;
                } | null;
                const letter = job.letters as unknown as { title: string } | null;
                const parsedFlags = reviewFlagsSchema.safeParse(job.review_flags);
                const flags: ReviewFlag[] | null = parsedFlags.success ? parsedFlags.data : null;
                const releaseAt = [job.review_hold_until, job.scheduled_release_at]
                  .filter((v): v is string => Boolean(v))
                  .sort()
                  .at(-1);
                return (
                  <TableRow key={job.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {formatBerlin(job.created_at)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link href={`/admin/nutzer/${job.user_id}`} className="hover:underline">
                        {profile?.email ?? profile?.display_name ?? "–"}
                      </Link>
                      <span className="text-muted-foreground block text-xs">
                        {profile?.company?.trim() || "–"}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-48 text-sm">
                      <span className="block truncate" title={letter?.title}>
                        {letter?.title ?? "–"}
                      </span>
                      <a
                        href={`/admin/pruefung/${job.id}/vorschau`}
                        target="_blank"
                        rel="noopener"
                        className="text-primary text-xs hover:underline"
                      >
                        {t.preview}
                      </a>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{job.total_items}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(job.total_vk_cents)}
                    </TableCell>
                    <TableCell className="max-w-80">
                      {flags === null ? (
                        <span className="text-muted-foreground text-xs">…</span>
                      ) : flags.length === 0 ? (
                        <span className="text-muted-foreground text-xs">{t.noWarnings}</span>
                      ) : (
                        <ul className="space-y-1">
                          {flags.map((flag) => (
                            <li key={flag.code}>
                              <Badge
                                variant={flag.level === "high" ? "destructive" : "secondary"}
                                className="h-auto text-left whitespace-normal"
                              >
                                {flagText(flag)}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {job.review_manual_required ? (
                        <Badge variant="destructive">{t.manualOnly}</Badge>
                      ) : releaseAt ? (
                        formatBerlin(releaseAt)
                      ) : (
                        "–"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReviewActions jobId={job.id} />
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
