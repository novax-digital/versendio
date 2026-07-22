"use client";

import { denyConsent, grantConsent, closeConsentBanner } from "@/lib/analytics/consent";

// TODO(legal): Diese Texte juristisch prüfen lassen (DSGVO/TTDSG,
// Einwilligungsformulierung, Zweckbeschreibung) bevor produktiv geschaltet.
const TEXTS = {
  title: "Wir respektieren Ihre Privatsphäre",
  body: "Wir verwenden Cookies für Marketing- und Conversion-Messung (Google Ads), um den Erfolg unserer Werbung zu verstehen. Diese Cookies werden nur mit Ihrer Einwilligung gesetzt. Notwendige Funktionen der Anwendung bleiben davon unberührt und funktionieren in jedem Fall.",
  accept: "Akzeptieren",
  decline: "Ablehnen",
  privacyLabel: "Datenschutzerklärung",
  privacyHref: "https://versendio.de/datenschutz",
} as const;

const KURIERBLAU = "#2C4BE8";

/**
 * Consent banner — fixed bottom bar, never a cookie wall: the app stays fully
 * usable behind it. Two equally-weighted buttons (no dark pattern). Rendered
 * only while the consent store reports the banner open.
 */
export function ConsentBanner() {
  const accept = () => {
    grantConsent();
    closeConsentBanner();
  };
  const decline = () => {
    denyConsent();
    closeConsentBanner();
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={TEXTS.title}
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-black/10 bg-white p-4 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-neutral-900 sm:p-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-heading text-sm font-semibold text-neutral-900 dark:text-white">
            {TEXTS.title}
          </p>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            {TEXTS.body}{" "}
            <a
              href={TEXTS.privacyHref}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
              style={{ color: KURIERBLAU }}
            >
              {TEXTS.privacyLabel}
            </a>
          </p>
        </div>
        {/* Two equivalent choices, same size — accept filled, decline outlined
            in the same brand blue so neither is visually favored. */}
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={decline}
            className="h-10 min-w-28 rounded-md border text-sm font-semibold transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.06]"
            style={{ borderColor: KURIERBLAU, color: KURIERBLAU }}
          >
            {TEXTS.decline}
          </button>
          <button
            type="button"
            onClick={accept}
            className="h-10 min-w-28 rounded-md border text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: KURIERBLAU, borderColor: KURIERBLAU }}
          >
            {TEXTS.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
