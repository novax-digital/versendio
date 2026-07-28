import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { AvvDialog } from "./avv-form";

export const metadata: Metadata = { title: de.avv.title };

export default async function AvvPage() {
  const profile = await requireProfile();

  // Own-row read; avv_signed_at is not part of the shared profile context.
  const supabase = await createClient();
  const { data: avvState } = await supabase
    .from("profiles")
    .select("avv_signed_at")
    .eq("id", profile.id)
    .maybeSingle();
  const signedAt = avvState?.avv_signed_at ? new Date(avvState.avv_signed_at) : null;

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-muted-foreground text-sm">{de.avv.subtitle}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.avv.viewTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">{de.avv.viewText}</p>
          <ButtonLink href="/avv/AVV_Versendio.pdf" variant="outline" target="_blank">
            {de.avv.viewButton}
          </ButtonLink>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.avv.fillTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {signedAt ? (
            <div className="space-y-2 rounded-md border bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              <p>
                {de.avv.storedInfo(
                  new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(signedAt),
                )}
              </p>
              <ButtonLink href="/app/einstellungen/avv/download" variant="outline" size="sm">
                {de.avv.storedDownload}
              </ButtonLink>
            </div>
          ) : null}
          <AvvDialog
            defaults={{
              company: profile.company ?? "",
              representative: profile.display_name ?? "",
              street: profile.billing_street ?? "",
              zip: profile.billing_zip ?? "",
              city: profile.billing_city ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
