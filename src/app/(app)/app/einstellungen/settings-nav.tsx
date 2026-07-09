"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

const tabs = [
  { href: "/app/einstellungen", label: de.profile.title, exact: true },
  { href: "/app/einstellungen/absenderadressen", label: de.senderAddresses.title, exact: false },
  { href: "/app/einstellungen/sicherheit", label: de.profile.security, exact: false },
];

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b" aria-label={de.admin.settingsNav}>
      <ul className="-mb-px flex gap-4">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
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
