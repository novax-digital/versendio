"use client";

import { useState } from "react";
import { Cookie, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { denyConsent, grantConsent, closeConsentBanner } from "@/lib/analytics/consent";

// TODO(legal): Diese Texte juristisch prüfen lassen (DSGVO/TTDSG,
// Einwilligungsformulierung, Zweckbeschreibung) bevor produktiv geschaltet.
const TEXTS = {
  title: "Cookie-Einstellungen",
  body: "Wir verwenden Cookies, um Ihnen die bestmögliche Erfahrung zu bieten. Einige Cookies sind für den Betrieb der Website notwendig, während andere uns helfen, die Website zu verbessern.",
  onlyNecessary: "Nur notwendige",
  settings: "Einstellungen",
  acceptAll: "Alle akzeptieren",
  save: "Auswahl speichern",
  moreInfoPrefix: "Mehr erfahren Sie in unserer",
  privacyLabel: "Datenschutzerklärung",
  privacyHref: "https://versendio.de/datenschutz",
  close: "Schließen",
  necessaryTitle: "Notwendig",
  necessaryAlways: "Immer aktiv",
  necessaryDesc: "Für den Betrieb der Anwendung erforderlich (z. B. Anmeldung). Nicht abwählbar.",
  marketingTitle: "Marketing",
  marketingDesc: "Hilft uns, den Erfolg unserer Werbung zu messen (Google Ads).",
} as const;

const KURIERBLAU = "#2C4BE8";

/**
 * Consent banner as a floating card (no blocking backdrop — the app stays fully
 * usable). "Einstellungen" reveals the single optional category (Marketing);
 * necessary cookies are always on. Only the marketing choice maps to Google
 * Consent Mode.
 */
export function ConsentBanner() {
  const [showSettings, setShowSettings] = useState(false);
  const [marketing, setMarketing] = useState(false);

  const acceptAll = () => {
    grantConsent();
    closeConsentBanner();
  };
  const onlyNecessary = () => {
    denyConsent();
    closeConsentBanner();
  };
  const saveSelection = () => {
    if (marketing) grantConsent();
    else denyConsent();
    closeConsentBanner();
  };

  return (
    // pointer-events-none on the wrapper is load-bearing: its transparent
    // padding ring sits at z-[100] over the page — on small mobile viewports
    // the SSO buttons on /login end up exactly under that invisible band and
    // taps silently died there. Only the visible card may catch input.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex justify-center p-4">
      <div
        role="dialog"
        aria-modal="false"
        aria-label={TEXTS.title}
        className="bg-card pointer-events-auto relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border p-5 shadow-2xl sm:p-6"
      >
        <button
          type="button"
          onClick={onlyNecessary}
          aria-label={TEXTS.close}
          className="text-muted-foreground hover:bg-muted absolute right-3 top-3 rounded-md p-1.5"
        >
          <X className="size-4" aria-hidden />
        </button>

        <div className="flex gap-4">
          <span className="bg-muted text-foreground/70 flex size-11 shrink-0 items-center justify-center rounded-xl">
            <Cookie className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 space-y-1 pr-6">
            <h2 className="font-heading text-base font-semibold">{TEXTS.title}</h2>
            <p className="text-muted-foreground text-sm">{TEXTS.body}</p>
          </div>
        </div>

        {showSettings ? (
          <div className="mt-4 space-y-3 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{TEXTS.necessaryTitle}</p>
                <p className="text-muted-foreground text-xs">{TEXTS.necessaryDesc}</p>
              </div>
              <span className="text-muted-foreground shrink-0 text-xs font-medium">
                {TEXTS.necessaryAlways}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4 border-t pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{TEXTS.marketingTitle}</p>
                <p className="text-muted-foreground text-xs">{TEXTS.marketingDesc}</p>
              </div>
              <Switch
                checked={marketing}
                onCheckedChange={setMarketing}
                aria-label={TEXTS.marketingTitle}
              />
            </div>
          </div>
        ) : null}

        {/* Equal-size buttons; every choice is one click away. */}
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onlyNecessary}
            className="hover:bg-muted h-10 rounded-lg border text-sm font-medium transition-colors"
          >
            {TEXTS.onlyNecessary}
          </button>
          {showSettings ? (
            <button
              type="button"
              onClick={saveSelection}
              className="hover:bg-muted h-10 rounded-lg border text-sm font-medium transition-colors"
            >
              {TEXTS.save}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="hover:bg-muted h-10 rounded-lg border text-sm font-medium transition-colors"
            >
              {TEXTS.settings}
            </button>
          )}
          <button
            type="button"
            onClick={acceptAll}
            className="h-10 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: KURIERBLAU }}
          >
            {TEXTS.acceptAll}
          </button>
        </div>

        <p className="text-muted-foreground mt-4 text-center text-xs">
          {TEXTS.moreInfoPrefix}{" "}
          <a
            href={TEXTS.privacyHref}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
            style={{ color: KURIERBLAU }}
          >
            {TEXTS.privacyLabel}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
