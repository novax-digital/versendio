import { requireProfile } from "@/lib/server/auth-context";
import { isMockMode } from "@/lib/server/env";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // requireProfile enforces the 2FA step-up (AAL2) — for pages and actions alike.
  const profile = await requireProfile();
  return (
    <AppShell profile={profile} mockMode={isMockMode()}>
      {children}
    </AppShell>
  );
}
