import { requireProfile } from "@/lib/server/auth-context";
import { isMockMode } from "@/lib/server/env";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <AppShell profile={profile} mockMode={isMockMode()}>
      {children}
    </AppShell>
  );
}
