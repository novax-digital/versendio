"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Users,
  ListChecks,
  Send,
  History,
  Wallet,
  Settings,
  Shield,
  Menu,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

// Nav items are added per phase as their routes ship — no dead links.
const items = [
  { href: "/app", label: de.nav.dashboard, icon: LayoutDashboard, exact: true },
  { href: "/app/briefe", label: de.nav.letters, icon: FileText, exact: false },
  { href: "/app/kontakte", label: de.nav.contacts, icon: Users, exact: false },
  { href: "/app/leadlisten", label: de.nav.leadLists, icon: ListChecks, exact: false },
  { href: "/app/versand", label: de.send.title, icon: Send, exact: false },
  { href: "/app/sendungen", label: de.nav.sendJobs, icon: History, exact: false },
  { href: "/app/guthaben", label: de.nav.credits, icon: Wallet, exact: false },
  { href: "/app/einstellungen", label: de.nav.settings, icon: Settings, exact: false },
];

const adminItem = { href: "/admin", label: de.nav.admin, icon: Shield, exact: false };

function LinkList({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allItems = isAdmin ? [...items, adminItem] : items;

  return (
    <>
      {allItems.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  return <LinkList isAdmin={isAdmin} />;
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={de.admin.openMenu} />
        }
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Mail className="size-5" aria-hidden />
            {de.common.appName}
          </SheetTitle>
        </SheetHeader>
        <nav className="space-y-1 p-2" aria-label={de.admin.navMain}>
          <LinkList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
