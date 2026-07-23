"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fireTopupConversion } from "@/lib/analytics/gtag";
import { fireMetaPurchase } from "@/lib/analytics/meta";
import { de } from "@/lib/i18n/de";

/** Surfaces the Stripe redirect outcome once (query params from success/cancel URLs). */
export function StatusToast({
  status,
  setup,
  topup,
}: {
  status: string | null;
  setup: string | null;
  /** Present on a successful topup return — drives the Ads conversion. */
  topup: { valueCents: number; currency: string; transactionId: string; email?: string } | null;
}) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (status === "erfolgreich") toast.success(de.credits.topupSuccess);
    if (status === "abgebrochen") toast.info(de.credits.topupCanceled);
    if (setup === "erfolgreich") toast.success(de.credits.setupSuccess);
    if (setup === "abgebrochen") toast.info(de.credits.setupCanceled);

    if (status === "erfolgreich" && topup) {
      fireTopupConversion({
        transactionId: topup.transactionId,
        value: topup.valueCents / 100,
        currency: topup.currency,
        email: topup.email,
      });
      fireMetaPurchase({
        transactionId: topup.transactionId,
        value: topup.valueCents / 100,
        currency: topup.currency,
      });
    }

    // Strip the Stripe return params once handled: a reload or bookmark of
    // the success URL must not re-trigger toasts or conversion events.
    if ((status || setup) && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [status, setup, topup]);
  return null;
}
