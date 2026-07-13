"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible inspector section. The body is hidden via CSS (never
 * unmounted), so popover/select/local state inside survives collapsing —
 * the same guarantee the old keepMounted tabs gave.
 */
export function InspectorSection({
  id,
  title,
  defaultOpen = false,
  forceOpen,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Bumped counter forces the section open (e.g. sheet chrome-zone click). */
  forceOpen?: number;
  children: React.ReactNode;
}) {
  const storageKey = `versendio.editor.section.${id}`;
  // Server and first client render must agree (hydration) — the stored
  // preference is applied in an effect after mount (one-frame flip accepted).
  const [open, setOpen] = useState<boolean>(defaultOpen);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      // Post-mount sync from an external store (localStorage) is the point
      // of this effect — the setState here is deliberate.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "1") setOpen(true);
      else if (stored === "0") setOpen(false);
    } catch {
      // storage unavailable (blocked cookies/private mode) — keep the default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Force-open on demand ("adjust state during render" pattern — guarded).
  const [prevForce, setPrevForce] = useState(forceOpen ?? 0);
  if ((forceOpen ?? 0) !== prevForce) {
    setPrevForce(forceOpen ?? 0);
    if (!open) setOpen(true);
  }

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // storage unavailable (private mode) — session-only state is fine
    }
  };

  return (
    <section className="border-b pb-3 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="font-heading text-muted-foreground hover:text-foreground flex w-full items-center justify-between py-2 text-[13px] font-medium transition-colors"
      >
        {title}
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div className={cn("space-y-4 pt-1", !open && "hidden")}>{children}</div>
    </section>
  );
}
