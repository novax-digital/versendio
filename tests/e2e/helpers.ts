import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

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

export type TestUser = {
  email: string;
  password: string;
  userId: string;
  cleanup: () => Promise<void>;
};

/** Creates a confirmed test user and returns credentials + cleanup. */
export async function createTestUser(prefix = "e2e"): Promise<TestUser> {
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
      // Remove data first, then the auth user (FKs are RESTRICT by design).
      await admin.from("send_job_items").delete().eq("user_id", userId);
      await admin.from("send_jobs").delete().eq("user_id", userId);
      await admin.from("lead_lists").delete().eq("user_id", userId);
      await admin.from("contacts").delete().eq("user_id", userId);
      await admin.from("letters").delete().eq("user_id", userId);
      await admin.from("letter_templates").delete().eq("user_id", userId);
      await admin.from("sender_addresses").delete().eq("user_id", userId);
      await admin.from("credit_transactions").delete().eq("user_id", userId);
      await admin.from("billing_accounts").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId).catch(() => {});
      await admin.from("profiles").delete().eq("id", userId);
    },
  };
}

/** Promotes a user to admin (service-role; profiles.role is trigger-protected). */
export async function promoteToAdmin(userId: string): Promise<void> {
  const { error } = await adminClient().from("profiles").update({ role: "admin" }).eq("id", userId);
  if (error) throw new Error(`promote failed: ${error.message}`);
}

/** Books credit directly through the ledger function (as the app does). */
export async function grantCredit(userId: string, cents: number): Promise<void> {
  const { error } = await adminClient().rpc("book_credit", {
    p_user_id: userId,
    p_type: "admin_adjust",
    p_amount_cents: cents,
    p_reference_type: "admin_adjust",
    p_reference_id: crypto.randomUUID(),
    p_comment: "E2E seed",
    p_created_by: "e2e",
  });
  if (error) throw new Error(`grantCredit failed: ${error.message}`);
}

export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(user.email);
  await page.getByLabel("Passwort", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/app$/);
}

/** Creates a sender address through the UI (the app requires one to send). */
export async function createSenderAddress(page: Page): Promise<void> {
  await page.goto("/app/einstellungen/absenderadressen");
  await page.getByRole("button", { name: "Absenderadresse hinzufügen" }).click();
  await page.getByLabel("Bezeichnung").fill("Hauptsitz");
  await page.getByLabel("Firma").fill("E2E GmbH");
  await page.getByLabel("Straße und Hausnummer").fill("Teststraße 1");
  await page.getByLabel("PLZ").fill("10115");
  await page.getByLabel("Ort").fill("Berlin");
  await page.getByRole("button", { name: "Speichern" }).click();
  await page.getByText("Hauptsitz").waitFor();
}
