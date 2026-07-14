import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: de.profile.twoFactorLoginTitle };

export default async function MfaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already stepped up (or no factor) → nothing to do here.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal || aal.currentLevel === aal.nextLevel) redirect("/app");

  return <MfaForm />;
}
