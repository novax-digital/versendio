import Link from "next/link";
import { de } from "@/lib/i18n/de";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="bg-primary text-primary-foreground hidden flex-col justify-between p-10 lg:flex">
        <Link href="/" className="flex items-center">
          <Logo onDark className="h-8" />
        </Link>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold text-balance">{de.marketing.heroTitle}</h1>
          <p className="text-primary-foreground/80 max-w-md text-sm">
            {de.marketing.heroSubtitle}
          </p>
        </div>
        <p className="text-primary-foreground/60 text-xs">
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
