/**
 * Demo data for a test account: sender address, contacts, a lead list, an
 * editor letter with placeholders, and starting credit.
 * Run: node --env-file=.env.local scripts/seed-demo.ts [email]
 *
 * Creates the account if it does not exist. Idempotent-ish: re-running adds
 * nothing that already exists by name.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const DEMO_CONTACTS = [
  { first_name: "Erika", last_name: "Mustermann", company: "Muster GmbH", street: "Musterstraße 12", zip: "10115", city: "Berlin" },
  { first_name: "Max", last_name: "Beispiel", company: null, street: "Beispielweg 3", zip: "80331", city: "München" },
  { first_name: "Anna", last_name: "Schmidt", company: "Schmidt & Partner", street: "Hauptstraße 45", zip: "20095", city: "Hamburg" },
  { first_name: "Peter", last_name: "Weber", company: null, street: "Gartenstraße 7", zip: "50667", city: "Köln" },
  { first_name: "Sabine", last_name: "Fischer", company: "Fischer AG", street: "Ringstraße 22", zip: "1010", city: "Wien", country: "AT" },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.argv[2] ?? "demo@example.com";

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Account (via Auth Admin API — the authoritative identity store).
  let userId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    userId = existing.id;
    console.log(`Using existing account ${email}`);
  } else {
    const password = randomBytes(18).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Demo Nutzer", company: "Demo GmbH" },
    });
    if (error || !data.user) {
      console.error(`Could not create demo user: ${error?.message}`);
      process.exit(1);
    }
    userId = data.user.id;
    console.log(`Created ${email}`);
    console.log(`Password: ${password}`);
  }

  // 2) Billing address (required before the first top-up).
  await admin
    .from("profiles")
    .update({
      display_name: "Demo Nutzer",
      company: "Demo GmbH",
      billing_street: "Demoallee 1",
      billing_zip: "10115",
      billing_city: "Berlin",
      billing_country: "DE",
    })
    .eq("id", userId);

  // 3) Sender address (mandatory for sending).
  const { data: sender } = await admin
    .from("sender_addresses")
    .select("id")
    .eq("user_id", userId)
    .eq("label", "Hauptsitz")
    .maybeSingle();
  if (!sender) {
    await admin.from("sender_addresses").insert({
      user_id: userId,
      label: "Hauptsitz",
      company: "Demo GmbH",
      street: "Demoallee 1",
      zip: "10115",
      city: "Berlin",
      country: "DE",
      sender_line: "Demo GmbH · Demoallee 1 · 10115 Berlin",
      is_default: true,
    });
    console.log("Sender address created.");
  }

  // 4) Contacts + lead list.
  const { data: existingContacts } = await admin
    .from("contacts")
    .select("id")
    .eq("user_id", userId);
  let contactIds = (existingContacts ?? []).map((c) => c.id);

  if (contactIds.length === 0) {
    const { data: inserted, error } = await admin
      .from("contacts")
      .insert(
        DEMO_CONTACTS.map((c) => ({
          user_id: userId,
          first_name: c.first_name,
          last_name: c.last_name,
          company: c.company,
          street: c.street,
          zip: c.zip,
          city: c.city,
          country: c.country ?? "DE",
        })),
      )
      .select("id");
    if (error) {
      console.error(`Contacts failed: ${error.message}`);
      process.exit(1);
    }
    contactIds = (inserted ?? []).map((c) => c.id);
    console.log(`${contactIds.length} contacts created.`);
  }

  const { data: existingList } = await admin
    .from("lead_lists")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "Demo-Kunden")
    .maybeSingle();
  if (!existingList && contactIds.length > 0) {
    const { data: list } = await admin
      .from("lead_lists")
      .insert({ user_id: userId, name: "Demo-Kunden", source: "manual" })
      .select("id")
      .single();
    if (list) {
      await admin
        .from("lead_list_entries")
        .insert(contactIds.map((id) => ({ list_id: list.id, contact_id: id })));
      console.log("Lead list created.");
    }
  }

  // 5) Editor letter with placeholders.
  const { data: existingLetter } = await admin
    .from("letters")
    .select("id")
    .eq("user_id", userId)
    .eq("title", "Demo-Serienbrief")
    .maybeSingle();
  if (!existingLetter) {
    await admin.from("letters").insert({
      user_id: userId,
      title: "Demo-Serienbrief",
      source: "editor",
      status: "ready",
      has_placeholders: true,
      address_zone_result: "ok",
      page_count: 1,
      sheet_count: 1,
      editor_document: {
        version: 1,
        logoStoragePath: null,
        showDate: true,
        senderAddressId: null,
        blocks: [
          { type: "subject", id: "s1", text: "Unser Angebot für {{firma}}" },
          {
            type: "text",
            id: "t1",
            text:
              "Sehr geehrte/r {{vorname}} {{nachname}},\n\n" +
              "vielen Dank für Ihr Interesse. Gerne senden wir Ihnen unser aktuelles Angebot zu.\n\n" +
              "Mit freundlichen Grüßen\nDemo GmbH",
          },
        ],
      },
    });
    console.log("Demo letter created.");
  }

  // 6) Starting credit (through the ledger, as the app does).
  const { data: profile } = await admin
    .from("profiles")
    .select("credit_balance_cents")
    .eq("id", userId)
    .single();
  if ((profile?.credit_balance_cents ?? 0) === 0) {
    const { error } = await admin.rpc("book_credit", {
      p_user_id: userId,
      p_type: "admin_adjust",
      p_amount_cents: 5000,
      p_reference_type: "admin_adjust",
      p_reference_id: crypto.randomUUID(),
      p_comment: "Demo-Startguthaben",
      p_created_by: "seed",
    });
    if (error) console.error(`Credit failed: ${error.message}`);
    else console.log("50,00 € demo credit booked.");
  }

  console.log("\nDemo data ready. Log in with the password-reset flow if unknown.");
}

main();
