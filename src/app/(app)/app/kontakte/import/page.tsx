import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { loadActiveFlows } from "@/lib/server/flows/active-flows";
import { de } from "@/lib/i18n/de";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: de.contacts.importTitle };

export default async function ImportPage() {
  const profile = await requireProfile();
  const activeFlows = await loadActiveFlows(profile.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{de.contacts.importTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.contacts.importSubtitle}</p>
      </div>
      <ImportWizard activeFlows={activeFlows} />
    </div>
  );
}
