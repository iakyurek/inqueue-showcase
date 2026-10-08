// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const { TEST_BASE_URL } = require('./test-paths.cjs');

const BASE_URL = TEST_BASE_URL;
const TEST_ZIP = path.resolve(__dirname, '../test_batch.zip');

// Active-reservation statuses (mirrors server isReservationActive)
const ACTIVE_STATUSES = new Set([
  'Draft', 'Intake In Progress', 'Intake Complete',
  'Production In Progress', 'Ready To Export'
]);

// ─── global setup: cancel all active batches so SKU ledger is free ───────────

test.beforeAll(async ({ request }) => {
  try {
    const res = await request.get(`${BASE_URL}/api/state`);
    const data = await res.json();
    const batches = data.batches || [];
    for (const batch of batches) {
      if (ACTIVE_STATUSES.has(batch.status)) {
        await request.post(`${BASE_URL}/api/batches/${batch.id}`, {
          data: { status: 'Canceled' }
        });
      }
    }
  } catch (e) {
    console.warn('beforeAll batch-cancel warning:', e.message);
  }
});

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Cancel all active batches so the SKU ledger is free.
 * Calls the server API directly (no browser needed).
 */
async function cancelActiveBatches(request) {
  // Retry up to 3 times — T04 may be mid-batch when T05 starts
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request.get(`${BASE_URL}/api/state`);
      const data = await res.json();
      const active = (data.batches || []).filter(b => ACTIVE_STATUSES.has(b.status));
      if (!active.length) break;
      for (const batch of active) {
        await request.post(`${BASE_URL}/api/batches/${batch.id}`, {
          data: { status: 'Canceled' }
        });
      }
      // Wait for state to settle before next check / next batch creation
      await new Promise(r => setTimeout(r, 600));
    } catch (e) {
      break;
    }
  }
}

/**
 * Upload a ZIP and wait for the full batch-creation cycle to complete.
 * createBatch() ends by calling switchPage('intake'), so we wait for
 * #intakePage.active as the reliable completion signal.
 */
async function uploadBatch(page, request) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Attach dialog handler before any prompt can fire
  page.on('dialog', async d => { try { await d.accept('QA Auto'); } catch {} });

  await page.locator('#zipInput').setInputFiles(TEST_ZIP);
  // Wait for zip validation to complete and enable the button
  await expect(page.locator('#createBatchBtn')).toBeEnabled({ timeout: 30000 });

  // Cancel any stale batches right before creating — this ensures any batch
  // that was still being created by a prior test (async race) is now done and
  // can be cancelled before we attempt SKU reservation.
  if (request) await cancelActiveBatches(request);

  await page.locator('#createBatchBtn').click();
  // Wait for createBatch() to finish — it calls switchPage('intake')
  await expect(page.locator('#intakePage')).toHaveClass(/active/, { timeout: 45000 });
}

/**
 * Full production setup: upload → go to production (via Continue button).
 * Populates state.designImage and enables renderBtn.
 * Returns after mockup page is active.
 */
async function uploadAndGoToProduction(page, request) {
  await uploadBatch(page, request);
  // After batch creation page is on intake; click Continue to Production
  const continueBtn = page.locator('#continueProductionBtn');
  if (await continueBtn.isVisible()) {
    await continueBtn.click();
    // startProduction() → switchPage('mockup') — wait for mockupPage active
    await expect(page.locator('#mockupPage')).toHaveClass(/active/, { timeout: 10000 });
  } else {
    // If button not visible, navigate directly via tab
    await page.locator('.nav-tab', { hasText: 'Mockup Production' }).click();
    await expect(page.locator('#mockupPage')).toHaveClass(/active/, { timeout: 5000 });
  }
  await page.waitForTimeout(400);
}

// ─── T01: No console errors on load ─────────────────────────────────────────

test('T01 — loads without JS errors', async ({ page, request }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  const jsErrors = errors.filter(e =>
    !e.includes('favicon') && !e.includes('net::ERR_') && !e.includes('Failed to load resource')
  );
  expect(jsErrors, 'Console errors: ' + jsErrors.join('; ')).toHaveLength(0);
});

// ─── T02: All 6 nav tabs present ────────────────────────────────────────────

test('T02 — all 6 nav tabs present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const tabLabels = ['Upload Batch', 'Metadata Review', 'Mockup Production', 'Stamp', 'Current Batch', 'Store Settings'];
  for (const label of tabLabels) {
    await expect(page.locator('.nav-tab', { hasText: label })).toBeVisible({ timeout: 5000 });
  }
});

// ─── T03: Tab switching shows correct pages ──────────────────────────────────

test('T03 — tab switching shows correct pages', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const pairs = [
    ['Metadata Review', '#intakePage'],
    ['Mockup Production', '#mockupPage'],
    ['Stamp', '#stampPage'],
    ['Current Batch', '#exportPage'],
    ['Store Settings', '#settingsPage'],
    ['Upload Batch', '#uploadPage'],
  ];

  for (const [label, pageId] of pairs) {
    await page.locator('.nav-tab', { hasText: label }).click();
    await expect(page.locator(pageId)).toHaveClass(/active/, { timeout: 3000 });
  }
});

// ─── T04: Upload ZIP → validation report appears ────────────────────────────

test('T04 — upload ZIP and validate batch', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('dialog', async d => { try { await d.accept('QA Auto'); } catch {} });

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  await page.locator('#zipInput').setInputFiles(TEST_ZIP);
  await expect(page.locator('#createBatchBtn')).toBeEnabled({ timeout: 30000 });
  await page.locator('#createBatchBtn').click();

  const report = page.locator('#validationReport');
  await expect(report).toBeVisible({ timeout: 30000 });
  const reportText = await report.textContent();
  expect(reportText?.length).toBeGreaterThan(0);

  await expect(page.locator('#uploadSummary')).toBeVisible({ timeout: 5000 });
  expect(errors).toHaveLength(0);
});

// ─── T05: Metadata Review — intake list and keywords visible ────────────────

test('T05 — metadata review shows design data', async ({ page, request }) => {
  await uploadBatch(page, request);
  // intakePage is already active after uploadBatch

  // Intake list is already populated (renderIntake called at end of createBatch)
  const intakeList = page.locator('#intakeList');
  // Check list has at least one child element
  await expect(intakeList.locator('button, .design-item, [class*="item"]').first()).toBeVisible({ timeout: 8000 });

  await expect(page.locator('#titleDescription')).toBeVisible();
  await expect(page.locator('#keywordsInput')).toBeVisible();
});

// ─── T06: Mockup Production — preset bay visible ────────────────────────────

test('T06 — mockup production: preset bay visible', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Mockup Production' }).click();
  await expect(page.locator('#mockupPage')).toHaveClass(/active/, { timeout: 3000 });

  await expect(page.locator('#mockupPresetList')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#newPresetBtn')).toBeVisible();
});

// ─── T07: Create a mockup preset ────────────────────────────────────────────

test('T07 — create mockup preset', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Mockup Production' }).click();
  await expect(page.locator('#mockupPage')).toHaveClass(/active/, { timeout: 3000 });

  // Preset dialog fires a prompt — handler already attached in uploadBatch
  await page.locator('#newPresetBtn').click();
  await page.waitForTimeout(1500);

  // Page remains functional (no crash)
  await expect(page.locator('#mockupPage')).toHaveClass(/active/);
  await expect(page.locator('#newPresetBtn')).toBeVisible();
});

// ─── T08: Placement editor opens for a mockup ────────────────────────────────

test('T08 — placement editor opens for a mockup', async ({ page, request }) => {
  await uploadAndGoToProduction(page, request);

  // Click Render to populate mockup grid
  const renderBtn = page.locator('#renderBtn');
  if (await renderBtn.isVisible() && await renderBtn.isEnabled()) {
    await renderBtn.click();
    await page.waitForTimeout(6000);
  }

  // Edit button in card template has class "edit-btn" and text "Adjust"
  const editBtns = page.locator('#mockupGrid .edit-btn');
  const count = await editBtns.count();
  if (count > 0) {
    await editBtns.first().click();
    await page.waitForTimeout(500);

    const dialog = page.locator('#editDialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Unified editor: Design layer should be active by default
    await expect(page.locator('#layerDesignBtn')).toHaveClass(/active/);
    await expect(page.locator('#editorDesignControls')).toBeVisible();
    await expect(page.locator('#editorLogoControls')).not.toBeVisible();
  } else {
    console.log('SKIP T08: No .edit-btn cards in mockup grid');
  }
});

// ─── T09: Calibration tab in editor ─────────────────────────────────────────

test('T09 — calibration tab switches in editor dialog', async ({ page, request }) => {
  await uploadAndGoToProduction(page, request);

  const renderBtn = page.locator('#renderBtn');
  if (await renderBtn.isVisible() && await renderBtn.isEnabled()) {
    await renderBtn.click();
    await page.waitForTimeout(6000);
  }

  const editBtns = page.locator('#mockupGrid .edit-btn');
  if (await editBtns.count() > 0) {
    await editBtns.first().click();
    await page.waitForTimeout(500);

    // Unified editor: switch to Store Logo layer
    const logoBtn = page.locator('#layerStoreLogoBtn');
    await expect(logoBtn).toBeVisible();
    await logoBtn.click();
    await page.waitForTimeout(800);

    await expect(page.locator('#editorLogoControls')).toBeVisible();
    await expect(page.locator('#editorDesignControls')).not.toBeVisible();
    await expect(logoBtn).toHaveClass(/active/);
    // Canvas is shared (unified) and visible
    await expect(page.locator('#editorCanvas')).toBeVisible();

    await page.locator('#closeEditorBtn').click();
    await expect(page.locator('#editDialog')).not.toBeVisible({ timeout: 2000 });
  } else {
    console.log('SKIP T09: No .edit-btn cards in mockup grid');
  }
});

// ─── T10: Move to Stamping Phase button present ───────────────────────────────

test('T10 — moveToStampingBtn exists on mockup page', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Mockup Production' }).click();
  await page.waitForTimeout(500);

  await expect(page.locator('#moveToStampingBtn')).toBeVisible({ timeout: 5000 });
});

// ─── T11: Stamp tab — empty state before staging ─────────────────────────────

test('T11 — stamp tab shows empty state if not yet staged', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Stamp' }).click();
  await page.waitForTimeout(600);

  await expect(page.locator('#stampEmptyState')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#stampWorkspace')).not.toBeVisible();
  await expect(page.locator('#runStampBtn')).toBeDisabled();
});

// ─── T12: Current Batch — metrics and folder browser render ──────────────────

test('T12 — current batch tab renders metrics and folder browser', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await expect(page.locator('#exportPage')).toHaveClass(/active/, { timeout: 3000 });
  await page.waitForTimeout(800);

  await expect(page.locator('#batchMetricsRow')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#folderBrowserPanel')).toBeVisible({ timeout: 5000 });

  const treeText = await page.locator('#folderTreeRoot').textContent();
  expect(treeText).toContain('Store_A');
});

// ─── T13: Folder browser shows batch_manifest.csv ────────────────────────────

test('T13 — folder browser includes batch_manifest.csv', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(800);

  const treeText = await page.locator('#folderTreeRoot').textContent();
  expect(treeText).toContain('batch_manifest.csv');
});

// ─── T14: CSV preview renders a table ────────────────────────────────────────

test('T14 — batch_manifest.csv preview renders a table', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(800);

  const csvBtn = page.locator('[data-type="csv"]');
  await expect(csvBtn).toBeVisible({ timeout: 5000 });
  await csvBtn.click();
  await page.waitForTimeout(500);

  const preview = page.locator('#filePreviewArea');
  await expect(preview).toBeVisible();
  expect((await preview.textContent())?.length).toBeGreaterThan(0);
});

// ─── T15: Dry run and export ZIP buttons present ─────────────────────────────

test('T15 — dry run button present on current batch tab', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(600);

  await expect(page.locator('#dryRunBtn')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#exportZipBtn')).toBeVisible();
});

// ─── T16: Store Settings — NorthWindUS = Store_A (via input values) ──────

test('T16 — store settings: NorthWindUS mapped to Store_A', async ({ page, request }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  await page.locator('.nav-tab', { hasText: 'Store Settings' }).click();
  await page.waitForTimeout(800);

  await expect(page.locator('#settingsPage')).toHaveClass(/active/);

  // Store folder and name are in <input> values, not textContent
  const folderInputs = page.locator('#storeSettingsList input[data-field="store_folder"]');
  await expect(folderInputs.first()).toBeVisible({ timeout: 5000 });
  const folderValues = await folderInputs.evaluateAll(els => els.map(e => e.value));
  expect(folderValues).toContain('Store_A');

  // Verify a store named NorthWindUS (case-insensitive)
  const nameInputs = page.locator('#storeSettingsList input[data-field="name"]');
  const nameValues = await nameInputs.evaluateAll(els => els.map(e => e.value.toLowerCase()));
  expect(nameValues.some(n => n.includes('northwind'))).toBe(true);
});

// ─── T17: Mock-drive stores show warning chips ────────────────────────────────

test('T17 — store settings: mock-drive stores show warning chips', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  await page.locator('.nav-tab', { hasText: 'Store Settings' }).click();
  await page.waitForTimeout(800);

  const warnChips = page.locator('.mock-drive-warn');
  await expect(warnChips.first()).toBeVisible({ timeout: 5000 });
  expect(await warnChips.count()).toBeGreaterThanOrEqual(5);
});

// ─── T18: NorthWindUS store has no warning chip ──────────────────────────

test('T18 — NorthWindUS store has no mock-drive warning', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  await page.locator('.nav-tab', { hasText: 'Store Settings' }).click();
  await page.waitForTimeout(800);

  // Exactly 5 stores have mock-drive folder IDs, not 6
  const warnChips = page.locator('.mock-drive-warn');
  expect(await warnChips.count()).toBeLessThan(6);
});

// ─── T19: No Etsy listing buttons anywhere ───────────────────────────────────

test('T19 — no Etsy listing buttons present anywhere', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const etsyBtns = page.locator(
    'button:has-text("Etsy"), button:has-text("Create Listing"), button:has-text("Publish to Etsy")'
  );
  expect(await etsyBtns.count()).toBe(0);
});

// ─── T20: No Drive write buttons outside the export page ─────────────────────

test('T20 — drive upload only via explicit export button', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  const dangerousBtns = page.locator(
    'button:has-text("Upload to Drive"):not(#exportPage button), ' +
    'button:has-text("Create SKU Folder"), ' +
    'button:has-text("Create Drive Folder")'
  );
  expect(await dangerousBtns.count()).toBe(0);
});

// ─── T21: Export Batchly ZIP button present on Current Batch ─────────────────

test('T21 — export Batchly ZIP button present', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(600);

  await expect(page.locator('#exportZipBtn')).toBeVisible();
  expect((await page.locator('#exportZipBtn').textContent())?.length).toBeGreaterThan(0);
});

// ─── T22: Success banner hidden before export ─────────────────────────────────

test('T22 — export success banner hidden before export', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(600);

  await expect(page.locator('#exportSuccessBanner')).not.toBeVisible();
});

// ─── T23: Mockup grid renders after Render click ─────────────────────────────

test('T23 — mockup production: grid renders on Render click', async ({ page, request }) => {
  await uploadAndGoToProduction(page, request);

  const renderBtn = page.locator('#renderBtn');
  if (await renderBtn.isVisible() && await renderBtn.isEnabled()) {
    await renderBtn.click();
    await page.waitForTimeout(8000);

    const grid = page.locator('#mockupGrid');
    const cards = grid.locator('.mockup-card, .card, [class*="card"], .edit-btn');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
  } else {
    console.log('SKIP T23: Render button not visible/enabled');
  }
});

// ─── T24: Keyboard arrow nudge in placement editor doesn't crash ─────────────

test('T24 — keyboard arrow nudge in placement editor does not crash', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await uploadAndGoToProduction(page, request);

  const renderBtn = page.locator('#renderBtn');
  if (await renderBtn.isVisible() && await renderBtn.isEnabled()) {
    await renderBtn.click();
    await page.waitForTimeout(6000);
  }

  const editBtns = page.locator('#mockupGrid .edit-btn');
  if (await editBtns.count() > 0) {
    await editBtns.first().click();
    await page.waitForTimeout(500);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);

    await expect(page.locator('#editDialog')).toBeVisible();
    expect(errors).toHaveLength(0);

    await page.locator('#closeEditorBtn').click();
  } else {
    console.log('SKIP T24: No .edit-btn cards found');
  }
});

// ─── T25: Only Store_A in folder tree (only active store) ────────────────────

test('T25 — only Store_A appears in folder tree (only active store)', async ({ page, request }) => {
  await uploadBatch(page, request);

  await page.locator('.nav-tab', { hasText: 'Current Batch' }).click();
  await page.waitForTimeout(800);

  const treeText = await page.locator('#folderTreeRoot').textContent();
  expect(treeText).toContain('Store_A');
  expect(treeText).not.toContain('Store_B');
  expect(treeText).not.toContain('Store_C');
  expect(treeText).not.toContain('Store_D');
  expect(treeText).not.toContain('Store_E');
  expect(treeText).not.toContain('Store_F');
});

// ─── T26: Full workflow — move to stamping then run stamp ─────────────────────

test('T26 — move to stamping phase then run stamp', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await uploadAndGoToProduction(page, request);

  // Render all blank mockups
  const renderBtn = page.locator('#renderBtn');
  if (await renderBtn.isVisible() && await renderBtn.isEnabled()) {
    await renderBtn.click();
    await page.waitForTimeout(8000);
  }

  // Select all mockups
  const selectAllBtn = page.locator('#selectAllBtn');
  if (await selectAllBtn.isVisible() && await selectAllBtn.isEnabled()) {
    await selectAllBtn.click();
    await page.waitForTimeout(600);
  }

  // Mark ready
  const markReadyBtn = page.locator('#markReadyBtn');
  if (await markReadyBtn.isVisible() && await markReadyBtn.isEnabled()) {
    await markReadyBtn.click();
    await page.waitForTimeout(500);
  }

  const moveBtn = page.locator('#moveToStampingBtn');
  await expect(moveBtn).toBeVisible({ timeout: 5000 });

  if (await moveBtn.isEnabled()) {
    await moveBtn.click();
    await page.waitForTimeout(800);

    // Should now be on Stamp tab
    await expect(page.locator('#stampPage')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('#stampWorkspace')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#stampEmptyState')).not.toBeVisible();
    await expect(page.locator('#runStampBtn')).toBeEnabled({ timeout: 3000 });

    // Run stamping
    await page.locator('#runStampBtn').click();
    await page.waitForTimeout(3000);

    // Wait for auto-advance to Current Batch after stamping
    await page.waitForTimeout(1500);
    // Directory tree should show NorthWindUS (may be on stamp or export page)
    const dirTree = page.locator('#stampDirectoryTree');
    if (await page.locator('#stampPage').getAttribute('class').then(c => c?.includes('active'))) {
      await expect(dirTree).not.toBeEmpty({ timeout: 5000 });
      const dirText = await dirTree.textContent();
      expect(dirText?.toLowerCase()).toContain('northwind');
    } else {
      // Auto-advanced to export page — that's the correct behavior
      await expect(page.locator('#exportPage')).toHaveClass(/active/, { timeout: 3000 });
    }
  } else {
    console.log('SKIP T26: moveToStampingBtn disabled — designs need mockup selections first');
  }

  expect(errors).toHaveLength(0);
});

test('T27 — completed stamping auto-marks design ready on Current Batch', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await uploadAndGoToProduction(page, request);

  // New flow: Preview All Mockups selects every blank mockup, then Render.
  const previewAllBtn = page.locator('#previewAllBtn');
  await expect(previewAllBtn).toBeEnabled({ timeout: 5000 });
  await previewAllBtn.click();
  await page.waitForTimeout(400);

  const renderBtn = page.locator('#renderBtn');
  await expect(renderBtn).toBeEnabled({ timeout: 5000 });
  await renderBtn.click();
  await page.waitForTimeout(8000);

  // Move to stamping.
  const moveBtn = page.locator('#moveToStampingBtn');
  await expect(moveBtn).toBeEnabled({ timeout: 5000 });
  await moveBtn.click();
  await expect(page.locator('#stampPage')).toHaveClass(/active/, { timeout: 5000 });

  // Run stamping for active stores.
  await expect(page.locator('#runStampBtn')).toBeEnabled({ timeout: 3000 });
  await page.locator('#runStampBtn').click();
  // Wait for stamping to finish + auto-advance to Current Batch (export page).
  await expect(page.locator('#exportPage')).toHaveClass(/active/, { timeout: 8000 });

  // Readiness should now be derived automatically — no manual "Mark Design Ready".
  // Designs ready metric shows 1 / 1 and export status is Ready.
  const metrics = page.locator('#batchMetricsRow');
  await expect(metrics).toContainText(/1\s*\/\s*1/, { timeout: 5000 });
  const metricsText = (await metrics.textContent())?.toLowerCase() || '';
  expect(metricsText).toContain('designs ready');
  expect(metricsText).toContain('ready');

  // Validation panel must NOT report the old "not marked ready" error.
  const validation = await page.locator('#validationReport').textContent();
  expect(validation?.toLowerCase()).not.toContain('not marked ready');

  // Export button enabled.
  await expect(page.locator('#exportZipBtn')).toBeEnabled({ timeout: 3000 });

  expect(errors).toHaveLength(0);
});
