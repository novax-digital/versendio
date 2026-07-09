import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isMockMode } from "@/lib/server/env";
import { stripeEnabled } from "@/lib/server/stripe";
import { serverEnv } from "@/lib/server/env";
import { de } from "@/lib/i18n/de";
import { SettingsList, type Setting } from "./settings-list";

export const metadata: Metadata = { title: de.admin.settingsTitle };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const admin = createAdminClient();
  const env = serverEnv();
  const { data: settings } = await admin.from("app_settings").select("key, value").order("key");

  const flags = [
    { label: "MOCK_MODE", value: env.MOCK_MODE, effective: isMockMode() },
    { label: "FEATURE_STRIPE", value: env.FEATURE_STRIPE, effective: stripeEnabled() },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature-Flags (ENV)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {flags.map((flag) => (
            <div key={flag.label} className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground w-40 font-mono text-xs">{flag.label}</span>
              <Badge variant={flag.value ? "outline" : "secondary"}>
                {flag.value ? "true" : "false"}
              </Badge>
              {flag.value !== flag.effective ? (
                <span className="text-xs text-amber-600">
                  effektiv: {String(flag.effective)} (Konfiguration unvollständig)
                </span>
              ) : null}
            </div>
          ))}
          <p className="text-muted-foreground pt-2 text-xs">
            Feature-Flags werden über Umgebungsvariablen gesteuert und sind hier nur einsehbar.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.admin.settingsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-sm">{de.admin.settingsHint}</p>
          <SettingsList settings={(settings ?? []) as Setting[]} />
        </CardContent>
      </Card>
    </div>
  );
}
