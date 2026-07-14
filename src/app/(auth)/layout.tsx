import Link from "next/link";
import { MapPin, Truck, Zap } from "lucide-react";
import { de } from "@/lib/i18n/de";
import { Logo } from "@/components/brand/logo";

const trustBadges = [
  { icon: MapPin, label: de.marketing.trustGermany },
  { icon: Truck, label: de.marketing.trustPost },
  { icon: Zap, label: de.marketing.trustBuilder },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="bg-ink hidden flex-col justify-between p-10 text-white lg:flex">
        <Link href="/" className="flex items-center">
          <Logo onDark className="h-8" />
        </Link>
        <div className="space-y-8">
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold text-balance">{de.marketing.heroTitle}</h1>
            <p className="max-w-md text-sm text-white/80">{de.marketing.heroSubtitle}</p>
          </div>
          <ul className="space-y-3">
            {trustBadges.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="bg-primary/20 text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-white/15">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="text-sm font-medium text-white/90">{label}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/60">
          © {new Date().getFullYear()} {de.common.appName}
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 flex items-center lg:hidden">
            <Logo className="h-7" />
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
