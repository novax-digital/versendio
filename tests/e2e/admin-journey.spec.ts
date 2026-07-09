import { test, expect } from "@playwright/test";
import {
  supabaseConfigured,
  createTestUser,
  promoteToAdmin,
  login,
  adminClient,
  type TestUser,
} from "./helpers";

/** Admin journey (MASTERPROMPT Phase 9): guards, KPIs, user actions, pricing. */
test.describe("admin journey", () => {
  test.skip(!supabaseConfigured(), "Supabase env missing — configure .env.local to run");
  test.describe.configure({ mode: "serial" });

  let admin: TestUser;
  let customer: TestUser;

  test.beforeAll(async () => {
    admin = await createTestUser("e2e-admin");
    customer = await createTestUser("e2e-customer");
    await promoteToAdmin(admin.userId);
  });

  test.afterAll(async () => {
    await customer.cleanup();
    await admin.cleanup();
  });

  test("a normal user is redirected away from /admin", async ({ page }) => {
    await login(page, customer);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/app$/);
  });

  test("admin sees the dashboard with gross profit and system status", async ({ page }) => {
    await login(page, admin);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();
    await expect(page.getByText("Rohertrag (Monat)")).toBeVisible();
    await expect(page.getByText("Systemstatus")).toBeVisible();
    await expect(page.getByText("Guthaben-Ledger konsistent")).toBeVisible();
  });

  test("admin books credit with a mandatory comment and it lands in the ledger", async ({
    page,
  }) => {
    await login(page, admin);
    await page.goto(`/admin/nutzer/${customer.userId}`);

    // The button stays disabled until a comment is present (mandatory per §6.7).
    await page.getByLabel("Betrag in Cent (negativ = Abbuchung)").fill("2500");
    const bookButton = page.getByRole("button", { name: "Guthaben buchen" }).last();
    await expect(bookButton).toBeDisabled();

    await page.getByLabel("Kommentar (Pflicht)").fill("E2E Testbuchung");
    await bookButton.click();
    await expect(page.getByText("Guthaben wurde gebucht.")).toBeVisible();
    await expect(page.getByText("25,00 €").first()).toBeVisible();
  });

  test("credit adjustment is written to the audit log", async ({ page }) => {
    await login(page, admin);
    await page.goto("/admin/audit");
    await expect(page.getByText("Guthaben gebucht").first()).toBeVisible();
  });

  test("admin blocks and unblocks a user", async ({ page }) => {
    await login(page, admin);
    await page.goto(`/admin/nutzer/${customer.userId}`);

    await page.getByRole("button", { name: "Nutzer sperren" }).click();
    await expect(page.getByText("Der Status wurde geändert.")).toBeVisible();
    await expect(page.getByText("Gesperrt")).toBeVisible();

    await page.getByRole("button", { name: "Sperre aufheben" }).click();
    await expect(page.getByText("Der Status wurde geändert.")).toBeVisible();
  });

  test("pricing table shows margins and blocks selling below cost", async ({ page }) => {
    await login(page, admin);
    await page.goto("/admin/preise");
    await expect(page.getByText("Standard S/W beidseitig")).toBeVisible();

    // Row for standard bw duplex: EK 81, VK 115 → margin shown.
    const vkInput = page.getByLabel("VK (Cent) Standard S/W beidseitig");
    await vkInput.fill("50"); // below EK
    await expect(page.getByText("VK liegt unter EK!").first()).toBeVisible();
  });

  test("settings reject an invalid value type", async ({ page }) => {
    await login(page, admin);
    await page.goto("/admin/einstellungen");
    const field = page.getByLabel(/Queue-Batchgröße je Lauf/);
    await field.fill('"nonsense"');
    await page.getByRole("button", { name: "Speichern" }).first().click();
    await expect(page.getByText("nicht das erwartete Format", { exact: false })).toBeVisible();
  });

  test("a blocked admin loses console access", async ({ page }) => {
    await adminClient().from("profiles").update({ status: "blocked" }).eq("id", admin.userId);
    try {
      await login(page, admin);
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/app$/);
    } finally {
      await adminClient().from("profiles").update({ status: "active" }).eq("id", admin.userId);
    }
  });
});
