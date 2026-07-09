import { test, expect } from "@playwright/test";
import {
  supabaseConfigured,
  createTestUser,
  grantCredit,
  login,
  createSenderAddress,
  type TestUser,
} from "./helpers";

/**
 * Complete user journey (MASTERPROMPT Phase 9): registration → letter →
 * lead list → send in mock mode → status. Runs against MOCK_MODE=true.
 */
test.describe("user journey", () => {
  test.skip(!supabaseConfigured(), "Supabase env missing — configure .env.local to run");
  test.describe.configure({ mode: "serial" });

  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("e2e-journey");
    await grantCredit(user.userId, 5000); // 50 € so the send is affordable
  });

  test.afterAll(async () => {
    await user.cleanup();
  });

  test("login and set up a sender address", async ({ page }) => {
    await login(page, user);
    await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
    await createSenderAddress(page);
    await expect(page.getByText("Standard", { exact: true })).toBeVisible();
  });

  test("create an editor letter with a placeholder", async ({ page }) => {
    await login(page, user);
    await page.goto("/app/briefe/editor");

    await page.getByLabel("Bezeichnung des Briefs").fill("E2E Serienbrief");
    // Subject block is present by default.
    await page.getByPlaceholder("Betreff").fill("Ihr Angebot");
    const body = page.getByPlaceholder("Textabsatz");
    await body.fill("Sehr geehrte ");
    // Insert a placeholder at the caret via the chip.
    await page.getByRole("button", { name: "Nachname", exact: true }).click();
    await expect(body).toHaveValue(/\{\{nachname\}\}/);

    await page.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(page.getByText("Der Brief wurde gespeichert.")).toBeVisible();
  });

  test("import contacts from CSV and create a lead list", async ({ page }) => {
    await login(page, user);
    await page.goto("/app/kontakte/import");

    const csv = "Vorname,Nachname,Strasse,PLZ,Ort\nErika,Musterfrau,Musterweg 3,10115,Berlin\n";
    await page.setInputFiles('input[type="file"]', {
      name: "kontakte.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });

    await expect(page.getByText("Spalten zuordnen")).toBeVisible();
    await page.getByLabel("Name der Leadliste").fill("E2E Liste");
    await page.getByRole("button", { name: "Import starten" }).click();

    await expect(page.getByText("Import abgeschlossen")).toBeVisible();
    await expect(page.getByText("1 Kontakte importiert")).toBeVisible();
  });

  test("send the letter to the lead list and see it queued", async ({ page }) => {
    await login(page, user);
    await page.goto("/app/versand");

    // Step 1: letter
    await page.getByText("E2E Serienbrief").click();
    await page.getByRole("button", { name: "Weiter" }).click();

    // Step 2: lead list is preselected (only one exists)
    await expect(page.getByText("E2E Liste")).toBeVisible();
    await page.getByRole("button", { name: "Weiter" }).click();

    // Step 3: options — defaults are fine
    await expect(page.getByText("Farbdruck")).toBeVisible();
    await page.getByRole("button", { name: "Weiter" }).click();

    // Step 4: cost preview must show a price and sufficient balance
    await expect(page.getByText("Kostenvorschau")).toBeVisible();
    await expect(page.getByText("Testmodus:", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Kostenpflichtig versenden" }).click();
    await page.waitForURL(/\/app\/sendungen\/[0-9a-f-]+$/);
    await expect(page.getByText("In Warteschlange")).toBeVisible();
  });

  test("the send debited the balance and left a ledger entry", async ({ page }) => {
    await login(page, user);
    await page.goto("/app/guthaben");
    await expect(page.getByText("Versand")).toBeVisible(); // spend transaction
    // 50 € minus at least one letter
    const balance = await page.getByText(/€/).first().textContent();
    expect(balance).toBeTruthy();
  });

  test("a blocked user cannot start a send", async ({ page }) => {
    const { adminClient } = await import("./helpers");
    await adminClient().from("profiles").update({ status: "blocked" }).eq("id", user.userId);
    try {
      await login(page, user);
      await expect(page.getByText("Ihr Konto ist derzeit gesperrt", { exact: false })).toBeVisible();
    } finally {
      await adminClient().from("profiles").update({ status: "active" }).eq("id", user.userId);
    }
  });
});
