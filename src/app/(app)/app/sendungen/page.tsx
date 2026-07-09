import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";
import { ButtonLink } from "@/components/ui-ext/button-link";

export const metadata: Metadata = { title: de.sendJobs.title };

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  completed: "outline",
  completed_with_errors: "destructive",
  canceled: "secondary",
};

export default async function SendJobsPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("send_jobs")
    .select(
      "id, status, is_test, total_items, total_vk_cents, scheduled_release_at, created_at, letters(title)",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{de.sendJobs.title}</h1>
          <p className="text-muted-foreground text-sm">{de.sendJobs.subtitle}</p>
        </div>
        <ButtonLink href="/app/versand">
          <Send className="size-4" aria-hidden />
          {de.sendJobs.newSend}
        </ButtonLink>
      </div>

      {!jobs || jobs.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-sm">
            <Send className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.sendJobs.empty}</p>
            <p>{de.sendJobs.emptyCta}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="divide-y rounded-md border">
          {jobs.map((job) => {
            const letter = job.letters as unknown as { title: string } | null;
            return (
              <li key={job.id}>
                <Link
                  href={`/app/sendungen/${job.id}`}
                  className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {letter?.title ?? "–"}
                      {job.is_test ? (
                        <Badge variant="secondary" className="ml-2">
                          {de.sendJobs.testBadge}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {new Intl.DateTimeFormat("de-DE", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(job.created_at))}
                      {" · "}
                      {job.total_items} {de.sendJobs.itemsTitle}
                      {!job.is_test ? ` · ${formatCents(job.total_vk_cents)}` : ""}
                    </p>
                  </div>
                  <Badge variant={statusVariant[job.status] ?? "default"}>
                    {de.sendJobs.jobStatus[job.status] ?? job.status}
                  </Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
