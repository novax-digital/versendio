import { requireAdmin } from "@/lib/server/auth-context";
import { isMockMode } from "@/lib/server/env";
import { AppShell } from "@/components/app-shell/app-shell";
import { AdminNav } from "./admin-nav";
import { de } from "@/lib/i18n/de";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Server-side guard on top of RLS (defense in depth, MASTERPROMPT §6.7).
  // Every admin page additionally calls requireAdmin() itself.
  const profile = await requireAdmin();
  return (
    <AppShell profile={profile} mockMode={isMockMode()}>
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold">{de.admin.title}</h1>
        <AdminNav />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
