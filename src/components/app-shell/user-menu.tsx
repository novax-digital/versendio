"use client";

import Link from "next/link";
import { LogOut, Wallet } from "lucide-react";
import { logoutAction } from "@/app/(auth)/actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { de } from "@/lib/i18n/de";
import { formatCents } from "@/lib/shared/money";

export function UserMenu({
  displayName,
  balanceCents,
}: {
  displayName: string;
  balanceCents: number;
}) {
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/app/guthaben"
        className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 text-sm transition-colors sm:flex"
        aria-label={`${de.dashboard.creditBalance}: ${formatCents(balanceCents)}`}
      >
        <Wallet className="size-4" aria-hidden />
        {formatCents(balanceCents)}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="rounded-full" aria-label={de.admin.userMenu} />
          }
        >
          <Avatar className="size-8">
            <AvatarFallback>{initials || "?"}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
          <DropdownMenuLabel className="text-muted-foreground flex items-center gap-1.5 pt-0 text-xs font-normal sm:hidden">
            <Wallet className="size-3.5" aria-hidden />
            {formatCents(balanceCents)}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              void logoutAction();
            }}
          >
            <LogOut className="size-4" aria-hidden />
            {de.nav.logout}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
