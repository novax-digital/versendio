import { de } from "@/lib/i18n/de";

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

/** Static REST reference for the Integrations API. */
export function ApiDocs({ baseUrl }: { baseUrl: string }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{de.integrations.docsTitle}</h2>

      <div className="space-y-1.5 text-sm">
        <p className="text-muted-foreground">{de.integrations.docsBaseUrl}</p>
        <Code>{baseUrl}/api/v1</Code>
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
    </section>
  );
}
