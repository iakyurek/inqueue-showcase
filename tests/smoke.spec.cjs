// @ts-check
/**
 * inQueue smoke tests — verifies landing page loads, navigation works,
 * store mapping shows NorthWindUS = Store_A, and tool links exist.
 * Run: npx playwright test --config=playwright.config.js
 * Requires the inQueue hub server to be running on port 4000.
 */

const { test, expect } = require("@playwright/test");

const HUB = "http://localhost:4000";

test.describe("inQueue Hub — landing page", () => {
  test("page loads and shows iQ brand", async ({ page }) => {
    await page.goto(HUB);
    await expect(page).toHaveTitle(/inQueue/i);
    await expect(page.locator(".wordmark")).toContainText("inQueue");
  });

  test("workflow section is default active", async ({ page }) => {
    await page.goto(HUB);
    await expect(page.locator("#section-workflow")).toBeVisible();
    await expect(page.locator("#section-stores")).not.toBeVisible();
  });

  test("three tool cards are visible", async ({ page }) => {
    await page.goto(HUB);
    await expect(page.locator("#card-inkly")).toBeVisible();
    await expect(page.locator("#card-preply")).toBeVisible();
    await expect(page.locator("#card-batchly")).toBeVisible();
  });

  test("tool cards have correct open links", async ({ page }) => {
    await page.goto(HUB);
    const inklyLink = page.locator('#card-inkly a[href="http://localhost:5500"]');
    const preplyLink = page.locator('#card-preply a[href="http://localhost:3001"]');
    const batchlyLink = page.locator('#card-batchly a[href="http://localhost:3000"]');
    await expect(inklyLink).toBeVisible();
    await expect(preplyLink).toBeVisible();
    await expect(batchlyLink).toBeVisible();
  });

  test("Drive folder link is present and points to correct URL", async ({ page }) => {
    await page.goto(HUB);
    const driveLink = page.locator('a[href*="drive.google.com"][href*="1yWL_oBayqXL3RK7pjaJxBVBDTt_Qk5E7"]');
    await expect(driveLink).toBeVisible();
  });

  test("progress bar starts at 0 / 3", async ({ page }) => {
    await page.goto(HUB);
    // Clear any persisted state
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("#progressLabel")).toContainText("0 / 3");
  });

  test("marking inkly complete updates progress to 1 / 3", async ({ page }) => {
    await page.goto(HUB);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("#markbtn-inkly").click();
    await expect(page.locator("#progressLabel")).toContainText("1 / 3");
  });

  test("progress bar fill increases when step is marked", async ({ page }) => {
    await page.goto(HUB);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const fillBefore = await page.locator("#progressFill").evaluate((el) =>
      parseFloat(el.style.width || "0")
    );
    await page.locator("#markbtn-inkly").click();
    const fillAfter = await page.locator("#progressFill").evaluate((el) =>
      parseFloat(el.style.width || "0")
    );
    expect(fillAfter).toBeGreaterThan(fillBefore);
  });

  test("ARIA progressbar reflects correct valuenow", async ({ page }) => {
    await page.goto(HUB);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "0");
    await page.locator("#markbtn-inkly").click();
    await expect(page.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "33");
  });
});

test.describe("inQueue Hub — store settings", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HUB);
    await page.locator('[data-page="stores"]').click();
    // Wait for store table to populate
    await page.waitForSelector('#storeTableBody tr:not(.skeleton-row)');
  });

  test("store settings section loads", async ({ page }) => {
    await expect(page.locator("#section-stores")).toBeVisible();
    await expect(page.locator(".safety-notice")).toBeVisible();
  });

  test("safety notice mentions NorthWindUS = Store_A", async ({ page }) => {
    await expect(page.locator(".safety-notice")).toContainText("NorthWindUS");
    await expect(page.locator(".safety-notice")).toContainText("Store_A");
  });

  test("store table shows Store_A row", async ({ page }) => {
    await expect(page.locator('.folder-badge:has-text("Store_A")')).toBeVisible();
  });

  test("Store_A maps to NorthwindUS in Preply column", async ({ page }) => {
    const storeARow = page.locator('#storeTableBody tr.pinned');
    await expect(storeARow).toContainText("NorthwindUS");
    await expect(storeARow).toContainText("Store_A");
  });

  test("Store_A has LOCKED warning", async ({ page }) => {
    const storeARow = page.locator('#storeTableBody tr.pinned');
    await expect(storeARow).toContainText("LOCKED");
  });

  test("all stores show MATCHED status when Batchly is online", async ({ page }) => {
    const batchlyBanner = page.locator('#batchlyStatusBanner');
    const isOnline = await batchlyBanner.textContent().then(t => t?.includes("online")).catch(() => false);
    if (isOnline) {
      const matchedBadges = page.locator('.badge.ok:has-text("Matched")');
      const count = await matchedBadges.count();
      // At least the 6 Preply stores should be matched
      expect(count).toBeGreaterThanOrEqual(6);
    } else {
      test.skip();
    }
  });
});
