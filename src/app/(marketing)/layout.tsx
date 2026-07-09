import Link from "next/link";
import { Mail } from "lucide-react";
import { de } from "@/lib/i18n/de";
import { ButtonLink } from "@/components/ui-ext/button-link";

const legalLinks = [
  { href: "/rechtliches/impressum", label: de.legal.imprint },
  { href: "/rechtliches/datenschutz", label: de.legal.privacy },
  { href: "/rechtliches/agb", label: de.legal.terms },
  { href: "/rechtliches/avv", label: de.legal.dpa },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Mail className="size-5" aria-hidden />
            {de.common.appName}
          </Link>
          <nav className="flex items-center gap-2">
            <ButtonLink href="/login" variant="ghost">
              {de.nav.login}
            </ButtonLink>
            <ButtonLink href="/registrieren">{de.nav.register}</ButtonLink>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm">
          <p>
            © {new Date().getFullYear()} {de.common.appName}
          </p>
          <nav className="flex flex-wrap gap-4">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="hover:underline">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
