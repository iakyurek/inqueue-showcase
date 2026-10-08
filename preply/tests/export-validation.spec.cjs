// @ts-check
// B2 coverage: Preply export must never silently skip a misconfigured active
// store while still writing its manifest rows. These tests drive the real page
// but exercise the pure export-contract helpers (validateExport, manifestRows,
// activeStoreExportErrors) directly via page.evaluate, so they are deterministic
// and do not mutate any persisted store config.
const { test, expect } = require('@playwright/test');
const { TEST_BASE_URL } = require('./test-paths.cjs');

const BASE_URL = TEST_BASE_URL;

// Builds a fully valid, exportable in-memory state in the page: one ACTIVE store
// (NorthWindUS = Store_A) fully configured, plus one INACTIVE store that must
// be excluded from both manifest and ZIP. Returns nothing; mutates window `state`.
const VALID_STATE_SETUP = `
  state.stores = [
    { id: 's-a', name: 'NorthwindUS', active: true, store_folder: 'Store_A', logoUrl: '/store-logos/a.png', skuRootFolderId: 'root-a' },
    { id: 's-b', name: 'InactiveStore', active: false, store_folder: 'Store_B', logoUrl: '/store-logos/b.png', skuRootFolderId: 'root-b' }
  ];
  state.uploadedDesigns = [
    { id: 'D001', filename: 'D001.png', intakeComplete: true, selectedMockups: ['m1.png'], keywords: 'a|b', title: 'T1', description: 'D1' }
  ];
  state.batch = {
    id: 'BATCH-TEST-001',
    workflowStage: 'stamped',
    reservedSkus: { D001: { 's-a': { sku: 'CU1' } } },
    stampStatus: { 's-a': { D001: 'complete' } }
  };
  state.freeShipping = { url: '/free-shipping/fs.png' };
  state.settings = { defaultListingPrice: 19.99 };
`;

async function setup(page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
}

test('B2-01 — baseline: fully configured active store yields no export errors', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    return { errors: validateExport().errors, rows: manifestRows() };
  })()`);
  expect(result.errors).toEqual([]);
  // 1 active store × 1 design = 1 row.
  expect(result.rows.length).toBe(1);
  expect(result.rows[0].store_folder).toBe('Store_A');
  expect(result.rows[0].sku).toBe('CU1');
});

test('B2-02 — active store missing store_folder blocks export', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    state.stores[0].store_folder = '';
    return { errors: validateExport().errors, rows: manifestRows() };
  })()`);
  expect(result.errors.some(e => e.includes('NorthwindUS') && e.includes('Batchly folder'))).toBe(true);
  // No manifest row may be written for a store without a folder.
  expect(result.rows.length).toBe(0);
});

test('B2-03 — active store missing logo blocks export', async ({ page }) => {
  await setup(page);
  const errors = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    state.stores[0].logoUrl = null;
    return validateExport().errors;
  })()`);
  expect(errors.some(e => e.includes('NorthwindUS') && e.includes('store logo'))).toBe(true);
});

test('B2-04 — active store missing SKU for a design blocks export', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    state.batch.reservedSkus = { D001: {} };
    return { errors: validateExport().errors, rows: manifestRows() };
  })()`);
  expect(result.errors.some(e => e.includes('NorthwindUS') && e.includes('reserved SKU for D001'))).toBe(true);
  // A design with no SKU for the active store produces no manifest row.
  expect(result.rows.length).toBe(0);
});

test('B2-05 — inactive store is excluded from manifest and produces no errors', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    // Break the inactive store completely; it must be ignored entirely.
    state.stores[1].store_folder = '';
    state.stores[1].logoUrl = null;
    return { errors: validateExport().errors, rows: manifestRows() };
  })()`);
  expect(result.errors).toEqual([]);
  expect(result.rows.some(r => r.store_folder === 'Store_B')).toBe(false);
  expect(result.rows.length).toBe(1);
});

test('B2-06 — every manifest row has a non-empty store_folder and SKU (manifest == ZIP)', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(`(() => {
    ${VALID_STATE_SETUP}
    // Two designs, one active store: manifest set must be exactly activeStores × designs.
    state.uploadedDesigns.push({ id: 'D002', filename: 'D002.png', intakeComplete: true, selectedMockups: ['m1.png'], keywords: '', title: 'T2', description: 'D2' });
    state.batch.reservedSkus.D002 = { 's-a': { sku: 'CU2' } };
    state.batch.stampStatus['s-a'].D002 = 'complete';
    const rows = manifestRows();
    return {
      errors: validateExport().errors,
      count: rows.length,
      allHaveFolder: rows.every(r => !!r.store_folder),
      allHaveSku: rows.every(r => !!r.sku)
    };
  })()`);
  expect(result.errors).toEqual([]);
  expect(result.count).toBe(2); // 1 active store × 2 designs
  expect(result.allHaveFolder).toBe(true);
  expect(result.allHaveSku).toBe(true);
});

test('B2-07 — Drive handoff is NOT called when pre-export validation fails', async ({ page }) => {
  await setup(page);
  const calls = await page.evaluate(`(async () => {
    ${VALID_STATE_SETUP}
    state.stores[0].store_folder = ''; // make export invalid
    const seen = [];
    const origFetch = window.fetch;
    window.fetch = (...args) => { seen.push(String(args[0])); return origFetch.apply(window, args); };
    try { await exportBatchZip(); } catch (e) { /* ignore */ }
    window.fetch = origFetch;
    return seen;
  })()`);
  // exportBatchZip must early-return on validation errors, before any Drive call.
  expect(calls.some(u => u.includes('/export-drive') || u.includes('/drive-export'))).toBe(false);
});
