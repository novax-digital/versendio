import { test, expect } from "@playwright/test";
import { supabaseConfigured, createTestUser } from "./helpers";

test.describe("public pages", () => {
  // There is no marketing site — the root goes straight into the app and the
  // auth gate lands logged-out visitors on the login page.
  test("root redirects into the app login gate", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  });

  test("legal placeholder pages exist", async ({ page }) => {
    for (const slug of ["impressum", "datenschutz", "agb", "avv"]) {
      await page.goto(`/rechtliches/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("register form validates input client-roundtrip", async ({ page }) => {
    await page.goto("/registrieren");
    await page.getByLabel("Ihr Name").fill("Test");
    await page.getByLabel("E-Mail-Adresse").fill("keine-email");
    await page.getByLabel("Passwort", { exact: true }).fill("kurz");
    await page.getByLabel("Passwort wiederholen").fill("anders");
    await page.getByRole("button", { name: "Konto erstellen" }).click();
    await expect(page.getByText("gültige E-Mail-Adresse")).toBeVisible();
  });
});

test.describe("auth flows (requires Supabase)", () => {
  test.skip(!supabaseConfigured(), "Supabase env missing — configure .env.local to run");

  // Needs a session check, so it needs a configured Supabase project.
  test("app routes redirect to login when logged out", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login → dashboard → logout", async ({ page }) => {
    const user = await createTestUser("e2e-login");
    try {
      await page.goto("/login");
      await page.getByLabel("E-Mail-Adresse").fill(user.email);
      await page.getByLabel("Passwort", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Anmelden" }).click();

      await expect(page).toHaveURL(/\/app$/);
      await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();

      await page.getByRole("button", { name: "Benutzermenü" }).click();
      await page.getByRole("menuitem", { name: "Abmelden" }).click();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await user.cleanup();
    }
  });

  test("wrong password shows German error", async ({ page }) => {
    const user = await createTestUser("e2e-wrongpw");
    try {
      await page.goto("/login");
      await page.getByLabel("E-Mail-Adresse").fill(user.email);
      await page.getByLabel("Passwort", { exact: true }).fill("falsches-passwort");
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page.getByText("nicht korrekt")).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });

  test("password forgot flow shows neutral confirmation", async ({ page }) => {
    await page.goto("/passwort-vergessen");
    await page.getByLabel("E-Mail-Adresse").fill("unbekannt@example.com");
    await page.getByRole("button", { name: "Link anfordern" }).click();
    await expect(page.getByText("Falls ein Konto")).toBeVisible();
  });

  test("profile and sender address management", async ({ page }) => {
    const user = await createTestUser("e2e-profile");
    try {
      await page.goto("/login");
      await page.getByLabel("E-Mail-Adresse").fill(user.email);
      await page.getByLabel("Passwort", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page).toHaveURL(/\/app$/);

      // Update profile
      await page.goto("/app/einstellungen");
      await page.getByLabel("Ihr Name").fill("E2E Nutzer");
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByText("gespeichert")).toBeVisible();

      // Create sender address (auto default)
      await page.goto("/app/einstellungen/absenderadressen");
      await page.getByRole("button", { name: "Absenderadresse hinzufügen" }).click();
      await page.getByLabel("Bezeichnung").fill("Hauptsitz");
      await page.getByLabel("Firma").fill("E2E GmbH");
      await page.getByLabel("Straße und Hausnummer").fill("Teststraße 1");
      await page.getByLabel("PLZ").fill("10115");
      await page.getByLabel("Ort").fill("Berlin");
      await page.getByRole("button", { name: "Speichern" }).click();
      await expect(page.getByText("Hauptsitz")).toBeVisible();
      await expect(page.getByText("Standard", { exact: true })).toBeVisible();
    } finally {
      await user.cleanup();
    }
  });
});
