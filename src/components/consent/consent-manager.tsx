"use client";

import { useEffect, useSyncExternalStore } from "react";
import { initConsent, isBannerOpen, subscribeBanner } from "@/lib/analytics/consent";
import { ConsentBanner } from "./consent-banner";

/**
 * App-wide consent controller, mounted once in the root layout. Runs consent
 * init on first mount (applies a stored decision or opens the banner) and
 * renders the banner while the store reports it open. Reopening from the footer
 * "Cookie-Einstellungen" entry flips the same store.
 */
export function ConsentManager() {
  const open = useSyncExternalStore(subscribeBanner, isBannerOpen, () => false);

  useEffect(() => {
    initConsent();
  }, []);

  return open ? <ConsentBanner /> : null;
}
