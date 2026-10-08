// Diagnostics writes (Drive tests / SKU scans) must persist even when the
// store list contains a legacy invalid-active store that the saveStores
// activation gate would reject. Regression test for the production 500 on
// Test Connection while Cedarknit sat active with a placeholder folder.
//
// Run: node preply/tests/diagnostics-gate.test.mjs

import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-diag-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.PREPLY_BATCHLY_DOWNLOADS_DIR = path.join(SCRATCH, 'batchly-downloads');
// Remote mode makes placeholder folder IDs invalid for ACTIVE stores — the
// exact production condition that used to break every diagnostics save.
process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';

const preply = await import('../server.js');
const { saveStores, readStores, patchStoreScanState } = preply;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

// Seed stores.json directly (bypassing the gate) with a legacy invalid state:
// an ACTIVE store still on a placeholder folder ID.
const stores = [
  {
    id: 'legacy-bad', name: 'LegacyBad', code: 'LB', skuPrefix: 'LB',
    active: true, skuRootFolderId: 'mock-drive-legacy-bad', store_folder: 'Store_C',
  },
  {
    id: 'good-store', name: 'GoodStore', code: 'GS', skuPrefix: 'GS',
    active: false, skuRootFolderId: 'mock-drive-good-store', store_folder: 'Store_D',
  },
];
fsSync.mkdirSync(SCRATCH, { recursive: true });
fsSync.writeFileSync(path.join(SCRATCH, 'stores.json'), JSON.stringify(stores, null, 2));

await test('precondition: saveStores rejects the legacy invalid-active list', async () => {
  const current = await readStores();
  await assert.rejects(() => saveStores(current), /Cannot activate/);
});

await test('patchStoreScanState persists scan metadata despite the invalid-active store', async () => {
  const updated = await patchStoreScanState('good-store', {
    skuScanStatus: 'failed',
    skuScanError: 'Drive folder not found',
    lastSkuScanAt: '2026-07-13T00:00:00.000Z',
  });
  assert.equal(updated.skuScanStatus, 'failed');
  assert.equal(updated.skuScanError, 'Drive folder not found');

  const persisted = (await readStores()).find(s => s.id === 'good-store');
  assert.equal(persisted.skuScanStatus, 'failed');
  assert.equal(persisted.skuScanError, 'Drive folder not found');
  // The legacy store is untouched — still present, still active.
  const legacy = (await readStores()).find(s => s.id === 'legacy-bad');
  assert.equal(legacy.active, true);
});

await test('patchStoreScanState on the invalid store itself also works', async () => {
  const updated = await patchStoreScanState('legacy-bad', { skuScanStatus: 'connection_ok', skuScanError: '' });
  assert.equal(updated.skuScanStatus, 'connection_ok');
});

await test('patchStoreScanState returns null for unknown store ids', async () => {
  assert.equal(await patchStoreScanState('nope', {}), null);
});

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1); }
console.log('diagnostics-gate: all tests passed');
process.exit(0);
