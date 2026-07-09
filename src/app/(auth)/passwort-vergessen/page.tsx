import type { Metadata } from "next";
import Link from "next/link";
import { de } from "@/lib/i18n/de";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: de.auth.forgotTitle };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{de.auth.forgotTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.auth.forgotSubtitle}</p>
      </div>
      <ForgotPasswordForm />
      <p className="text-muted-foreground text-sm">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          {de.auth.loginNow}
        </Link>
      </p>
    </div>
  );
}
