"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Gift, X } from "lucide-react";
import { de } from "@/lib/i18n/de";

const STORAGE_KEY = "versendio.freeCreditBannerDismissed";

// A tiny external store over the dismissal flag: reads localStorage on the
// client, treats the banner as dismissed during SSR (avoids a flash), and
// notifies subscribers when dismissed so the component re-renders.
const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function isDismissed() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * Dismissible promo box at the top of the dashboard pointing to the free-credit
 * page. Dismissal is remembered in localStorage so it stays hidden once closed.
 */
export function FreeCreditBanner() {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => true);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    listeners.forEach((cb) => cb());
  }

  return (
    <div className="border-primary/40 bg-primary/10 flex items-start gap-3 rounded-lg border px-4 py-3">
      <Gift className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{de.dashboard.freeCreditBannerTitle}</p>
        <p className="text-muted-foreground mt-0.5 text-sm">
          {de.dashboard.freeCreditBannerText}
        </p>
        <Link
          href="/app/kostenloses-guthaben"
          className="text-primary mt-2 inline-block text-sm font-semibold hover:underline"
        >
          {de.dashboard.freeCreditBannerCta} →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={de.dashboard.freeCreditBannerDismiss}
        className="hover:bg-primary/15 text-muted-foreground -mt-1 -mr-1 shrink-0 rounded p-1.5"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
