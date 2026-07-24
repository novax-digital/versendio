import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/server/queue/enqueue";

/**
 * Enqueues the welcome mail exactly once, at first confirmation. The
 * conditional update makes it idempotent across repeated confirmation hits
 * (recovery links, replays) — shared by the PKCE callback and the
 * token-hash confirm route.
 */
export async function enqueueWelcomeOnce(userId: string | undefined): Promise<void> {
  if (!userId) return;
  const admin = createAdminClient();
  const { data: flagged } = await admin
    .from("profiles")
    .update({ welcome_sent_at: new Date().toISOString() })
    .eq("id", userId)
    .is("welcome_sent_at", null)
    .select("id")
    .maybeSingle();
  if (flagged) {
    await enqueueJob("send_email", { template: "welcome", userId }).catch(() => {});
  }
}
