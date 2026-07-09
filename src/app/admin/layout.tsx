import { requireAdmin } from "@/lib/server/auth-context";
import { isMockMode } from "@/lib/server/env";
import { AppShell } from "@/components/app-shell/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Server-side guard on top of RLS (defense in depth, MASTERPROMPT §6.7).
  const profile = await requireAdmin();
  return (
    <AppShell profile={profile} mockMode={isMockMode()}>
      {children}
    </AppShell>
  );
}
