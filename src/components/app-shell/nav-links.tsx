"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Users,
  History,
  Wallet,
  Settings,
  Shield,
  Menu,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { de } from "@/lib/i18n/de";

type NavIcon = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type NavLeaf = { href: string; label: string; exact: boolean };
type NavItem = NavLeaf & {
  icon: NavIcon;
  /** Route prefixes that keep this parent's section "active" (for the group). */
  children?: NavLeaf[];
};

// Nav items are added per phase as their routes ship — no dead links.
// "Brief versenden" deliberately has no nav entry: the flow starts from a
// letter ("Versenden" in the list) or the dashboard CTA.
const items: NavItem[] = [
  { href: "/app", label: de.nav.dashboard, icon: LayoutDashboard, exact: true },
  { href: "/app/briefe", label: de.nav.letters, icon: FileText, exact: false },
  {
    href: "/app/kontakte",
    label: de.nav.contacts,
    icon: Users,
    exact: false,
    children: [
      { href: "/app/kontakte", label: de.nav.allContacts, exact: true },
      { href: "/app/leadlisten", label: de.nav.leadLists, exact: false },
    ],
  },
  { href: "/app/sendungen", label: de.nav.sendJobs, icon: History, exact: false },
  { href: "/app/guthaben", label: de.nav.credits, icon: Wallet, exact: false },
  { href: "/app/einstellungen", label: de.nav.settings, icon: Settings, exact: false },
];

const adminItem: NavItem = { href: "/admin", label: de.nav.admin, icon: Shield, exact: false };

const linkClass = (active: boolean, child?: boolean) =>
  cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    child && "ml-7 py-1.5 text-[13px]",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
  );

/** A parent nav item with a collapsible list of children (e.g. Kontakte). */
function NavGroup({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const childHrefs = item.children ?? [];
  const sectionActive =
    pathname.startsWith(item.href) || childHrefs.some((c) => pathname.startsWith(c.href));
  // Collapsed by default; auto-open only when the section is currently active.
  const [expanded, setExpanded] = useState(sectionActive);
  const Icon = item.icon;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className={cn(linkClass(sectionActive), "w-full")}
      >
        <Icon className="size-4" aria-hidden />
        {item.label}
        <ChevronDown
          className={cn("ml-auto size-4 transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1">
          {childHrefs.map((c) => {
            const active = c.exact ? pathname === c.href : pathname.startsWith(c.href);
            return (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={linkClass(active, true)}
              >
                <span className="bg-current/40 ml-1 size-1.5 rounded-full" aria-hidden />
                {c.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function LinkList({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const allItems = isAdmin ? [...items, adminItem] : items;

  return (
    <>
      {allItems.map((item) => {
        if (item.children) {
          return <NavGroup key={item.href} item={item} onNavigate={onNavigate} />;
        }
        const { href, label, icon: Icon, exact } = item;
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={linkClass(active)}
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
          <SheetTitle className="flex items-center">
            <Logo className="h-7" />
          </SheetTitle>
        </SheetHeader>
        <nav className="space-y-1 p-2" aria-label={de.admin.navMain}>
          <LinkList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
