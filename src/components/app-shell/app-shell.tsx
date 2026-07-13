import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/brand/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { de } from "@/lib/i18n/de";
import type { Profile } from "@/lib/server/auth-context";
import { NavLinks, MobileNav } from "./nav-links";
import { UserMenu } from "./user-menu";

export function AppShell({
  profile,
  mockMode,
  children,
}: {
  profile: Profile;
  mockMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-60 shrink-0 flex-col border-r md:flex">
        <div className="flex h-16 items-center px-4">
          <Link href="/app" className="flex items-center">
            <Logo className="h-8" />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-2" aria-label={de.admin.navMain}>
          <NavLinks isAdmin={profile.role === "admin"} />
        </nav>
        {mockMode ? (
          <div className="px-4 pb-4">
            <Tooltip>
              <TooltipTrigger
                render={<Badge variant="outline" className="border-warning text-warning" />}
              >
                {de.common.mockBadge}
              </TooltipTrigger>
              <TooltipContent>{de.common.mockBadgeTooltip}</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background flex h-14 items-center justify-between gap-2 border-b px-4">
          <div className="flex items-center gap-2">
            <MobileNav isAdmin={profile.role === "admin"} />
            <Link href="/app" className="flex items-center md:hidden">
              <Logo className="h-6" />
            </Link>
            {mockMode ? (
              <Badge variant="outline" className="border-warning text-warning md:hidden">
                {de.common.mockBadge}
              </Badge>
            ) : null}
          </div>
          <UserMenu
            displayName={profile.display_name ?? profile.email ?? ""}
            balanceCents={profile.credit_balance_cents}
          />
        </header>
        {profile.status === "blocked" ? (
          <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {de.auth.blockedNotice}
          </div>
        ) : null}
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
