/**
 * Stripe seed: creates the top-up product used for nicer statement/receipt
 * naming and prints the webhook events to configure.
 * Run: npm run seed:stripe            (test keys)
 *      npm run seed:stripe -- --live  (live keys need the explicit flag)
 */
import Stripe from "stripe";

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY missing.");
    process.exit(1);
  }
  if (key.startsWith("sk_live") && !process.argv.includes("--live")) {
    console.error("Live key detected. Re-run with --live to confirm: npm run seed:stripe -- --live");
    process.exit(1);
  }

  const stripe = new Stripe(key);
  const appName = process.env.APP_NAME ?? "Versendio";

  // Idempotent: find-or-create by metadata marker.
  const existing = await stripe.products.search({
    query: `metadata['app']:'versendio' AND metadata['purpose']:'topup'`,
  });
  if (existing.data.length > 0) {
    console.log(`Top-up product exists: ${existing.data[0].id}`);
  } else {
    const product = await stripe.products.create({
      name: `Guthaben-Aufladung ${appName}`,
      metadata: { app: "versendio", purpose: "topup" },
    });
    console.log(`Created top-up product: ${product.id}`);
  }

  console.log("\nWebhook konfigurieren (Dashboard → Developers → Webhooks):");
  console.log("  Endpoint: <APP_URL>/api/webhooks/stripe");
  console.log("  Events:   checkout.session.completed,");
  console.log("            payment_intent.succeeded, payment_intent.payment_failed");
  console.log("  Signing-Secret als STRIPE_WEBHOOK_SECRET in .env.local eintragen.");
}

main();
