// Hub store-config sync tests — dry-run vs apply, invariants, backups, and the
// read-only Drive helpers the hub proxies to. Runs entirely against a scratch
// data dir + mock Drive; no live Google calls, no live stores.json.
// Run: node tests/hub-config-sync.test.mjs   (from preply/)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-hubsync-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_STORE_CONFIG_SOURCE = 'local'; // default: dry-run

// Controlled fixture mirroring the live stores.json shape (real logoDirs so
// the activation gate's logo check passes).
const FIXTURE = [
  {
    id: 'northwindus-logo', name: 'NorthwindUS', storeName: 'NorthwindUS',
    code: 'CU', storeCode: 'CU', skuPrefix: 'CU', sku_prefix: 'CU', latestSkuNumber: 0,
    active: true, active_status: true, logoDir: 'northwindUS-logo',
    skuRootFolderId: 'mock-drive-northwindus-logo', sku_root_folder_id: 'mock-drive-northwindus-logo',
    latestDetectedSku: 'CU16', latestDetectedNumber: 16, nextSkuPreview: 'CU17',
    skuScanStatus: 'completed', notes: '', store_folder: 'Store_A',
  },
  {
    id: 'maplegoods-logo', name: 'Maplegoods', storeName: 'Maplegoods',
    code: 'CBP', storeCode: 'CBP', skuPrefix: 'CBP', sku_prefix: 'CBP', latestSkuNumber: 0,
    active: false, active_status: false, logoDir: 'maplegoods-logo',
    skuRootFolderId: 'mock-drive-maplegoods-logo', sku_root_folder_id: 'mock-drive-maplegoods-logo',
    notes: '', store_folder: 'Store_B',
  },
];
fsSync.writeFileSync(path.join(SCRATCH, 'stores.json'), JSON.stringify(FIXTURE, null, 2));

const preply = await import('../server.js');
const {
  applyHubConfigSync, computeHubConfigDiff, driveTestFolder, driveInferPrefix,
  readStores, HUB_CONFIG_STATE_FILE, STORES_BACKUP_DIR,
} = preply;

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

function hubPayload(configVersion, overrides = {}) {
  return {
    configVersion,
    generatedAt: new Date().toISOString(),
    stores: [
      {
        slot: 'Store_A', displayName: 'NorthwindUS', enabled: true, skuPrefix: 'CU',
        driveFolderId: 'mock-drive-northwindus-logo', notes: '',
        etsyIds: { taxonomyId: 1, shippingProfileId: 2, readinessStateId: 3, returnPolicyId: null, sectionId: null },
        ...overrides.Store_A,
      },
      {
        slot: 'Store_B', displayName: 'Maplegoods', enabled: false, skuPrefix: 'CBP',
        driveFolderId: 'mock-drive-maplegoods-logo', notes: '',
        etsyIds: {},
        ...overrides.Store_B,
      },
    ],
    presets: { listing: {}, variation: {}, supplemental: {} },
  };
}

console.log('preply hub-config sync tests');

await test('identical payload → empty diff (the flip-runbook check)', async () => {
  const stores = await readStores();
  const diff = computeHubConfigDiff(stores, hubPayload(1));
  assert.deepEqual(diff, [], `expected empty diff, got ${JSON.stringify(diff)}`);
});

await test('dry-run mode: reports diff, writes nothing', async () => {
  const before = fsSync.readFileSync(path.join(SCRATCH, 'stores.json'), 'utf8');
  const result = await applyHubConfigSync(hubPayload(2, { Store_B: { displayName: 'Maple Renamed', notes: 'hub note' } }));
  assert.equal(result.applied, false);
  assert.equal(result.mode, 'dry-run');
  const fields = result.diff.map((d) => `${d.slot}.${d.field}`);
  assert.deepEqual(fields.sort(), ['Store_B.displayName', 'Store_B.notes']);
  assert.equal(fsSync.readFileSync(path.join(SCRATCH, 'stores.json'), 'utf8'), before, 'stores.json must be untouched');
  assert.ok(!fsSync.existsSync(HUB_CONFIG_STATE_FILE), 'no version state in dry-run');
});

await test('invalid payloads rejected', async () => {
  assert.equal((await applyHubConfigSync(null)).applied, false);
  assert.equal((await applyHubConfigSync({ configVersion: -1, stores: [] })).applied, false);
  const badSlot = await applyHubConfigSync({ configVersion: 1, stores: [{ slot: 'Store_G' }] });
  assert.equal(badSlot.applied, false);
  assert.ok(badSlot.error.includes('invalid'));
});

await test('apply mode: maps hub fields via saveStores, preserves scan/logo fields', async () => {
  process.env.INQUEUE_STORE_CONFIG_SOURCE = 'hub';
  const result = await applyHubConfigSync(hubPayload(3, { Store_B: { displayName: 'Maple Renamed', notes: 'hub note' } }));
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.mode, 'hub');
  assert.equal(result.appliedVersion, 3);
  const stores = await readStores();
  const b = stores.find((s) => s.store_folder === 'Store_B');
  assert.equal(b.name, 'Maple Renamed');
  assert.equal(b.notes, 'hub note');
  const a = stores.find((s) => s.store_folder === 'Store_A');
  assert.equal(a.active, true);
  assert.equal(a.latestDetectedSku, 'CU16', 'scan state must be merge-preserved');
  assert.equal(a.id, 'northwindus-logo', 'record id must be preserved');
  const state = JSON.parse(fsSync.readFileSync(HUB_CONFIG_STATE_FILE, 'utf8'));
  assert.equal(state.lastAppliedVersion, 3);
});

await test('apply creates a timestamped backup of stores.json', async () => {
  const backups = (await fs.readdir(STORES_BACKUP_DIR)).filter((n) => n.startsWith('stores-'));
  assert.ok(backups.length >= 1, 'expected at least one backup');
  const restored = JSON.parse(fsSync.readFileSync(path.join(STORES_BACKUP_DIR, backups[backups.length - 1]), 'utf8'));
  assert.ok(Array.isArray(restored) && restored.length === 2, 'backup must be the pre-apply stores.json');
});

await test('stale configVersion rejected after an apply', async () => {
  const result = await applyHubConfigSync(hubPayload(2));
  assert.equal(result.applied, false);
  assert.equal(result.error, 'stale');
  assert.equal(result.appliedVersion, 3);
});

await test('activation gate still guards: enabling a store with no prefix fails atomically', async () => {
  const before = fsSync.readFileSync(path.join(SCRATCH, 'stores.json'), 'utf8');
  const result = await applyHubConfigSync(hubPayload(4, { Store_B: { enabled: true, skuPrefix: '' } }));
  assert.equal(result.applied, false, 'gate must reject');
  assert.ok(result.error.includes('Cannot activate'), result.error);
  assert.equal(fsSync.readFileSync(path.join(SCRATCH, 'stores.json'), 'utf8'), before, 'stores.json must be untouched on gate rejection');
  // Version must NOT advance on a failed apply.
  const state = JSON.parse(fsSync.readFileSync(HUB_CONFIG_STATE_FILE, 'utf8'));
  assert.equal(state.lastAppliedVersion, 3);
});

await test('re-applying the same version is idempotent', async () => {
  const result = await applyHubConfigSync(hubPayload(3));
  assert.equal(result.applied, true);
  const stores = await readStores();
  assert.equal(stores.find((s) => s.store_folder === 'Store_A').name, 'NorthwindUS');
});

// ---------------------------------------------------------------------------
// Drive helpers (mock mode, read-only)
// ---------------------------------------------------------------------------

await test('driveTestFolder: ok for an existing mock folder, no creation on miss', async () => {
  const mockRoot = path.join(SCRATCH, 'mock-drive', 'mock-drive-northwindus-logo');
  await fs.mkdir(mockRoot, { recursive: true });
  const ok = await driveTestFolder('mock-drive-northwindus-logo');
  assert.equal(ok.ok, true);
  const missPath = path.join(SCRATCH, 'mock-drive', 'never-created-folder-id');
  const miss = await driveTestFolder('never-created-folder-id');
  assert.equal(miss.ok, false);
  assert.ok(!fsSync.existsSync(missPath), 'a failed test must not create the folder');
});

await test('driveTestFolder: rejects malformed IDs', async () => {
  for (const bad of ['', 'a b c', 'x', null, 'has/slash']) {
    const r = await driveTestFolder(bad);
    assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

await test('driveInferPrefix: extracts candidates from SKU-shaped child folders', async () => {
  const mockRoot = path.join(SCRATCH, 'mock-drive', 'mock-drive-northwindus-logo');
  for (const name of ['CU1', 'CU2', 'CU16', 'XX3', 'notes', '_archive']) {
    await fs.mkdir(path.join(mockRoot, name), { recursive: true });
  }
  const result = await driveInferPrefix('mock-drive-northwindus-logo');
  assert.equal(result.ok, true);
  assert.equal(result.candidates[0].prefix, 'CU');
  assert.equal(result.candidates[0].count, 3);
  assert.equal(result.candidates[0].maxNumber, 16);
  assert.equal(result.candidates[0].example, 'CU16');
  assert.equal(result.candidates[1].prefix, 'XX');
});

// ---------------------------------------------------------------------------
// Drive credential resolution for the hub's read-only checks (remote modes).
// No network: every client factory fails because no credentials exist in the
// scratch env, which is exactly the production symptom we are fixing.
// ---------------------------------------------------------------------------

await test('remote mode with no credentials → DRIVE_NOT_CONFIGURED + actionable instructions', async () => {
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = path.join(SCRATCH, 'no-such-key.json');
  try {
    const result = await driveTestFolder('1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DRIVE_NOT_CONFIGURED');
    // The message must name the service and the exact env vars / file to set.
    assert.match(result.detail, /Preply/);
    assert.match(result.detail, /GOOGLE_SERVICE_ACCOUNT_KEY_PATH/);
    assert.match(result.detail, /GOOGLE_OAUTH_CLIENT_ID/);
    assert.match(result.detail, /GOOGLE_OAUTH_CLIENT_SECRET/);
    // And it must show what was actually tried (both credential paths).
    assert.match(result.detail, /Tried:/);
    assert.match(result.detail, /oauth:/);
    assert.match(result.detail, /service_account:/);
    // Same contract for the prefix scan.
    const infer = await driveInferPrefix('1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV');
    assert.equal(infer.ok, false);
    assert.equal(infer.code, 'DRIVE_NOT_CONFIGURED');
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  }
});

await test('read-only client falls back to the service account when OAuth is unconfigured', async () => {
  // OAuth mode, no OAuth client, but a service-account key IS present: a
  // read-only folder check must use the service account rather than failing
  // with "OAuth client is not configured".
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
  const keyPath = path.join(SCRATCH, 'fake-sa.json');
  fsSync.writeFileSync(keyPath, JSON.stringify({
    type: 'service_account',
    client_email: 'preply-drive-bot@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
    project_id: 'test',
  }));
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = keyPath;
  try {
    const client = await preply.getReadOnlyDriveClient();
    assert.equal(client.source, 'service_account', 'must fall back to the service account for reads');
    assert.equal(client.clientEmail, 'preply-drive-bot@example.iam.gserviceaccount.com');
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  }
});

fsSync.rmSync(SCRATCH, { recursive: true, force: true });
console.log('');
await test('apply adopts legacy no-slot records by name and deactivates unclaimed actives', async () => {
  process.env.INQUEUE_STORE_CONFIG_SOURCE = 'hub';
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock'; // earlier tests switch to remote mode
  await fs.mkdir(SCRATCH, { recursive: true });
  // Production shape that deadlocked the sync: auto-seeded records, ACTIVE,
  // placeholder folders, and NO store_folder — unaddressable by slot matching.
  const legacy = [
    {
      id: 'northwindus-logo', name: 'NorthwindUS', code: 'CU', skuPrefix: 'CU',
      active: true, logoDir: 'northwindUS-logo',
      skuRootFolderId: 'mock-drive-northwindus-logo',
      latestDetectedSku: 'CU16', latestDetectedNumber: 16, skuScanStatus: 'completed',
    },
    {
      id: 'cedarknit-logo', name: 'Cedarknit', code: 'C', skuPrefix: 'C',
      active: true, logoDir: 'cedarknit-logo',
      skuRootFolderId: 'mock-drive-cedarknit-logo',
    },
  ];
  await fs.writeFile(path.join(SCRATCH, 'stores.json'), JSON.stringify(legacy, null, 2));

  const result = await applyHubConfigSync(hubPayload(10));
  assert.equal(result.applied, true, `apply failed: ${result.error}`);

  const stores = await readStores();
  const cuRecords = stores.filter(s => s.name === 'NorthwindUS');
  assert.equal(cuRecords.length, 1, 'name match must adopt the legacy record, not duplicate it');
  const cu = cuRecords[0];
  assert.equal(cu.store_folder, 'Store_A');
  assert.equal(cu.active, true);
  assert.equal(cu.latestDetectedSku, 'CU16', 'adoption preserves SKU-scan history');

  const cozy = stores.find(s => s.name === 'Cedarknit');
  assert.equal(cozy.active, false, 'stores the hub does not claim are force-deactivated');
});

if (failed) { console.error(`preply hub-config sync tests: FAILED (${failed})`); process.exit(1); }
console.log('preply hub-config sync tests: OK');
process.exit(0);
