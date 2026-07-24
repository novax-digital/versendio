import type { Metadata } from "next";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { WebhookToolPage } from "../webhook-tool-page";

export const metadata: Metadata = { title: de.integrations.webhookTools.n8n.title };

export default async function N8nIntegrationPage() {
  await requireProfile();
  return <WebhookToolPage tool="n8n" />;
}
