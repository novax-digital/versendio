import type { Metadata } from "next";
import Link from "next/link";
import { de } from "@/lib/i18n/de";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: de.auth.registerTitle };

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{de.auth.registerTitle}</h1>
        <p className="text-muted-foreground text-sm">{de.auth.registerSubtitle}</p>
      </div>
      <RegisterForm />
      <p className="text-muted-foreground text-sm">
        {de.auth.hasAccount}{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          {de.auth.loginNow}
        </Link>
      </p>
    </div>
  );
}
