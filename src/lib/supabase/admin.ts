import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/server/env";

/**
 * Service-role client — bypasses RLS. Server-only; use exclusively for
 * operations the data model deliberately keeps away from client roles
 * (money bookings, queue, provider credentials, admin mutations).
 */
export function createAdminClient() {
  const env = serverEnv();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
