import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Link2 } from "lucide-react";
import { requireProfile } from "@/lib/server/auth-context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canvaConfigured,
  getValidCanvaAccessToken,
  isCanvaAuthError,
  listCanvaDesigns,
  type CanvaDesign,
} from "@/lib/server/canva/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { de } from "@/lib/i18n/de";
import { CanvaDesignGrid, CanvaDisconnectButton, CanvaStatusToast } from "./canva-designs";

export const metadata: Metadata = { title: de.integrations.canvaTitle };

// The import action (invoked from this page) exports + downloads + validates
// a PDF — give it headroom beyond the default function duration.
export const maxDuration = 60;

const t = de.integrations;

export default async function CanvaIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ verbunden?: string; fehler?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("canva_accounts")
    .select("status")
    .eq("user_id", profile.id)
    .maybeSingle();

  // Load the design list server-side (paginated, up to ~100). Failures
  // degrade: a dead grant shows the reconnect box, a transient hiccup only a
  // retry note — never a false "reconnect" for a working connection.
  const designs: CanvaDesign[] = [];
  let loadFailed = false;
  let needsReconnect = false;
  if (account && canvaConfigured()) {
    try {
      const accessToken = await getValidCanvaAccessToken(profile.id);
      if (accessToken) {
        let continuation: string | null = null;
        for (let page = 0; page < 4; page++) {
          const result = await listCanvaDesigns(accessToken, {
            continuation: continuation ?? undefined,
          });
          designs.push(...result.designs);
          continuation = result.continuation;
          if (!continuation) break;
        }
      }
    } catch (err) {
      if (isCanvaAuthError(err)) needsReconnect = true;
      else {
        loadFailed = true;
        console.error("canva_designs_load_failed", {
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      <CanvaStatusToast
        connected={params.verbunden === "1"}
        errorText={
          params.fehler && Object.hasOwn(t.canvaOauthErrors, params.fehler)
            ? t.canvaOauthErrors[params.fehler]
            : null
        }
      />
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
            <Image
              src="/integrationen/logo_canva.svg"
              alt={t.canvaTitle}
              width={88}
              height={28}
              className="h-6 w-auto"
            />
            {account ? (
              account.status === "active" && !needsReconnect ? (
                <Badge variant="secondary">{t.canvaConnected}</Badge>
              ) : (
                <Badge variant="destructive">{t.canvaConnectionErrorBadge}</Badge>
              )
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-muted-foreground text-sm">{t.canvaHint}</p>

          {!canvaConfigured() ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              {t.canvaNotConfigured}
            </p>
          ) : !account ? (
            /* Plain anchor: the OAuth start is a route handler, not a page. */
            <a
              href="/api/integrations/canva/start"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors"
            >
              <Link2 className="size-4" aria-hidden />
              {t.canvaConnect}
            </a>
          ) : (
            <div className="space-y-5">
              {needsReconnect || account.status !== "active" ? (
                <div className="space-y-3 rounded-md border border-dashed p-4">
                  <p className="text-destructive text-sm">{t.canvaReconnect}</p>
                  <a
                    href="/api/integrations/canva/start"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
                  >
                    <Link2 className="size-4" aria-hidden />
                    {t.canvaConnect}
                  </a>
                </div>
              ) : (
                <p className="text-sm">{t.canvaConnectedNote}</p>
              )}

              <div className="space-y-2">
                <h3 className="text-sm font-medium">{t.canvaDesignsTitle}</h3>
                <p className="text-muted-foreground text-xs">{t.canvaFlowNote}</p>
                <CanvaDesignGrid designs={designs} loadFailed={loadFailed} />
              </div>

              <CanvaDisconnectButton />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
