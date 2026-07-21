import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { JobItems } from "./job-items";
import { CancelJobButton } from "./cancel-job-button";
import { ButtonLink } from "@/components/ui-ext/button-link";

export const metadata: Metadata = { title: de.sendJobs.title };

export default async function SendJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: job }, { data: items }] = await Promise.all([
    supabase
      .from("send_jobs")
      .select(
        "id, letter_id, status, is_test, is_color, is_duplex, registered, total_items, total_vk_cents, scheduled_release_at, created_at, completed_at, letters(title)",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("send_job_items")
      .select(
        "id, status, recipient_snapshot, vk_cents, sheet_count, error_message, refunded_at, frankier_id, provider_letter_id",
      )
      .eq("job_id", id)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (!job) notFound();

  const letter = job.letters as unknown as { title: string } | null;
  const cancellable =
    !["completed", "completed_with_errors", "canceled"].includes(job.status) &&
    (items ?? []).some((i) => ["pending", "on_hold_funds"].includes(i.status));
  const hasFailures = (items ?? []).some((i) => i.status === "failed");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {letter?.title ?? de.sendJobs.title}
            {job.is_test ? <Badge variant="secondary">{de.sendJobs.testBadge}</Badge> : null}
          </h1>
          <p className="text-muted-foreground text-sm">
            {de.sendJobs.createdLabel}:{" "}
            {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(job.created_at),
            )}
          </p>
        </div>
        {cancellable ? <CancelJobButton jobId={job.id} /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.sendJobs.statusLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{de.sendJobs.jobStatus[job.status] ?? job.status}</Badge>
            {job.scheduled_release_at && job.status === "queued" ? (
              <p className="text-muted-foreground mt-2 text-xs">
                {de.sendJobs.scheduledFor}:{" "}
                {new Intl.DateTimeFormat("de-DE", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(job.scheduled_release_at))}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.sendJobs.itemsTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{job.total_items}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.sendJobs.totalLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {job.is_test ? "0,00 €" : formatCents(job.total_vk_cents)}
            </p>
          </CardContent>
        </Card>
      </div>

      {hasFailures ? (
        <div className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p>{de.sendJobs.retryInfo}</p>
          {job.letter_id ? (
            <ButtonLink href={`/app/versand?brief=${job.letter_id}`} variant="outline"
              size="sm">
              {de.letters.sendLetter}
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      <JobItems items={items ?? []} jobId={job.id} />
    </div>
  );
}
