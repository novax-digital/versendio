import type { Metadata } from "next";
import { de } from "@/lib/i18n/de";
import { ChangePasswordForm } from "./change-password-form";
import { TwoFactorSection } from "./two-factor-section";

export const metadata: Metadata = { title: de.profile.security };

export default function SecuritySettingsPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <h2 className="text-lg font-medium">{de.profile.changePassword}</h2>
        <ChangePasswordForm />
      </div>
      <TwoFactorSection />
    </div>
  );
}
