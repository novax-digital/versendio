import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, Mail, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.dashboard.title };

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: senderAddressCount }, { count: sentCount }, { count: inProgressCount }, { data: recentJobs }] =
    await Promise.all([
      supabase.from("sender_addresses").select("id", { count: "exact", head: true }),
      supabase
        .from("send_job_items")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent"),
      supabase
        .from("send_job_items")
        .select("id", { count: "exact", head: true })
        .in("status", [
          "pending",
          "on_hold_funds",
          "submitting",
          "submitted",
          "accepted",
          "checked",
          "print_center",
        ]),
      supabase
        .from("send_jobs")
        .select("id, status, created_at, letters(title)")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const setupSteps = [
    { label: de.dashboard.setupSenderAddress, done: (senderAddressCount ?? 0) > 0, href: "/app/einstellungen/absenderadressen" },
    { label: de.dashboard.setupCredit, done: profile.credit_balance_cents > 0, href: "/app/guthaben" },
    { label: de.dashboard.setupLetter, done: (sentCount ?? 0) + (inProgressCount ?? 0) > 0, href: "/app" },
  ];
  const showSetup = setupSteps.some((s) => !s.done);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.dashboard.title}</h1>
        <p className="text-muted-foreground text-sm">
          {de.dashboard.welcome}
          {profile.display_name ? `, ${profile.display_name}` : ""}!
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Wallet className="size-4" aria-hidden />
              {de.dashboard.creditBalance}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCents(profile.credit_balance_cents)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" aria-hidden />
              {de.dashboard.lettersSent}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{sentCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" aria-hidden />
              {de.dashboard.lettersInProgress}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{inProgressCount ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {showSetup ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{de.dashboard.setupHints}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {setupSteps.map((step) => (
                <li key={step.label}>
                  <Link
                    href={step.href}
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    {step.done ? (
                      <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                    ) : (
                      <Circle className="text-muted-foreground size-4" aria-hidden />
                    )}
                    <span className={step.done ? "text-muted-foreground line-through" : ""}>
                      {step.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.dashboard.recentJobs}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs && recentJobs.length > 0 ? (
            <ul className="divide-y">
              {recentJobs.map((job) => {
                const letter = job.letters as unknown as { title: string } | null;
                return (
                  <li key={job.id}>
                    <Link
                      href={`/app/sendungen/${job.id}`}
                      className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-2 rounded px-2 py-2 text-sm"
                    >
                      <span className="truncate">{letter?.title ?? "–"}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {de.sendJobs.jobStatus[job.status] ?? job.status}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-muted-foreground py-8 text-center text-sm">
              <p>{de.dashboard.noJobs}</p>
              <p className="mt-1">{de.dashboard.noJobsCta}</p>
              <Button className="mt-3" render={<Link href="/app/versand" />}>
                {de.sendJobs.newSend}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
