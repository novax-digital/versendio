import { SettingsNav } from "./settings-nav";
import { de } from "@/lib/i18n/de";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">{de.nav.settings}</h1>
      <SettingsNav />
      <div>{children}</div>
    </div>
  );
}
