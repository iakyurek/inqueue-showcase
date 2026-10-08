// Phase 5: Preply settings backend — persisted app settings, pending-folder
// test, handoff-mode gating, guardrails, redaction, Store_A safety, and 401s
// for the new endpoints. Runs entirely in mock Drive mode against a scratch
// data dir; no live Drive or Etsy calls.
//
// Run: node preply/tests/settings.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-settings-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.PREPLY_BATCHLY_DOWNLOADS_DIR = path.join(SCRATCH, 'batchly-downloads');
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';
const preply = await import('../server.js');

// preply/.env.local re-populates these during import (loadEnvFile); clear them
// AFTER import — the getters read process.env lazily at call time.
delete process.env.PREPLY_PENDING_BATCHES_FOLDER_ID;
delete process.env.PREPLY_BATCHLY_HANDOFF_MODE;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

console.log('Phase 5 Preply settings tests');

// ---------------------------------------------------------------------------
// Settings roundtrip + source precedence
// ---------------------------------------------------------------------------

await test('GET view: unset values fall back to defaults with source labels', async () => {
  const view = await preply.readAppSettings();
  assert.equal(view.handoffMode.value, 'local');
  assert.equal(view.handoffMode.source, 'default');
  assert.equal(view.pendingBatchesFolderId.value, '');
  assert.equal(view.pendingBatchesFolderId.source, 'default');
});

await test('env var is used when nothing is persisted', async () => {
  process.env.PREPLY_PENDING_BATCHES_FOLDER_ID = 'ENV_FOLDER_1234';
  const view = await preply.readAppSettings();
  assert.equal(view.pendingBatchesFolderId.value, 'ENV_FOLDER_1234');
  assert.equal(view.pendingBatchesFolderId.source, 'env');
});

await test('persisted folder ID overrides env; clearing reverts to env', async () => {
  await preply.saveAppSettings({ pendingBatchesFolderId: 'SAVED_FOLDER_5678' });
  let view = await preply.readAppSettings();
  assert.equal(view.pendingBatchesFolderId.value, 'SAVED_FOLDER_5678');
  assert.equal(view.pendingBatchesFolderId.source, 'settings');

  await preply.saveAppSettings({ pendingBatchesFolderId: '' });
  view = await preply.readAppSettings();
  assert.equal(view.pendingBatchesFolderId.value, 'ENV_FOLDER_1234');
  assert.equal(view.pendingBatchesFolderId.source, 'env');
});

await test('invalid folder ID is rejected with a 400-style error', async () => {
  await assert.rejects(
    () => preply.saveAppSettings({ pendingBatchesFolderId: 'no spaces!!' }),
    (err) => err.statusCode === 400 && err.code === 'INVALID_FOLDER_ID'
  );
});

await test('whitelist: unknown keys are ignored, existing settings survive', async () => {
  const before = JSON.parse(await fs.readFile(preply.SETTINGS_FILE, 'utf8'));
  await preply.saveAppSettings({ evilKey: 'x', minimumSelectedMockups: 99 });
  const after = JSON.parse(await fs.readFile(preply.SETTINGS_FILE, 'utf8'));
  assert.equal(after.evilKey, undefined);
  assert.equal(after.minimumSelectedMockups, before.minimumSelectedMockups);
});

// ---------------------------------------------------------------------------
// Pending-folder test (mock mode) + handoff mode gating
// ---------------------------------------------------------------------------

await test('handoffMode drive is blocked before a successful pending-folder test', async () => {
  await assert.rejects(
    () => preply.saveAppSettings({ handoffMode: 'drive' }),
    (err) => err.code === 'PENDING_FOLDER_UNTESTED'
  );
});

await test('mock-mode pending-folder test passes and persists last-test', async () => {
  // Clear env so the mock token is the recorded folderId.
  delete process.env.PREPLY_PENDING_BATCHES_FOLDER_ID;
  await preply.saveAppSettings({ pendingBatchesFolderId: '' });
  const result = await preply.testPendingBatchesFolder({});
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'mock');
  assert.ok(result.checkedAt);
  const view = await preply.readAppSettings();
  assert.equal(view.pendingFolderLastTest.ok, true);
});

await test('handoffMode drive is allowed after the test; getHandoffMode() reflects it', async () => {
  const saved = await preply.saveAppSettings({ handoffMode: 'drive' });
  assert.equal(saved.handoffMode.value, 'drive');
  assert.equal(saved.handoffMode.source, 'settings');
  assert.equal(preply.getHandoffMode(), 'drive');
});

await test('clearing handoffMode reverts to env fallback', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'both';
  // "both" also requires a passed test — the mock test above already recorded
  // one, but saving '' (clear) skips the gate entirely.
  await preply.saveAppSettings({ handoffMode: '' });
  assert.equal(preply.getHandoffMode(), 'both');
  assert.equal((await preply.readAppSettings()).handoffMode.source, 'env');
  delete process.env.PREPLY_BATCHLY_HANDOFF_MODE;
});

await test('invalid handoff mode is rejected', async () => {
  await assert.rejects(
    () => preply.saveAppSettings({ handoffMode: 'cloud' }),
    (err) => err.code === 'INVALID_HANDOFF_MODE'
  );
});

// ---------------------------------------------------------------------------
// Guardrail matrix
// ---------------------------------------------------------------------------

await test('guardrails: drive mode without pending folder → PENDING_FOLDER_MISSING', async () => {
  const warnings = preply.computeProductionWarnings(
    { NODE_ENV: 'development' },
    { stores: [], driveMode: 'oauth', handoffMode: 'drive', pendingFolderId: '' }
  );
  assert.ok(warnings.find(w => w.code === 'PENDING_FOLDER_MISSING' && w.level === 'error'));
});

await test('guardrails: active mock-drive store in remote mode → ACTIVE_STORE_MOCK_FOLDER', async () => {
  const warnings = preply.computeProductionWarnings(
    { NODE_ENV: 'development' },
    {
      stores: [
        { id: 'b', name: 'Store B', active: true, skuRootFolderId: 'mock-drive-b' },
        { id: 'c', name: 'Store C', active: false, skuRootFolderId: 'mock-drive-c' },
      ],
      driveMode: 'oauth', handoffMode: 'local', pendingFolderId: 'x'.repeat(12)
    }
  );
  const hits = warnings.filter(w => w.code === 'ACTIVE_STORE_MOCK_FOLDER');
  assert.equal(hits.length, 1, 'inactive stores must not warn');
  assert.ok(hits[0].message.includes('Store B'));
});

await test('guardrails: production matrix (secret, plaintext password, mock drive, local handoff, localhost redirect)', async () => {
  const warnings = preply.computeProductionWarnings(
    { NODE_ENV: 'production', INQUEUE_PASSWORD: 'plain', GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3001/cb' },
    { stores: [], driveMode: 'mock', handoffMode: 'local', pendingFolderId: '' }
  );
  for (const code of ['SESSION_SECRET_MISSING', 'PASSWORD_PLAINTEXT', 'MOCK_DRIVE_IN_PROD', 'HANDOFF_MODE_LOCAL_IN_PROD', 'REDIRECT_URI_LOCALHOST']) {
    assert.ok(warnings.find(w => w.code === code), `expected ${code} in ${JSON.stringify(warnings.map(w => w.code))}`);
  }
});

await test('guardrails: clean dev env with mock drive and local handoff → no warnings', async () => {
  const warnings = preply.computeProductionWarnings(
    { NODE_ENV: 'development', INQUEUE_SESSION_SECRET: 'x'.repeat(40) },
    { stores: [], driveMode: 'mock', handoffMode: 'local', pendingFolderId: '' }
  );
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// Existing activation gate regression (Store_B)
// ---------------------------------------------------------------------------

await test('Store_B inactive with mock-drive placeholder saves fine', async () => {
  const storesFile = path.join(SCRATCH, 'stores.json');
  await preply.readStores(); // seed the scratch stores.json
  const originalRaw = await fs.readFile(storesFile, 'utf8');
  try {
    // The scratch seed marks every store active without a Batchly folder, which
    // the activation gate rightly rejects — deactivate them for this save.
    const stores = (await preply.readStores()).map(s => ({ ...s, active: false }));
    const b = {
      id: 'store-b-test', name: 'Store B Test', code: 'SB', skuPrefix: 'SB',
      active: false, skuRootFolderId: 'mock-drive-store-b-test', store_folder: 'Store_B'
    };
    const saved = await preply.saveStores([...stores, b]);
    const savedB = saved.find(s => s.id === 'store-b-test');
    assert.ok(savedB, 'inactive Store_B config must save');
    assert.equal(savedB.active, false);
  } finally {
    await fs.writeFile(storesFile, originalRaw, 'utf8');
  }
});

await test('Store_B ACTIVE with mock-drive placeholder is blocked in remote drive mode', async () => {
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
  try {
    const store = {
      id: 'store-b-test', name: 'Store B Test', skuPrefix: 'SB', active: true,
      skuRootFolderId: 'mock-drive-store-b-test', store_folder: 'Store_B',
      logoUrl: '/store-logos/x/logo.png', logoDir: 'x'
    };
    const error = preply.activeStoreReadinessError(store, { skuPrefix: 'SB' }, []);
    assert.ok(error, 'activation must be blocked');
    assert.match(error, /placeholder/);
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
  }
});

await test('readiness report flags what an activation would need', async () => {
  const report = preply.storeReadinessReport(
    { id: 'b', name: 'B', skuPrefix: '', skuRootFolderId: 'mock-drive-b', store_folder: null, logoUrl: null },
    []
  );
  assert.equal(report.ready, false);
  assert.equal(report.usesMockFolder, true);
  assert.ok(report.missing.length >= 2);
});

// ---------------------------------------------------------------------------
// Status redaction + Store_A safety
// ---------------------------------------------------------------------------

await test('settings status contains no token material and Store_A stays byte-identical', async () => {
  await preply.readStores(); // ensure the scratch stores.json exists
  const storesBefore = await fs.readFile(path.join(SCRATCH, 'stores.json'), 'utf8');

  const status = await preply.getSettingsStatus();
  const raw = JSON.stringify(status);
  for (const needle of ['refresh_token', 'access_token', 'client_secret', 'CLIENT_SECRET']) {
    assert.ok(!raw.includes(needle), `status leaked ${needle}`);
  }
  assert.equal(status.app, 'preply');
  assert.ok(Array.isArray(status.stores));
  assert.ok(Array.isArray(status.warnings));

  // The full settings flow must never write stores.json.
  await preply.readAppSettings();
  await preply.testPendingBatchesFolder({});
  await preply.saveAppSettings({ pendingBatchesFolderId: 'FINAL_FOLDER_9999' });
  await preply.saveAppSettings({ pendingBatchesFolderId: '' });
  const storesAfter = await fs.readFile(path.join(SCRATCH, 'stores.json'), 'utf8');
  assert.equal(storesAfter, storesBefore, 'stores.json changed during settings operations');
});

// ---------------------------------------------------------------------------
// HTTP: new endpoints are behind auth
// ---------------------------------------------------------------------------

await test('unauthenticated requests to all new endpoints return 401', async () => {
  await new Promise(resolve => preply.server.listen(0, resolve));
  const port = preply.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const checks = [
      ['GET', '/api/settings'],
      ['POST', '/api/settings'],
      ['POST', '/api/settings/test-pending-folder'],
      ['GET', '/api/settings/status'],
    ];
    for (const [method, route] of checks) {
      const res = await fetch(base + route, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined
      });
      assert.equal(res.status, 401, `${method} ${route} → ${res.status}`);
      const body = await res.json();
      assert.equal(body.error, 'UNAUTHENTICATED');
    }
  } finally {
    await new Promise(resolve => preply.server.close(resolve));
  }
});

console.log('');
if (failed) { console.error(`Phase 5 Preply settings tests: FAILED (${failed})`); process.exit(1); }
console.log('Phase 5 Preply settings tests: OK');
