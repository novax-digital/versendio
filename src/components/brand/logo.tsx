import Image from "next/image";
import { de } from "@/lib/i18n/de";
import { cn } from "@/lib/utils";

// Intrinsic size of public/versendio-logo*.svg — rendered size comes from className.
const WIDTH = 440;
const HEIGHT = 100;

/**
 * Versendio wordmark. Follows the color scheme by default (light logo in dark
 * mode); set `onDark` when the logo sits on a permanently dark surface such as
 * the auth hero panel.
 */
export function Logo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  if (onDark) {
    return (
      <Image
        src="/brand/versendio-logo-dark.svg"
        alt={de.common.appName}
        width={WIDTH}
        height={HEIGHT}
        className={cn("h-6 w-auto", className)}
      />
    );
  }
  return (
    <>
      <Image
        src="/brand/versendio-logo.svg"
        alt={de.common.appName}
        width={WIDTH}
        height={HEIGHT}
        className={cn("h-6 w-auto dark:hidden", className)}
      />
      <Image
        src="/brand/versendio-logo-dark.svg"
        alt={de.common.appName}
        width={WIDTH}
        height={HEIGHT}
        className={cn("hidden h-6 w-auto dark:block", className)}
      />
    </>
  );
}
