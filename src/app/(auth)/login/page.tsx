import type { Metadata } from "next";
import Link from "next/link";
import { de } from "@/lib/i18n/de";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: de.auth.loginTitle };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{de.auth.loginTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.auth.loginSubtitle}</p>
      </div>
      {params.reset === "success" ? (
        <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {de.auth.resetSuccess}
        </p>
      ) : null}
      {params.error === "auth_callback" ? (
        <p className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {de.auth.verifyError}
        </p>
      ) : null}
      <LoginForm />
      <p className="text-muted-foreground text-sm">
        {de.auth.noAccount}{" "}
        <Link href="/registrieren" className="text-foreground underline underline-offset-4">
          {de.auth.registerNow}
        </Link>
      </p>
    </div>
  );
}
