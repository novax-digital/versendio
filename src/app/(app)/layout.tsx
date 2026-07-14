import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/server/auth-context";
import { createClient } from "@/lib/supabase/server";
import { isMockMode } from "@/lib/server/env";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  // Optional 2FA: once a user has a verified TOTP factor, the app requires the
  // session to be stepped up to AAL2. currentLevel aal1 + nextLevel aal2 means
  // "enrolled but not yet verified this session" → send to the code step.
  const supabase = await createClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2") {
    redirect("/mfa");
  }

  return (
    <AppShell profile={profile} mockMode={isMockMode()}>
      {children}
    </AppShell>
  );
}
