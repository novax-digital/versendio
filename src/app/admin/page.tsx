import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/server/auth-context";
import { isMockMode, serverEnv } from "@/lib/server/env";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.nav.admin };

// System status overview — the full console (users, jobs, pricing, audit log)
// ships in Phase 7 per the phase plan.
export default async function AdminPage() {
  // Defense in depth: guard here too, not only in the layout — this page reads
  // with the RLS-bypassing service-role client.
  await requireAdmin();
  const admin = createAdminClient();
  const env = serverEnv();

  const [{ count: userCount }, { count: queueCount }] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("job_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">{de.admin.title}</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.admin.sendMode}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {isMockMode() ? (
              <Badge variant="outline" className="border-amber-500 text-amber-600">
                {de.common.mockBadge} (MockProvider)
              </Badge>
            ) : (
              <Badge variant="outline" className="border-emerald-500 text-emerald-600">
                {de.admin.liveMode}
              </Badge>
            )}
            <p className="text-muted-foreground text-xs">
              {env.MOCK_MODE
                ? de.admin.mockModeSet
                : isMockMode()
                  ? de.admin.mockConfigIncomplete
                  : de.admin.epostConfigured}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.admin.users}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{userCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {de.admin.queueJobs}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{queueCount ?? 0}</p>
          </CardContent>
        </Card>
      </div>
      <p className="text-muted-foreground text-sm">{de.admin.consoleNotice}</p>
    </div>
  );
}
