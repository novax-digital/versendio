import { CopyButton } from "@/components/ui-ext/copy-button";
import { de } from "@/lib/i18n/de";

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="bg-muted overflow-x-auto rounded-md p-3 pr-10 font-mono text-xs leading-relaxed">
        {children}
      </pre>
      <CopyButton value={children} className="absolute top-1 right-1" />
    </div>
  );
}

/** Static REST reference for the Integrations API. */
export function ApiDocs({
  baseUrl,
  showWhitelabel = false,
}: {
  baseUrl: string;
  showWhitelabel?: boolean;
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{de.integrations.docsTitle}</h2>

      <div className="space-y-1.5 text-sm">
        <p className="text-muted-foreground">{de.integrations.docsBaseUrl}</p>
        <Code>{`${baseUrl}/api/v1`}</Code>
        <p className="text-muted-foreground">{de.integrations.docsAuthHeader}</p>
        <Code>Authorization: Bearer vk_live_…</Code>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{de.integrations.docsContactsCreate}</h3>
        <Code>{`curl -X POST ${baseUrl}/api/v1/contacts \\
  -H "Authorization: Bearer vk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "salutation": "Frau",
    "firstName": "Erika",
    "lastName": "Mustermann",
    "company": "Muster GmbH",
    "street": "Musterstraße 12",
    "zip": "10115",
    "city": "Berlin",
    "country": "DE",
    "email": "erika@muster.de"
  }'`}</Code>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{de.integrations.docsContactsList}</h3>
        <Code>{`curl "${baseUrl}/api/v1/contacts?limit=50&offset=0" \\
  -H "Authorization: Bearer vk_live_…"`}</Code>
      </div>

      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">{de.integrations.docsLetterSend}</h3>
        <Code>{`curl -X POST ${baseUrl}/api/v1/letters/send \\
  -H "Authorization: Bearer vk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "letterId": "<UUID des versandbereiten Briefs>",
    "recipient": { "contactId": "<UUID>" },
    "options": { "color": false, "duplex": false, "registered": "none" },
    "test": true,
    "idempotencyKey": "<optional, UUID>"
  }'`}</Code>
        <p className="text-muted-foreground text-xs">{de.integrations.docsSendNote}</p>
      </div>

      {showWhitelabel ? (
        <>
          <h2 className="pt-2 text-lg font-medium">{de.integrations.docsWlTitle}</h2>
          <p className="text-muted-foreground text-sm">{de.integrations.docsWlIntro}</p>

          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{de.integrations.docsWlCreate}</h3>
            <Code>{`curl -X POST ${baseUrl}/api/v1/customers \\
  -H "Authorization: Bearer vk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Beispiel GmbH",
    "externalRef": "KUNDE-1001",
    "email": "kontakt@beispiel.de"
  }'`}</Code>
            <p className="text-muted-foreground text-xs">{de.integrations.docsWlCreateNote}</p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{de.integrations.docsWlList}</h3>
            <Code>{`curl "${baseUrl}/api/v1/customers?limit=50&offset=0" \\
  -H "Authorization: Bearer vk_live_…"`}</Code>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{de.integrations.docsWlSend}</h3>
            <Code>{`curl -X POST ${baseUrl}/api/v1/letters/send \\
  -H "Authorization: Bearer vk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "letterId": "<UUID>",
    "recipient": { "contactId": "<UUID>" },
    "customerId": "<UUID des Endkunden>",
    "test": true
  }'`}</Code>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-sm font-medium">{de.integrations.docsWlUsage}</h3>
            <Code>{`curl "${baseUrl}/api/v1/customers/<UUID>/usage?from=2026-07-01&to=2026-08-01" \\
  -H "Authorization: Bearer vk_live_…"`}</Code>
            <p className="text-muted-foreground text-xs">{de.integrations.docsWlUsageNote}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}
