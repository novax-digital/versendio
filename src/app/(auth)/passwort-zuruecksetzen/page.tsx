import type { Metadata } from "next";
import { de } from "@/lib/i18n/de";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: de.auth.resetTitle };

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{de.auth.resetTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.auth.resetSubtitle}</p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
