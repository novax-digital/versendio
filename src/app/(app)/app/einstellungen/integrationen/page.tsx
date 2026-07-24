import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
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

  // MOCO connection status (service-role table — safe display fields only).
  const admin = createAdminClient();
  const { data: moco } = await admin
    .from("moco_accounts")
    .select("status")
    .eq("user_id", profile.id)
    .maybeSingle();

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

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">{t.overviewSubtitle}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <IntegrationTile
          href="/app/einstellungen/integrationen/moco"
          logo={
            <Image
              src="/integrationen/logo_moco.svg"
              alt={t.mocoTitle}
              width={96}
              height={24}
              className="h-6 w-auto dark:invert"
            />
          }
          hint={t.mocoTileHint}
          badge={mocoBadge}
        />
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
  href: string;
  logo: React.ReactNode;
  hint: string;
  badge: { label: string; variant: "secondary" | "destructive" | "outline" } | null;
}) {
  return (
    <Link href={href} className="group block">
      <Card className="hover:border-primary h-full transition-colors">
        <CardContent className="flex h-full flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            {logo}
            <ChevronRight
              className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
              aria-hidden
            />
          </div>
          <p className="text-muted-foreground text-sm">{hint}</p>
          {badge ? (
            <div className="mt-auto">
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
