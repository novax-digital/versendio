"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Megaphone, X } from "lucide-react";
import { de } from "@/lib/i18n/de";

// Bump this key whenever the offer changes so a new campaign shows again even
// to users who dismissed the previous one.
const STORAGE_KEY = "versendio.launchBannerDismissed.2026-08";

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function isDismissed() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

/**
 * Full-width promo banner pinned to the top of the app content column.
 * Dismissible; the choice is remembered in localStorage. Treated as dismissed
 * during SSR to avoid a flash for users who already closed it.
 */
export function LaunchBanner() {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => true);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    listeners.forEach((cb) => cb());
  }

  return (
    <div className="flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm text-white">
      <Megaphone className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{de.common.launchBannerLabel}</span>{" "}
        <span>{de.common.launchBannerText}</span>{" "}
        <Link href="/app/guthaben" className="font-semibold underline underline-offset-2">
          {de.common.launchBannerCta}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={de.common.launchBannerDismiss}
        className="shrink-0 rounded p-1 transition-colors hover:bg-white/20"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
