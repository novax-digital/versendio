import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = { title: de.profile.accountTab };

export default async function AccountPage() {
  await requireProfile();
  return (
    <div className="max-w-xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{de.profile.dataExport}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">{de.profile.dataExportHint}</p>
          <Button variant="outline" render={<a href="/app/einstellungen/konto/export" download />}>
            <Download className="size-4" aria-hidden />
            {de.profile.dataExportButton}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive text-base">{de.profile.deleteAccount}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{de.profile.deleteAccountWarning}</p>
          <DeleteAccountForm />
        </CardContent>
      </Card>
    </div>
  );
}
