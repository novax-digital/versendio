import { test, expect } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  supabaseConfigured,
  adminClient,
  createTestUser,
  login,
  type TestUser,
} from "./helpers";

/**
 * Upload journey: PDF upload → validation → redirect to the letter detail
 * page (must render, not crash) → stored object is the real PDF (pins the
 * pdf.js buffer-detach regression where uploads stored 0-byte files).
 */
test.describe("upload journey", () => {
  test.skip(!supabaseConfigured(), "Supabase env missing — configure .env.local to run");
  test.describe.configure({ mode: "serial" });

  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("e2e-upload");
  });

  test.afterAll(async () => {
    await user.cleanup();
  });

  /** Minimal valid letter: exact A4 box (595.276 × 841.89 pt), text outside the zones. */
  async function buildPdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.276, 841.89]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Sehr geehrte Damen und Herren,", { x: 70, y: 500, size: 11, font });
    page.drawText("dies ist ein E2E-Testbrief.", { x: 70, y: 480, size: 11, font });
    return Buffer.from(await doc.save());
  }

  test("upload a PDF, land on a working detail page, stored PDF is intact", async ({ page }) => {
    await login(page, user);
    await page.goto("/app/briefe/hochladen");

    await page.getByLabel("Bezeichnung des Briefs").fill("E2E Upload");
    await page.setInputFiles('input[type="file"]', {
      name: "e2e-brief.pdf",
      mimeType: "application/pdf",
      buffer: await buildPdf(),
    });
    await page.getByRole("button", { name: "PDF hochladen" }).click();

    // Redirect to the detail page — and the page must actually render.
    await page.waitForURL(/\/app\/briefe\/[0-9a-f-]{36}$/, { timeout: 20000 });
    await expect(page.getByRole("heading", { name: "E2E Upload" })).toBeVisible();
    await expect(page.getByText("Status")).toBeVisible();

    // The stored object must be the uploaded PDF, not an empty buffer.
    const admin = adminClient();
    const { data: letter } = await admin
      .from("letters")
      .select("id, storage_path, page_count, status")
      .eq("user_id", user.userId)
      .single();
    expect(letter?.storage_path).toBeTruthy();
    expect(letter?.page_count).toBe(1);
    const { data: file } = await admin.storage.from("letters").download(letter!.storage_path!);
    expect(file).toBeTruthy();
    const bytes = Buffer.from(await file!.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
