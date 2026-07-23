"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { de } from "@/lib/i18n/de";

/**
 * App-wide error boundary: replaces Next's default English server-error page
 * with a German one and a retry that re-renders the segment in place.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("app_error_boundary", { digest: error.digest });
  }, [error]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="text-muted-foreground size-8" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{de.common.errorPageTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.common.genericError}</p>
      </div>
      <Button onClick={reset}>{de.common.retry}</Button>
    </main>
  );
}
