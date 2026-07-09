import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** True when a Supabase project is configured (E2E auth specs need one). */
export function supabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Creates a confirmed test user and returns credentials + cleanup. */
export async function createTestUser(prefix = "e2e") {
  const admin = adminClient();
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const password = `Test-${Math.random().toString(36).slice(2)}-42`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "E2E Test" },
  });
  if (error || !data.user) throw new Error(`test user creation failed: ${error?.message}`);
  const userId = data.user.id;

  return {
    email,
    password,
    userId,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      await admin.from("profiles").delete().eq("id", userId);
    },
  };
}
