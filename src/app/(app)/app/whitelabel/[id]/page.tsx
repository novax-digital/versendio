import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { loadWlCustomerUsage } from "@/lib/server/whitelabel/queries";
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

export const metadata: Metadata = { title: de.whitelabel.title };

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  completed: "outline",
  completed_with_errors: "destructive",
  canceled: "secondary",
};

export default async function WlCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (!profile.is_whitelabel) redirect("/app");
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: customer }, { data: jobs }, usage] = await Promise.all([
    supabase
      .from("wl_customers")
      .select("id, name, external_ref, email, notes, is_active, created_at")
      .eq("id", id)
      // Explicit own-scope: RLS widens for admins.
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase
      .from("send_jobs")
      .select("id, status, is_test, total_items, total_vk_cents, created_at, letters(title)")
      .eq("wl_customer_id", id)
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100),
    loadWlCustomerUsage(profile.id, id),
  ]);

  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/app/whitelabel" className="hover:underline">
            {de.whitelabel.title}
          </Link>{" "}
          /
        </p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {customer.name}
          {!customer.is_active ? <Badge variant="secondary">{de.whitelabel.inactive}</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-sm">
          {[
            customer.external_ref
              ? `${de.whitelabel.externalRefShort}: ${customer.external_ref}`
              : null,
            customer.email,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.whitelabel.usageLetters}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {usage.lettersSent}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.whitelabel.usageCost}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {formatCents(usage.costCents)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.whitelabel.usageRefunded}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold tabular-nums">
            {usage.lettersFailedRefunded}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{de.whitelabel.jobsTitle}</h2>
        {(jobs ?? []).length === 0 ? (
          <p className="text-muted-foreground rounded-md border py-10 text-center text-sm">
            {de.whitelabel.jobsEmpty}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{de.credits.date}</TableHead>
                  <TableHead>{de.whitelabel.colLetter}</TableHead>
                  <TableHead>{de.sendJobs.statusLabel}</TableHead>
                  <TableHead className="text-right">{de.sendJobs.itemsTitle}</TableHead>
                  <TableHead className="text-right">{de.sendJobs.totalLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobs ?? []).map((job) => {
                  const letter = job.letters as unknown as { title: string } | null;
                  return (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/app/sendungen/${job.id}`} className="hover:underline">
                          {new Intl.DateTimeFormat("de-DE", {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(job.created_at))}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {letter?.title ?? "–"}
                        {job.is_test ? (
                          <Badge variant="secondary" className="ml-2">
                            {de.sendJobs.testBadge}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[job.status] ?? "default"}>
                          {de.sendJobs.jobStatus[job.status] ?? job.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{job.total_items}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {job.is_test ? "0,00 €" : formatCents(job.total_vk_cents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
