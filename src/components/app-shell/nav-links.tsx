"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Users,
  History,
  Workflow,
  Wallet,
  Settings,
  Shield,
  Menu,
  ChevronDown,
  Gift,
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
  {
    href: "/app/briefe",
    label: de.nav.letters,
    icon: FileText,
    exact: false,
    children: [
      { href: "/app/briefe", label: de.nav.allLetters, exact: true },
      { href: "/app/briefe/vorlagen", label: de.nav.templates, exact: false },
    ],
  },
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
  { href: "/app/flows", label: de.nav.flows, icon: Workflow, exact: false },
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
  // Open iff you're in this section; a manual toggle sticks only until the next
  // navigation (it is keyed to the route it was made on), so leaving the section
  // auto-collapses it.
  const [override, setOverride] = useState<{ path: string; open: boolean } | null>(null);
  const expanded = override && override.path === pathname ? override.open : sectionActive;
  const Icon = item.icon;

  return (
    <div>
      {/* Clicking the label navigates to the section's landing page (e.g. "Alle
          Briefe"); the chevron only expands/collapses the children. */}
      <div className={cn(linkClass(sectionActive), "w-full pr-1")}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={pathname === item.href ? "page" : undefined}
          className="-my-2 -ml-3 flex min-w-0 flex-1 items-center gap-3 py-2 pl-3"
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{item.label}</span>
        </Link>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? de.nav.collapseSection : de.nav.expandSection}
          onClick={() => setOverride({ path: pathname, open: !expanded })}
          className="hover:bg-sidebar-accent/60 -my-2 ml-1 shrink-0 rounded p-1.5"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>
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
  const freeCreditActive = pathname.startsWith("/app/kostenloses-guthaben");

  return (
    <>
      <div className="space-y-1">
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
      </div>

      {/* Highlighted promo entry — earn credit via reviews / (soon) referrals.
          Pushed to the bottom of the sidebar with breathing room (no divider)
          and styled bolder than a nav item so it doesn't drown. */}
      <div className="mt-auto pt-4 pb-3">
        <Link
          href="/app/kostenloses-guthaben"
          onClick={onNavigate}
          aria-current={freeCreditActive ? "page" : undefined}
          className={cn(
            "border-primary/40 text-primary hover:bg-primary/15 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors",
            freeCreditActive ? "bg-primary/15" : "bg-primary/10",
          )}
        >
          <Gift className="size-4.5" aria-hidden />
          {de.nav.freeCredit}
        </Link>
      </div>
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
        <nav className="flex flex-1 flex-col overflow-y-auto p-2" aria-label={de.admin.navMain}>
          <LinkList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
