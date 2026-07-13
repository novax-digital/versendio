/**
 * One-time interactive setup of the E-POSTBUSINESS API credentials.
 *
 * Flow (docs/EPOST_INTEGRATION.md §1): POST /api/Login/smsRequest sends a TAN
 * to the mobile number registered with Deutsche Post, POST /api/Login/setPassword
 * with that TAN sets the API password and returns the `secret`. Both values are
 * then verified with a real POST /api/Login and written to .env.local on request.
 *
 * Run: npm run setup:epost  (loads .env.local via node --env-file)
 *
 * Credentials live ONLY in env vars (never in the DB) — for production, copy the
 * resulting EPOST_PASSWORD/EPOST_SECRET into Vercel → Environment Variables.
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const ENV_FILE = new URL("../.env.local", import.meta.url);

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Password accepted by the API; alphanumeric so .env parsing never needs quoting. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(32), (b) => alphabet[b % alphabet.length]).join("");
}

/** Quote a value for node --env-file if it contains characters beyond a safe set. */
function envValue(value: string): string {
  return /^[A-Za-z0-9+/=_.:@-]*$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

async function main() {
  const baseUrl = process.env.EPOST_BASE_URL?.replace(/\/+$/, "");
  const vendorId = process.env.EPOST_VENDOR_ID;
  const ekp = process.env.EPOST_EKP;

  if (!baseUrl || !vendorId || !ekp) {
    fail("Missing env: EPOST_BASE_URL, EPOST_VENDOR_ID and EPOST_EKP are required (.env.local).");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("E-POSTBUSINESS API — one-time credential setup\n");
  console.log(`  Base URL : ${baseUrl}`);
  console.log(`  vendorID : ${vendorId}`);
  console.log(`  EKP      : ${ekp}\n`);
  console.log(
    "The TAN is sent to the mobile number registered with Deutsche Post for this account.",
  );
  if (process.env.EPOST_PASSWORD) {
    console.log(
      "\n⚠ EPOST_PASSWORD is currently set — continuing will REPLACE the API password and",
    );
    console.log(
      "  secret. Any other environment using the old values (e.g. Vercel) must be updated.",
    );
  }

  const proceed = (await rl.question("\nRequest SMS TAN now? [y/N] ")).trim().toLowerCase();
  if (proceed !== "y" && proceed !== "yes" && proceed !== "j" && proceed !== "ja") {
    console.log("Aborted — nothing was changed.");
    rl.close();
    return;
  }

  const sms = await postJson(baseUrl, "/api/Login/smsRequest", { vendorID: vendorId, ekp });
  if (!sms.ok) {
    fail(
      `SMS request failed [${sms.status}]: ${sms.text}\n` +
        "  Common causes: mobile number not registered with E-POST, or the API contract\n" +
        "  is not activated yet for this environment.",
    );
  }
  console.log("\n✓ SMS request accepted. The TAN should arrive within a minute.");

  const smsCode = (await rl.question("\n6-digit SMS code: ")).trim();
  if (!/^\d{6}$/.test(smsCode)) fail("The SMS code must be exactly 6 digits.");

  let password = (
    await rl.question("New API password (leave empty to generate a strong one): ")
  ).trim();
  if (!password) {
    password = generatePassword();
    console.log("✓ Generated a 32-character password.");
  } else if (password.length < 5 || password.length > 100) {
    fail("Password must be 5–100 characters.");
  }

  const set = await postJson(baseUrl, "/api/Login/setPassword", {
    vendorID: vendorId,
    ekp,
    newPassword: password,
    smsCode,
  });
  if (!set.ok) {
    fail(
      `setPassword failed [${set.status}]: ${set.text}\n` +
        "  If the TAN was wrong or expired, re-run this script to request a fresh one.",
    );
  }

  // The response contains the secret (shape observed in the field: json.secret,
  // json.Secret, json.value, or the bare string).
  let secret: string | undefined;
  try {
    const json = JSON.parse(set.text) as Record<string, string>;
    secret = json.secret || json.Secret || json.value;
  } catch {
    secret = set.text.replace(/^"|"$/g, "").trim() || undefined;
  }
  if (!secret) fail(`Password was set, but no secret found in the response: ${set.text}`);

  console.log("✓ Password set, secret received. Verifying with POST /api/Login …");

  const login = await postJson(baseUrl, "/api/Login", {
    vendorID: vendorId,
    ekp,
    secret,
    password,
  });
  let token: string | undefined;
  try {
    token = (JSON.parse(login.text) as { token?: string }).token;
  } catch {
    /* handled below */
  }
  if (!login.ok || !token) {
    fail(
      `Verification login failed [${login.status}]: ${login.text}\n` +
        "  The password/secret below were NOT written anywhere — check the account state.",
    );
  }
  console.log("✓ Login verified — received a JWT.\n");

  const write = (await rl.question("Write EPOST_PASSWORD and EPOST_SECRET to .env.local? [Y/n] "))
    .trim()
    .toLowerCase();
  rl.close();

  if (write === "n" || write === "no" || write === "nein") {
    console.log("\nAdd these to your environment yourself (shown once, not stored):\n");
    console.log(`EPOST_PASSWORD=${envValue(password)}`);
    console.log(`EPOST_SECRET=${envValue(secret)}`);
  } else {
    let env: string;
    try {
      env = await readFile(ENV_FILE, "utf8");
    } catch {
      fail(".env.local not found — re-run and choose 'n' to print the values instead.");
    }
    for (const [key, value] of [
      ["EPOST_PASSWORD", password],
      ["EPOST_SECRET", secret],
    ] as const) {
      const line = `${key}=${envValue(value)}`;
      env = new RegExp(`^${key}=`, "m").test(env)
        ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
        : `${env.replace(/\n*$/, "\n")}${line}\n`;
    }
    await writeFile(ENV_FILE, env, "utf8");
    console.log("\n✓ .env.local updated.");
  }

  console.log("\nNext steps:");
  console.log("  • Production: copy both values into Vercel → Settings → Environment Variables.");
  console.log("  • Then follow the go-live test plan: docs/EPOST_INTEGRATION.md §4 (start with a");
  console.log("    Probeversand before setting MOCK_MODE=false).");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
