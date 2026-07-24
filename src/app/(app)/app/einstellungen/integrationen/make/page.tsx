import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { WebhookToolPage } from "../webhook-tool-page";

export const metadata: Metadata = { title: de.integrations.webhookTools.make.title };

export default async function MakeIntegrationPage() {
  await requireProfile();
  return <WebhookToolPage tool="make" />;
}
