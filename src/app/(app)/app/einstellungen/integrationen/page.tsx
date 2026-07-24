import type { Metadata } from "next";
import Link from "next/link";
import { IntegrationLogo } from "./integration-logo";
import { ChevronRight, KeyRound } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.integrations.title };

/** Integrations overview: one tile per integration, details on sub-pages. */
export default async function IntegrationsOverviewPage() {
  const profile = await requireProfile();

  // Connection status probes (service-role tables — safe display fields only).
  const admin = createAdminClient();
  const [{ data: moco }, { data: canva }] = await Promise.all([
    admin.from("moco_accounts").select("status").eq("user_id", profile.id).maybeSingle(),
    admin.from("canva_accounts").select("status").eq("user_id", profile.id).maybeSingle(),
  ]);

  const supabase = await createClient();
  const { count: keyCount } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .is("revoked_at", null);

  const t = de.integrations;
  const mocoBadge = moco
    ? moco.status === "active"
      ? { label: t.mocoConnected, variant: "secondary" as const }
      : { label: t.mocoConnectionErrorBadge, variant: "destructive" as const }
    : { label: t.statusNotConnected, variant: "outline" as const };
  const canvaBadge = canva
    ? canva.status === "active"
      ? { label: t.canvaConnected, variant: "secondary" as const }
      : { label: t.canvaConnectionErrorBadge, variant: "destructive" as const }
    : { label: t.statusNotConnected, variant: "outline" as const };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">{t.overviewSubtitle}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrationTile
          href="/app/einstellungen/integrationen/moco"
          logo={
            <IntegrationLogo src="/integrationen/logo_moco.svg" alt={t.mocoTitle} className="dark:invert" size="lg" />
          }
          hint={t.mocoTileHint}
          badge={mocoBadge}
        />
        <IntegrationTile
          href="/app/einstellungen/integrationen/canva"
          logo={<IntegrationLogo src="/integrationen/logo_canva.svg" alt={t.canvaTitle} size="lg" />}
          hint={t.canvaTileHint}
          badge={canvaBadge}
        />
        {(["zapier", "make", "n8n"] as const).map((tool) => (
          <IntegrationTile
            key={tool}
            href={`/app/einstellungen/integrationen/${tool}`}
            logo={
              <IntegrationLogo
                src={`/integrationen/logo_${tool}.${tool === "make" ? "png" : "svg"}`}
                alt={t.webhookTools[tool].title}
                size="lg"
              />
            }
            hint={t.webhookTools[tool].tileHint}
            badge={{ label: t.viaRestBadge, variant: "outline" as const }}
          />
        ))}
        <IntegrationTile
          href="/app/einstellungen/integrationen/api"
          logo={
            <span className="flex items-center gap-2 font-semibold">
              <KeyRound className="size-5" aria-hidden />
              {t.restApiTitle}
            </span>
          }
          hint={t.restApiTileHint}
          badge={
            (keyCount ?? 0) > 0
              ? { label: t.activeKeysBadge(keyCount ?? 0), variant: "secondary" as const }
              : null
          }
        />
        <IntegrationTile
          href={null}
          logo={<IntegrationLogo src="/integrationen/logo_hubspot.svg" alt={t.hubspotTitle} size="lg" />}
          hint={t.hubspotTileHint}
          badge={{ label: t.comingSoonBadge, variant: "outline" as const }}
        />
      </div>
    </div>
  );
}

function IntegrationTile({
  href,
  logo,
  hint,
  badge,
}: {
  /** null → not yet available: rendered dimmed and non-interactive. */
  href: string | null;
  logo: React.ReactNode;
  hint: string;
  badge: { label: string; variant: "secondary" | "destructive" | "outline" } | null;
}) {
  const body = (
    <Card
      className={
        href ? "hover:border-primary h-full transition-colors" : "h-full opacity-60"
      }
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3">
          {logo}
          {href ? (
            <ChevronRight
              className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
              aria-hidden
            />
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">{hint}</p>
        {badge ? (
          <div className="mt-auto">
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
  if (!href) return <div aria-disabled="true">{body}</div>;
  return (
    <Link href={href} className="group block">
      {body}
    </Link>
  );
}
