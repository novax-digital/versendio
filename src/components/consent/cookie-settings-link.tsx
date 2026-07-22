"use client";

import { openConsentBanner } from "@/lib/analytics/consent";
import { de } from "@/lib/i18n/de";

/** Footer entry that re-opens the consent banner so a decision can be revoked. */
export function CookieSettingsLink() {
  return (
    <button
      type="button"
      onClick={openConsentBanner}
      className="hover:text-foreground transition-colors hover:underline"
    >
      {de.legal.cookieSettings}
    </button>
  );
}
