import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { serverEnv } from "@/lib/server/env";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui-ext/button-link";
import { IntegrationLogo } from "./integration-logo";
import { de } from "@/lib/i18n/de";

const t = de.integrations;

export type WebhookToolKey = "zapier" | "make" | "n8n";

const LOGOS: Record<WebhookToolKey, string> = {
  zapier: "/integrationen/logo_zapier.svg",
  make: "/integrationen/logo_make.png",
  n8n: "/integrationen/logo_n8n.svg",
};

/**
 * Shared page body for the no-code tools (Zapier/Make/n8n): they all connect
 * through the same REST API + API key — only copy, module name and example
 * flows differ.
 */
export function WebhookToolPage({ tool }: { tool: WebhookToolKey }) {
  const content = t.webhookTools[tool];
  const base = (serverEnv().APP_URL ?? "https://app.versendio.de").replace(/\/$/, "");

  return (
    <div className="space-y-6">
      <Link
        href="/app/einstellungen/integrationen"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t.backToOverview}
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-base">
            <IntegrationLogo src={LOGOS[tool]} alt={content.title} />
            <Badge variant="outline">{t.viaRestBadge}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground text-sm">{content.intro}</p>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t.webhookHowTitle}</h3>
            <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
              <li>{t.webhookStep1}</li>
              <li>{t.webhookStep2(content.module)}</li>
              <li>{t.webhookStep3}</li>
            </ol>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t.webhookRequestTitle}</h3>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs">
              {`POST ${base}/api/v1/letters/send
Authorization: Bearer <API-Schlüssel>
Content-Type: application/json

{
  "letterId": "<Brief-ID>",
  "recipient": {
    "company": "Muster GmbH",
    "street": "Musterstraße 12",
    "zip": "10115",
    "city": "Berlin"
  },
  "options": { "duplex": true }
}`}
            </pre>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium">{t.webhookExamplesTitle}</h3>
            <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
              {content.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </div>

          <ButtonLink href="/app/einstellungen/integrationen/api" variant="outline">
            {t.webhookDocsCta}
          </ButtonLink>
        </CardContent>
      </Card>
    </div>
  );
}
