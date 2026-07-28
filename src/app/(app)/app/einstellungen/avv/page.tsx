import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { AvvForm } from "./avv-form";

export const metadata: Metadata = { title: de.avv.title };

export default async function AvvPage() {
  const profile = await requireProfile();

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
        <CardContent>
          <AvvForm
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
