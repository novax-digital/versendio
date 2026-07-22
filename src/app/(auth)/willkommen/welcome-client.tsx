"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { fireRegistrationConversion } from "@/lib/analytics/gtag";
import { de } from "@/lib/i18n/de";

/**
 * Post-signup success page. Fires the Google Ads "Registrierung" conversion
 * once (guarded by the sessionStorage flag armed during signup) and shows the
 * confirm-your-e-mail message. Landing here without an armed flag simply shows
 * the message and tracks nothing.
 */
export function WelcomeClient() {
  useEffect(() => fireRegistrationConversion(), []);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <span className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-full">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold">{de.auth.welcomeHeading}</h1>
      </div>
      <p
        role="status"
        className="rounded-md bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      >
        {de.auth.registerSuccess}
      </p>
      <Link
        href="/login"
        className="text-primary block text-center text-sm font-medium hover:underline"
      >
        {de.auth.loginNow}
      </Link>
    </div>
  );
}
