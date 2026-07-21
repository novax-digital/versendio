import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/shared/notifications";
import { de } from "@/lib/i18n/de";
import { NotificationsForm } from "./notifications-form";

export const metadata: Metadata = { title: de.notifications.title };

export default async function NotificationsSettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("notify_send_status, notify_epost_updates, notify_topup, notify_flow_activity")
    .eq("id", profile.id)
    .maybeSingle();

  const d = DEFAULT_NOTIFICATION_PREFS;
  return (
    <div className="max-w-xl space-y-6">
      <p className="text-muted-foreground text-sm">{de.notifications.subtitle}</p>
      <NotificationsForm
        defaults={{
          sendStatus: data?.notify_send_status ?? d.notify_send_status,
          epostUpdates: data?.notify_epost_updates ?? d.notify_epost_updates,
          topup: data?.notify_topup ?? d.notify_topup,
          flowActivity: data?.notify_flow_activity ?? d.notify_flow_activity,
        }}
      />
    </div>
  );
}
