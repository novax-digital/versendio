/**
 * Promotes ADMIN_EMAIL to the admin role (creates the account if missing).
 * Run: npm run seed:admin  (loads .env.local via node --env-file)
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!url || !serviceKey || !adminEmail) {
    console.error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ADMIN_EMAIL are required.",
    );
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const targetEmail = adminEmail.toLowerCase();

  // Resolve the account via the Auth Admin API — the authoritative identity
  // store — NOT via profiles.email (which is derived and must never be the
  // basis of a privilege grant).
  let userId: string | null = null;
  for (let page = 1; page <= 100 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error(`Could not list users: ${error.message}`);
      process.exit(1);
    }
    const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
    if (match) userId = match.id;
    if (data.users.length < 200) break;
  }

  if (userId) {
    console.log(`Auth user for ${adminEmail} exists.`);
  } else {
    const password = randomBytes(24).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Administrator" },
    });
    if (error) {
      console.error(`Could not create admin user: ${error.message}`);
      process.exit(1);
    }
    userId = data.user.id;
    console.log(`Created admin user ${adminEmail}.`);
    console.log("Set a password via the password-reset flow (Passwort vergessen).");
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", userId);
  if (updateError) {
    console.error(`Could not promote to admin: ${updateError.message}`);
    process.exit(1);
  }
  console.log(`${adminEmail} is now admin.`);
}

main();
