import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/server/env";
import { de } from "@/lib/i18n/de";
import { ApiKeysManager, type ApiKey } from "../api-keys-manager";
import { ApiDocs } from "../api-docs";

export const metadata: Metadata = { title: de.integrations.restApiTitle };

export default async function RestApiIntegrationPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  // key_hash is intentionally NOT selected — it never leaves the server.
  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, last_used_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  const base = (serverEnv().APP_URL ?? "https://app.versendio.de").replace(/\/$/, "");

  return (
    <div className="space-y-6">
      <Link
        href="/app/einstellungen/integrationen"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {de.integrations.backToOverview}
      </Link>
      <div>
        <h2 className="text-lg font-semibold">{de.integrations.restApiTitle}</h2>
        <p className="text-muted-foreground text-sm">{de.integrations.subtitle}</p>
      </div>
      <ApiKeysManager keys={(keys ?? []) as ApiKey[]} />
      <ApiDocs baseUrl={base} showWhitelabel={profile.is_whitelabel} />
    </div>
  );
}
