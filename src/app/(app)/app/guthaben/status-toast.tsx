"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { de } from "@/lib/i18n/de";

/** Surfaces the Stripe redirect outcome once (query params from success/cancel URLs). */
export function StatusToast({ status, setup }: { status: string | null; setup: string | null }) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    if (status === "erfolgreich") toast.success(de.credits.topupSuccess);
    if (status === "abgebrochen") toast.info(de.credits.topupCanceled);
    if (setup === "erfolgreich") toast.success(de.credits.setupSuccess);
    if (setup === "abgebrochen") toast.info(de.credits.setupCanceled);
  }, [status, setup]);
  return null;
}
