import { test, expect, Page } from "@playwright/test";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Auth: the middleware gates every page behind the inqueue_session cookie.
// Mint a valid test token with the same secret playwright.config.ts injects
// into the web server so the wizard page actually loads.
// ---------------------------------------------------------------------------

const E2E_SESSION_SECRET = "e2e-test-secret-e2e-test-secret-42";

function base64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintSessionCookie(): string {
  const payload = base64Url(Buffer.from(JSON.stringify({ u: "e2e-tester", exp: Math.floor(Date.now() / 1000) + 3600 })));
  const signature = base64Url(createHmac("sha256", E2E_SESSION_SECRET).update(payload).digest());
  return `${payload}.${signature}`;
}

async function authenticate(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "inqueue_session", value: mintSessionCookie(), domain: "localhost", path: "/" },
  ]);
}

// ---------------------------------------------------------------------------
// Guided batch wizard E2E (right-side inQueue pool flow).
//
// SAFETY: every API endpoint the wizard touches is mocked with page.route so
// these tests never reach Google Drive, Etsy, or the real SQLite database.
// The behaviour under test is client-side wizard/sidebar logic:
//   - inQueue pool sidebar renders
//   - Validate happens before Move to inQueue
//   - failed validation cannot move to inQueue
//   - Upload Listings is the only upload/run action
//   - Completed Batches collapsed by default
// ---------------------------------------------------------------------------

const BATCH = "E2E-TEST-BATCH-001";

function localBatch(overrides: Record<string, unknown> = {}) {
  return {
    folderName: BATCH,
    sourceDriveFolderId: "drv-e2e-1",
    sourceDriveFolderName: BATCH,
    importedAt: new Date().toISOString(),
    confirmedCompletedAt: null,
    hasManifest: true,
    manifestRowCount: 1,
    storeFoldersFound: ["Store_A"],
    detectedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    queueSection: "inqueue",
    batchStatus: "validated",
    validationStatus: "ok",
    listingCount: 1,
    completedListingCount: 0,
    totalImageCount: 8,
    rowsWithImages: 1,
    missingImageCount: 0,
    imageSummary: "8 images / 1 row",
    skuRangeSummary: "CU17",
    currentStage: "ready_to_run",
    canConfirmComplete: false,
    uploadReady: true,
    readyStoreFolders: ["Store_A"],
    uploadDisabledReason: null,
    warnings: [],
    errors: [],
    completedAt: null,
    etsyDraftResult: null,
    latestRunId: null,
    latestRunStatus: null,
    ...overrides,
  };
}

function storeResult(overrides: Record<string, unknown> = {}) {
  return {
    storeFolder: "Store_A",
    storeName: "Store A",
    storeId: "store-a-id",
    etsyConnected: true,
    etsyShopName: "NorthWindUS",
    etsySetupReady: true,
    taxonomyId: "449",
    shippingProfileId: "295614381781",
    readinessStateId: "1495676451370",
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
    ...overrides,
  };
}

function validationResult(overrides: Record<string, unknown> = {}) {
  return {
    batchFolder: BATCH,
    overallStatus: "ready",
    manifestStatus: "ok",
    manifestRowCount: 1,
    manifestErrors: [],
    manifestWarnings: [],
    storesInManifest: ["Store_A"],
    globalPreset: { exists: true, hasTemplate: true, descriptionTemplateLength: 120 },
    variationPreset: { enabled: false, ready: false, combinationCount: 0, issues: [] },
    supplementalPreset: { enabled: true, filesAvailable: 3, sizeChartCount: 3, sizeChartRequired: 3, issues: [] },
    storeResults: [storeResult()],
    validatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function runProgress(status: string, rowStatus: string) {
  const terminal = ["created", "partial", "failed", "duplicate", "skipped"].includes(rowStatus);
  return {
    runId: "e2etestrun1",
    batchFolder: BATCH,
    status,
    startedAt: new Date().toISOString(),
    completedAt: terminal ? new Date().toISOString() : null,
    totalStores: 1,
    totalRows: 1,
    attempted: terminal ? 1 : 0,
    created: rowStatus === "created" ? 1 : 0,
    skipped: 0,
    partial: 0,
    failed: 0,
    percentComplete: terminal ? 100 : 0,
    currentStore: terminal ? null : "Store_A",
    currentDesignId: terminal ? null : "D001",
    stores: [
      {
        storeRunId: "e2estore1",
        storeFolder: "Store_A",
        storeName: "Store A",
        status: terminal ? "completed" : "running",
        skipReason: null,
        attempted: terminal ? 1 : 0,
        created: rowStatus === "created" ? 1 : 0,
        skipped: 0,
        partial: 0,
        failed: 0,
        rows: [
          {
            rowId: "e2erow1",
            designId: "D001",
            sku: "CU17",
            title: "E2E Test Title From Manifest",
            status: rowStatus,
            listingId: rowStatus === "created" ? "9999999999" : null,
            imagesAttempted: 8,
            imagesUploaded: rowStatus === "created" ? 8 : 0,
            variationInventoryStatus: "sku-set",
            supplementalImageStatus: "uploaded",
            supplementalImagesAttempted: 2,
            supplementalImagesUploaded: rowStatus === "created" ? 2 : 0,
            errors: [],
            warnings: [],
          },
        ],
      },
    ],
  };
}

interface MockOptions {
  poolBatches?: ReturnType<typeof localBatch>[];
  validation?: ReturnType<typeof validationResult>;
  // When true, the fixture batch only appears in the pool AFTER import is called
  // (simulates the download-on-validate → move-to-inQueue flow).
  appearsAfterImport?: boolean;
}

async function mockApi(page: Page, opts: MockOptions = {}) {
  await authenticate(page);
  const state = { imported: false };
  const validation = opts.validation ?? validationResult();
  const basePool = opts.poolBatches ?? [];

  await page.route("**/api/readiness", (route) =>
    route.fulfill({
      json: {
        driveConnected: true,
        driveStatusLabel: "Connected",
        localBatchCount: basePool.length,
        connectedStoreCount: 1,
        readyStoreCount: 1,
        connectedStores: [{ id: "store-a-id", name: "Store A", driveFolderName: "Store_A", etsyShopName: "NorthWindUS" }],
        latestRun: null,
      },
    }),
  );

  await page.route("**/api/batches/local", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    let batches = [...basePool];
    if (opts.appearsAfterImport && state.imported && !batches.some((b) => b.folderName === BATCH)) {
      batches = [...batches, localBatch()];
    }
    return route.fulfill({ json: { batches } });
  });

  await page.route("**/api/batches/scan-drive", (route) =>
    route.fulfill({
      json: {
        batches: [
          {
            id: "drv-e2e-1",
            name: BATCH,
            modifiedTime: new Date().toISOString(),
            hasManifest: true,
            manifestRowCount: 1,
            storeFoldersDetected: ["Store_A"],
            warnings: [],
          },
        ],
      },
    }),
  );

  await page.route("**/api/batches/local/import", (route) => {
    state.imported = true;
    return route.fulfill({ json: { imported: true, batchFolder: BATCH } });
  });

  await page.route("**/api/batches/validate", (route) => route.fulfill({ json: validation }));

  await page.route("**/api/batches/runs", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { runs: [] } });
  });

  await page.route("**/api/batches/run", (route) =>
    route.fulfill({ json: { runId: "e2etestrun1", totalStores: 1, totalRows: 1 } }),
  );

  await page.route("**/api/batches/runs/e2etestrun1", (route) =>
    route.fulfill({ json: runProgress("queued", "queued") }),
  );

  await page.route("**/api/batches/runs/e2etestrun1/step", (route) =>
    route.fulfill({ json: { done: true, progress: runProgress("completed", "created") } }),
  );

  return state;
}

// ---------------------------------------------------------------------------

test.describe("guided batch wizard", () => {
  test("home: pool board is the main attraction, no Run/Upload actions leak, Completed open", async ({ page }) => {
    await mockApi(page, { poolBatches: [localBatch()] });
    await page.goto("/batches");

    await expect(page.getByTestId("step-start")).toBeVisible();
    // The wizard stepper only appears once the manual import wizard starts.
    await expect(page.getByTestId("wizard-stepper")).toHaveCount(0);

    // The wide inQueue Pool board is the home view's main content.
    const board = page.getByTestId("inqueue-pool-board");
    await expect(board).toBeVisible();
    await expect(board.getByText("inQueue Pool")).toBeVisible();
    await expect(page.getByTestId(`pool-card-${BATCH}`)).toBeVisible();
    // The manual import flow shrinks to a small header button.
    await expect(board.getByTestId("start-batch-button")).toHaveText(/upload a batch manually/i);

    // No legacy "Run Batch" button anywhere.
    await expect(page.getByRole("button", { name: /run batch/i })).toHaveCount(0);

    // Upload Listings is the only upload/run action and lives on the pool card.
    const uploadButtons = page.getByRole("button", { name: /upload listings/i });
    await expect(uploadButtons).toHaveCount(1);
    await expect(page.getByTestId(`upload-listings-button-${BATCH}`)).toBeVisible();

    // Completed Batches is promoted and open by default.
    const completed = page.getByTestId("completed-batches-section");
    await expect(completed).toBeVisible();
    await expect(completed.getByText("No completed batches yet.")).toBeVisible();
  });

  test("happy path: scan → select → Validate Batch → report before Move to inQueue → move → upload from sidebar → report", async ({ page }) => {
    await mockApi(page, { poolBatches: [], appearsAfterImport: true });
    await page.goto("/batches");

    // Pool starts empty on the home board.
    await expect(page.getByTestId("inqueue-pool-board")).toBeVisible();
    await expect(page.getByTestId(`pool-card-${BATCH}`)).toHaveCount(0);

    // Home — enter the manual import wizard.
    await page.getByTestId("start-batch-button").click();

    // Step 2 — Select. Stepper + pool sidebar appear; primary action is "Validate Batch".
    await expect(page.getByTestId("step-select")).toBeVisible();
    await expect(page.getByTestId("wizard-stepper")).toBeVisible();
    await expect(page.getByTestId("inqueue-pool-sidebar")).toBeVisible();
    const folder = page.getByTestId(`drive-folder-${BATCH}`);
    await expect(folder).toBeVisible();
    const validateBtn = page.getByTestId("validate-batch-button");
    await expect(validateBtn).toHaveText(/validate batch/i);
    await expect(validateBtn).toBeDisabled();
    await folder.click();
    await expect(validateBtn).toBeEnabled();
    await validateBtn.click();

    // Step 3 — Validation report shows BEFORE the batch is in the pool.
    await expect(page.getByTestId("step-validate")).toBeVisible();
    await expect(page.getByText("Validation Report")).toBeVisible();
    await expect(page.getByText(/Batch validation passed/i)).toBeVisible();
    // Staged batch is hidden from the pool until moved.
    await expect(page.getByTestId(`pool-card-${BATCH}`)).toHaveCount(0);
    // No upload action available yet.
    await expect(page.getByRole("button", { name: /upload listings/i })).toHaveCount(0);

    // Move to inQueue.
    const moveBtn = page.getByTestId("move-to-inqueue-button");
    await expect(moveBtn).toBeEnabled();
    await moveBtn.click();

    // Batch now appears in the pool with an Upload Listings action.
    await expect(page.getByTestId(`pool-card-${BATCH}`)).toBeVisible();
    await expect(page.getByTestId("step-start")).toBeVisible();
    const uploadBtn = page.getByTestId(`upload-listings-button-${BATCH}`);
    await expect(uploadBtn).toBeVisible();
    await uploadBtn.click();

    // Draft-only confirmation modal.
    await expect(page.getByText("This will create Etsy draft listings only. Continue?")).toBeVisible();
    await page.getByTestId("upload-confirm-button").click();

    // Report step.
    await expect(page.getByTestId("step-report")).toBeVisible();
    await expect(page.getByTestId("run-report")).toBeVisible();
    await expect(page.getByText("E2E Test Title From Manifest")).toBeVisible();
    await expect(page.getByText("CU17").first()).toBeVisible();
    await expect(page.getByTestId("start-new-batch-button")).toBeVisible();
  });

  test("failed validation cannot move to inQueue", async ({ page }) => {
    await mockApi(page, {
      poolBatches: [],
      appearsAfterImport: true,
      validation: validationResult({
        overallStatus: "failed",
        manifestStatus: "errors",
        manifestErrors: ["row 1: sku is empty"],
        storeResults: [
          storeResult({
            eligibleNotCreatedCount: 0,
            estimatedListings: 0,
            validListingsCount: 0,
            ineligibleCount: 1,
            missingSkuCount: 1,
            errors: ["1 rows have no SKU"],
          }),
        ],
      }),
    });
    await page.goto("/batches");

    await page.getByTestId("start-batch-button").click();
    await page.getByTestId(`drive-folder-${BATCH}`).click();
    await page.getByTestId("validate-batch-button").click();

    await expect(page.getByTestId("step-validate")).toBeVisible();
    await expect(page.getByTestId("validation-blocked")).toBeVisible();

    // Move to inQueue is disabled and the batch is not in the pool.
    const moveBtn = page.getByTestId("move-to-inqueue-button");
    await expect(moveBtn).toBeVisible();
    await expect(moveBtn).toBeDisabled();
    await expect(page.getByTestId("move-disabled-reason")).toBeVisible();
    await expect(page.getByTestId(`pool-card-${BATCH}`)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /upload listings/i })).toHaveCount(0);
  });

  test("non-ready pool batch shows Validate, not Upload Listings", async ({ page }) => {
    await mockApi(page, {
      poolBatches: [
        localBatch({
          validationStatus: "not_validated",
          batchStatus: "detected",
          currentStage: "added_to_inqueue",
          uploadReady: false,
          readyStoreFolders: [],
          uploadDisabledReason: "Not validated yet",
        }),
      ],
    });
    await page.goto("/batches");

    const card = page.getByTestId(`pool-card-${BATCH}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-status", "Validating");
    await expect(page.getByTestId(`revalidate-button-${BATCH}`)).toBeVisible();
    await expect(page.getByTestId(`upload-listings-button-${BATCH}`)).toHaveCount(0);
    // Remove is still available.
    await expect(page.getByTestId(`remove-button-${BATCH}`)).toBeVisible();
  });

  test("remove from inQueue opens the safe confirmation modal", async ({ page }) => {
    await mockApi(page, { poolBatches: [localBatch()] });
    await page.goto("/batches");

    await page.getByTestId(`remove-button-${BATCH}`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/delete the local Batchly workspace folder/i)).toBeVisible();
    // It does not delete Etsy drafts / Drive files.
    await expect(page.getByText(/will not delete Etsy drafts/i)).toBeVisible();
  });
});
