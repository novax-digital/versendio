"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

const tabs = [
  { href: "/admin", label: de.admin.dashboard, exact: true },
  { href: "/admin/nutzer", label: de.admin.users, exact: false },
  { href: "/admin/sendungen", label: de.admin.jobMonitor, exact: false },
  { href: "/admin/aufladungen", label: de.credits.topupsTitle, exact: false },
  { href: "/admin/preise", label: de.admin.pricingTitle, exact: false },
  { href: "/admin/einstellungen", label: de.admin.settingsTitle, exact: false },
  { href: "/admin/audit", label: de.admin.auditTitle, exact: false },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="overflow-x-auto border-b" aria-label={de.admin.title}>
      <ul className="-mb-px flex gap-4">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-1 pb-2 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
