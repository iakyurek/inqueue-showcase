// @ts-check
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const BATCHLY_ROOT = path.join(__dirname, "..", "batchly");
const BATCHLY_DOWNLOADS_DIR = path.join(BATCHLY_ROOT, "workspace", "downloads");

function createBatchlyCleanupFixture(batchName) {
  const batchPath = path.join(BATCHLY_DOWNLOADS_DIR, batchName);
  fs.rmSync(batchPath, { recursive: true, force: true });
  fs.mkdirSync(path.join(batchPath, "Store_A", "D001"), { recursive: true });
  fs.writeFileSync(
    path.join(batchPath, "batch_manifest.csv"),
    [
      "store_folder,design_id,sku,title,description,tags,price,product_type",
      "Store_A,D001,CU-CLEANUP,Cleanup Fixture Shirt,Cleanup Fixture Shirt,\"cleanup shirt,test fixture,local batch\",24.99,PHYSICAL",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(batchPath, "Store_A", "D001", "CU-CLEANUP_1.jpg"), "fixture image placeholder");
  return batchPath;
}

function removeBatchlyCleanupFixture(batchName) {
  fs.rmSync(path.join(BATCHLY_DOWNLOADS_DIR, batchName), { recursive: true, force: true });
}

// ── Inkly (5500) ─────────────────────────────────────────────────────────────

test.describe("Inkly UI", () => {
  test("page loads and shows wordmark", async ({ page }) => {
    await page.goto("http://localhost:5500");
    await expect(page.locator(".wordmark")).toBeVisible();
  });

  test("shows 'a product of inQueue' branding", async ({ page }) => {
    await page.goto("http://localhost:5500");
    await expect(page.getByText("a product of inQueue")).toBeVisible();
  });

  test("Hub link is present in topbar", async ({ page }) => {
    await page.goto("http://localhost:5500");
    const hubLink = page.getByRole("link", { name: /hub/i });
    await expect(hubLink).toBeVisible();
    const href = await hubLink.getAttribute("href");
    expect(href).toContain("4000");
  });

  test("Start or Resume batch button is visible on home screen", async ({ page }) => {
    await page.goto("http://localhost:5500");
    // Either Start or Resume is shown depending on saved state
    const btn = page.locator("#startBatchBtn, #resumeBatchBtn").first();
    await expect(btn).toBeVisible();
  });

  test("export batch route exists and returns correct content-type", async ({ request }) => {
    // Lightweight API check — no actual designs, just verifies the route rejects gracefully
    const res = await request.post("http://localhost:5500/api/export-batch", {
      data: { items: [] },
    });
    // Expects a 400 with JSON error when items is empty — not a 404/500
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// ── Preply (3001) ─────────────────────────────────────────────────────────────

test.describe("Preply UI", () => {
  test("page loads and shows 'preply' wordmark", async ({ page }) => {
    await page.goto("http://localhost:3001");
    await expect(page.locator(".wordmark").first()).toBeVisible();
  });

  test("Hub link is present", async ({ page }) => {
    await page.goto("http://localhost:3001");
    const hubLink = page.getByRole("link", { name: /hub/i });
    await expect(hubLink).toBeVisible();
  });

  test("import/upload controls are present", async ({ page }) => {
    await page.goto("http://localhost:3001");
    // Upload or import button should exist
    const importBtn = page.getByRole("button", { name: /upload|import|inkly/i }).first();
    await expect(importBtn).toBeVisible();
  });

  test("export controls are visible", async ({ page }) => {
    await page.goto("http://localhost:3001");
    // Navigate to export page if present, or check export button
    const exportEl = page.getByRole("button", { name: /export/i }).or(
      page.getByText(/export/i)
    ).first();
    await expect(exportEl).toBeVisible();
  });

  test("health endpoint returns ok", async ({ request }) => {
    const res = await request.get("http://localhost:3001/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.port).toBe(3001);
  });
});

// ── Batchly (3000) ────────────────────────────────────────────────────────────

test.describe("Batchly UI", () => {
  test("dashboard page loads", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("inQueue Hub link visible in sidebar", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");
    await expect(page.getByText("inQueue Hub")).toBeVisible();
  });

  test("stores page loads and shows Store_A", async ({ page }) => {
    await page.goto("http://localhost:3000/stores");
    // Store A should be present
    await expect(page.getByText(/store a/i).first()).toBeVisible();
  });

  test("stores page shows NorthWindUS connected", async ({ page }) => {
    await page.goto("http://localhost:3000/stores");
    await expect(page.getByText(/northwindus/i, { exact: false }).first()).toBeVisible();
  });

  test("batches page loads", async ({ page }) => {
    await page.goto("http://localhost:3000/batches");
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("System Readiness")).toBeVisible();
    await expect(page.getByText("Google Drive", { exact: true })).toBeVisible();
    await expect(page.getByText("Stores connected")).toBeVisible();
    await expect(page.getByTestId("batches-inqueue-section").getByText("Batches inQueue", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a Batch" })).toBeVisible();
    await expect(page.getByText("Batches inQueue")).toBeVisible();
    await expect(page.getByText("Completed Batches")).toBeVisible();
    await expect(page.getByText("Uploaded and fully processed batches, collapsed by default")).toBeVisible();
    await expect(page.getByText(/1\/1 Etsy draft/).first()).not.toBeVisible();
  });

  test("Start a Batch scans Drive, selects a folder, imports it, and starts validation", async ({ page }) => {
    const batchName = "BATCH-DRIVE-WORKFLOW-001";
    let scanCalled = false;
    let importCalled = false;
    let validateCalled = false;

    await page.route("**/api/batches/scan-drive", async (route) => {
      scanCalled = true;
      expect(route.request().method()).toBe("POST");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          batches: [{
            id: "drive-folder-workflow-001",
            name: batchName,
            modifiedTime: "2026-06-30T12:00:00.000Z",
            localExists: false,
            alreadyImported: false,
            alreadyCompleted: false,
            duplicateMessage: null,
            storeFoldersDetected: [],
            hasManifest: null,
            manifestRowCount: null,
            warnings: [],
          }],
        }),
      });
    });

    await page.route("**/api/batches/local/import", async (route) => {
      importCalled = true;
      const body = route.request().postDataJSON();
      expect(body.folderId).toBe("drive-folder-workflow-001");
      expect(body.folderName).toBe(batchName);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ imported: true, batchFolder: batchName, downloadResult: { filesDownloaded: 4, filesSkipped: 0, errors: [] } }),
      });
    });

    await page.route("**/api/batches/validate", async (route) => {
      const body = route.request().postDataJSON();
      if (body.batchFolder !== batchName) return route.continue();
      validateCalled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          batchFolder: batchName,
          overallStatus: "ready",
          manifestStatus: "ok",
          manifestRowCount: 1,
          manifestErrors: [],
          manifestWarnings: [],
          storesInManifest: ["Store_A"],
          globalPreset: { exists: true, hasTemplate: true, descriptionTemplateLength: 200 },
          variationPreset: { enabled: false, ready: true, combinationCount: 0, issues: [] },
          supplementalPreset: { enabled: true, filesAvailable: 3, sizeChartCount: 3, sizeChartRequired: 3, issues: [] },
          storeResults: [{
            storeFolder: "Store_A",
            storeName: "Store A",
            storeId: "store-a",
            etsyConnected: true,
            etsyShopName: "NorthWindUS",
            etsySetupReady: true,
            taxonomyId: "123",
            shippingProfileId: "456",
            readinessStateId: "789",
            manifestRowCount: 1,
            validListingsCount: 1,
            ineligibleCount: 0,
            missingImageCount: 0,
            missingTitleCount: 0,
            missingSkuCount: 0,
            missingTagsCount: 0,
            invalidPriceCount: 0,
            alreadyCreatedCount: 0,
            eligibleNotCreatedCount: 1,
            estimatedListings: 1,
            warnings: [],
            errors: [],
          }],
          validatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto("http://localhost:3000/batches");
    await page.getByRole("button", { name: "Start a Batch" }).click();
    await expect(page.getByText(batchName)).toBeVisible();
    await page.getByText(batchName).click();
    await page.getByRole("button", { name: "Add to inQueue" }).click();

    await expect.poll(() => scanCalled).toBe(true);
    await expect.poll(() => importCalled).toBe(true);
    await expect.poll(() => validateCalled).toBe(true);
    await expect(page.getByText("Batch Validation")).toBeVisible();
    await expect(page.getByText(batchName).first()).toBeVisible();
  });

  test("remove from inQueue confirms, calls local delete, and removes the workspace folder", async ({ page }) => {
    const batchName = "BATCH-PLAYWRIGHT-CLEANUP-FIXTURE";
    const batchPath = createBatchlyCleanupFixture(batchName);
    const externalRequests = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/api/etsy") || url.includes("/api/drive")) externalRequests.push(url);
    });

    try {
      await page.goto("http://localhost:3000/batches");
      const card = page.getByTestId(`batch-card-inqueue-${batchName}`);
      await expect(card).toBeVisible();

      await expect(card.getByRole("button", { name: "Run Batch" })).toBeVisible();
      await expect(card.getByRole("button", { name: "Remove from inQueue" })).toBeVisible();
      await card.getByRole("button", { name: "Remove from inQueue" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Remove this batch from inQueue?");
      await expect(dialog).toContainText("It will not delete Etsy drafts, Google Drive folders, Preply exports, or completed batch history.");

      const [deleteResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().includes(`/api/batches/local/${encodeURIComponent(batchName)}`) &&
          response.request().method() === "DELETE"
        ),
        dialog.getByRole("button", { name: "Remove from inQueue" }).click(),
      ]);

      expect(deleteResponse.status()).toBe(200);
      const body = await deleteResponse.json();
      expect(body.removed).toBe(true);
      expect(body.preservedRecords).toBeTruthy();
      await expect(card).not.toBeVisible();
      await expect(page.getByText(`Removed ${batchName} from inQueue.`)).toBeVisible();
      expect(fs.existsSync(batchPath)).toBe(false);
      expect(externalRequests).toEqual([]);
    } finally {
      removeBatchlyCleanupFixture(batchName);
    }
  });

  test("completed batches do not show remove from inQueue by default", async ({ page }) => {
    await page.goto("http://localhost:3000/batches");
    const completedSection = page.getByTestId("completed-batches-section");
    await expect(completedSection.getByRole("button", { name: "Remove from inQueue" })).toHaveCount(0);
    await completedSection.getByRole("button", { name: /open/i }).click();
    await expect(completedSection.getByRole("button", { name: "Remove from inQueue" })).toHaveCount(0);
  });

  test("local batch remove endpoint rejects traversal and outside-workspace names", async ({ request }) => {
    const traversal = await request.delete("http://localhost:3000/api/batches/local/%2e%2e%5Cpackage.json");
    expect(traversal.status()).toBe(400);
    expect((await traversal.json()).removed).toBe(false);

    const outside = await request.delete("http://localhost:3000/api/batches/local/workspace%5C..%5Cpackage.json");
    expect(outside.status()).toBe(400);
    expect((await outside.json()).removed).toBe(false);
  });

  test("local batch remove endpoint preserves draft records unless explicitly confirmed", async ({ request }) => {
    const local = await request.get("http://localhost:3000/api/batches/local");
    expect(local.status()).toBe(200);
    const body = await local.json();
    const completedWithDrafts = (body.batches ?? []).find((batch) =>
      batch.queueSection === "completed" && batch.completedListingCount > 0
    );

    test.skip(!completedWithDrafts, "No completed local batch with draft records is available for preservation check.");

    const res = await request.delete(`http://localhost:3000/api/batches/local/${encodeURIComponent(completedWithDrafts.folderName)}`);
    expect(res.status()).toBe(409);
    const deleteBody = await res.json();
    expect(deleteBody.removed).toBe(false);
    expect(deleteBody.requiresDraftRecordConfirmation).toBe(true);
    expect(deleteBody.preservedRecords.createdDraftRecords).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(BATCHLY_DOWNLOADS_DIR, completedWithDrafts.folderName))).toBe(true);
  });

  test("validate API returns structured result for existing batch", async ({ request }) => {
    const batchName = "BATCH-PLAYWRIGHT-VALIDATE-FIXTURE";
    createBatchlyCleanupFixture(batchName);
    try {
      const res = await request.post("http://localhost:3000/api/batches/validate", {
        data: { batchFolder: batchName },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(["ready", "warnings", "failed"]).toContain(body.overallStatus);
      expect(body.manifestStatus).toBe("ok");
      expect(body.storesInManifest).toContain("Store_A");
      expect(body.manifestRowCount).toBe(1);
    } finally {
      removeBatchlyCleanupFixture(batchName);
    }
  });

  test("dashboard summary shows Store A with Etsy credentials", async ({ request }) => {
    const res = await request.get("http://localhost:3000/api/dashboard/summary");
    expect(res.status()).toBe(200);
    const body = await res.json();
    // storeReadiness uses 'folder' (drive folder name) and 'isConnected' or 'shopName'
    const stores = body.storeReadiness ?? [];
    expect(body.connectedStores).toBeGreaterThanOrEqual(1);
    // At least one store has a shopName (NorthWindUS OAuth is active)
    const connected = stores.find((s) => s.isConnected || s.shopName);
    expect(connected).toBeTruthy();
  });
});

// ── Mobile / responsive viewport ─────────────────────────────────────────────

test.describe("Mobile viewport — inQueue Hub", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hub loads and workflow section visible on mobile", async ({ page }) => {
    await page.goto("http://localhost:4000");
    await expect(page.getByRole("progressbar")).toBeVisible();
    // At least one tool card should still be visible
    await expect(page.locator(".tool-card").first()).toBeVisible();
  });

  test("progress bar is accessible on mobile", async ({ page }) => {
    await page.goto("http://localhost:4000");
    const bar = page.getByRole("progressbar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuemin", "0");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  test("navigation tabs work on mobile", async ({ page }) => {
    await page.goto("http://localhost:4000");
    const storesTab = page.getByRole("button", { name: /store settings/i });
    await expect(storesTab).toBeVisible();
    await storesTab.click();
    // Safety notice should appear after switching tabs
    await expect(page.getByText(/northwindus.*store_a/i).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Mobile viewport — Inkly", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Inkly topbar is visible on mobile", async ({ page }) => {
    await page.goto("http://localhost:5500");
    await expect(page.locator(".topbar")).toBeVisible();
  });
});

test.describe("Mobile viewport — Preply", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Preply loads on mobile", async ({ page }) => {
    await page.goto("http://localhost:3001");
    await expect(page.locator("body")).toBeVisible();
    // No horizontal overflow error expected
    const overflowing = await page.evaluate(() =>
      document.body.scrollWidth > document.documentElement.clientWidth
    );
    // Allow a small tolerance for border/scrollbar
    expect(overflowing).toBe(false);
  });
});

// ── UI regression: inQueue design tokens consistent ──────────────────────────

test.describe("UI regression — design tokens", () => {
  test("Hub progress bar fill element exists and has gradient style", async ({ page }) => {
    await page.goto("http://localhost:4000");
    const fill = page.locator("#progressFill");
    // At 0% the fill is in DOM but has width 0 — check it exists and has CSS gradient
    await expect(fill).toBeAttached();
    const bg = await fill.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain("gradient");
  });

  test("Inkly uses same dark background as design system", async ({ page }) => {
    await page.goto("http://localhost:5500");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor
    );
    // Background should be dark (not white)
    expect(bg).not.toBe("rgb(255, 255, 255)");
  });
});
