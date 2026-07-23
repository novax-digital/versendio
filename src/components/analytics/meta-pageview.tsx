"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackMetaPageView } from "@/lib/analytics/meta";

/**
 * Fires a Meta Pixel PageView on every CLIENT-SIDE route change (App Router
 * soft navigation). The initial page view is fired by the pixel loader when
 * consent is applied — the first run is skipped so it is never counted twice.
 * Without marketing consent trackMetaPageView is a no-op.
 */
export function MetaPageView() {
  const pathname = usePathname();
  // Seeded with the initial path: only an actual PATH CHANGE fires — immune
  // to StrictMode's dev double-invoke of the mount effect.
  const lastTracked = useRef(pathname);

  useEffect(() => {
    if (lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    trackMetaPageView();
  }, [pathname]);

  return null;
}
