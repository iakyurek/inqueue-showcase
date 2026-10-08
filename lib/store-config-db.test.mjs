// Unit tests for lib/db.js — JSON adapter CRUD semantics + migration runner
// (with a fake pg client; no live Postgres needed).
// Run: node lib/store-config-db.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'inqueue-db-test-'));
const filePath = path.join(scratch, 'store-config.json');

const { createConfigStore, runMigrations } = await import('./db.js');
const { defaultPresets } = await import('./storeConfig.js');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

console.log('lib/db.js tests');

const store = createConfigStore({ filePath });

await test('init materializes six default slots + presets + version 0', async () => {
  await store.init();
  const state = await store.getState();
  assert.equal(state.configVersion, 0);
  assert.equal(Object.keys(state.stores).length, 6);
  assert.equal(state.stores.Store_A.enabled, false);
  assert.equal(state.stores.Store_F.rowVersion, 1);
  assert.ok(state.presets.listing.whoMade);
  assert.ok(fs.existsSync(filePath));
});

await test('updateStore applies patch, bumps rowVersion + configVersion', async () => {
  const before = await store.getState();
  const { store: updated, configVersion } = await store.updateStore(
    'Store_A',
    { displayName: 'NorthwindUS', skuPrefix: 'CU', enabled: true },
    before.stores.Store_A.rowVersion,
  );
  assert.equal(updated.displayName, 'NorthwindUS');
  assert.equal(updated.skuPrefix, 'CU');
  assert.equal(updated.rowVersion, before.stores.Store_A.rowVersion + 1);
  assert.equal(configVersion, before.configVersion + 1);
});

await test('optimistic concurrency: stale rowVersion → CONFLICT', async () => {
  await assert.rejects(
    () => store.updateStore('Store_A', { notes: 'stale write' }, 1),
    (e) => e.code === 'CONFLICT',
  );
});

await test('invalid slot → BAD_SLOT', async () => {
  await assert.rejects(() => store.updateStore('Store_G', {}, 1), (e) => e.code === 'BAD_SLOT');
});

await test('changing driveFolderId resets the drive test; same value does not', async () => {
  let state = await store.getState();
  await store.updateStore('Store_B', { driveFolderId: 'AAAABBBBCCCCDDDD' }, state.stores.Store_B.rowVersion);
  await store.updateStoreSystem('Store_B', { driveTestStatus: 'ok', driveTestedAt: '2026-07-10T00:00:00Z' });
  state = await store.getState();
  assert.equal(state.stores.Store_B.driveTestStatus, 'ok');
  // Saving the SAME folder id must keep the test result.
  await store.updateStore('Store_B', { driveFolderId: 'AAAABBBBCCCCDDDD', notes: 'same folder' }, state.stores.Store_B.rowVersion);
  state = await store.getState();
  assert.equal(state.stores.Store_B.driveTestStatus, 'ok', 'unchanged folder id must not reset test');
  // A DIFFERENT folder id resets to untested.
  await store.updateStore('Store_B', { driveFolderId: 'EEEEFFFFGGGGHHHH' }, state.stores.Store_B.rowVersion);
  state = await store.getState();
  assert.equal(state.stores.Store_B.driveTestStatus, 'untested');
  assert.equal(state.stores.Store_B.driveTestedAt, null);
});

await test('updateStoreSystem only writes server-managed fields', async () => {
  await store.updateStoreSystem('Store_C', {
    etsyConnected: true,
    etsyShopId: '99',
    etsyShopName: 'TestShop',
    displayName: 'HACKED', // not in the allowed system set — must be ignored
    etsyIds: { taxonomyId: 42 },
  });
  const state = await store.getState();
  assert.equal(state.stores.Store_C.etsyConnected, true);
  assert.equal(state.stores.Store_C.etsyShopName, 'TestShop');
  assert.equal(state.stores.Store_C.etsyIds.taxonomyId, 42);
  assert.equal(state.stores.Store_C.displayName, '', 'system write must not touch user fields');
});

await test('savePresets replaces presets and bumps version', async () => {
  const before = await store.getState();
  const presets = defaultPresets();
  presets.listing.defaultPrice = '19.99';
  const { configVersion } = await store.savePresets(presets);
  assert.equal(configVersion, before.configVersion + 1);
  const state = await store.getState();
  assert.equal(state.presets.listing.defaultPrice, '19.99');
});

await test('recordSync merges per-tool bookkeeping', async () => {
  await store.recordSync('preply', { lastAttemptAt: 't1', lastError: 'unreachable (offline)' });
  await store.recordSync('preply', { lastSuccessAt: 't2', lastError: null });
  const state = await store.getState();
  assert.equal(state.sync.preply.lastAttemptAt, 't1');
  assert.equal(state.sync.preply.lastSuccessAt, 't2');
  assert.equal(state.sync.preply.lastError, null);
  assert.equal(state.sync.batchly, null);
});

await test('state survives adapter restarts (file round-trip)', async () => {
  const reopened = createConfigStore({ filePath });
  await reopened.init();
  const state = await reopened.getState();
  assert.equal(state.stores.Store_A.skuPrefix, 'CU');
  assert.equal(state.presets.listing.defaultPrice, '19.99');
});

// ---------------------------------------------------------------------------
// Migration runner with a fake pg pool.
// ---------------------------------------------------------------------------
function makeFakePool() {
  const executed = [];
  const applied = new Set();
  const client = {
    async query(sql, params) {
      executed.push({ sql, params });
      if (/^SELECT version FROM schema_migrations/.test(sql)) {
        return { rows: [...applied].map((v) => ({ version: v })) };
      }
      if (/^INSERT INTO schema_migrations/.test(sql)) {
        applied.add(Number(params[0]));
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { executed, applied, connect: async () => client };
}

await test('migration runner applies files in order, records versions, is idempotent', async () => {
  const migrationsDir = path.join(scratch, 'migrations');
  fs.mkdirSync(migrationsDir);
  fs.writeFileSync(path.join(migrationsDir, '002_second.sql'), 'SELECT 2;');
  fs.writeFileSync(path.join(migrationsDir, '001_first.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(migrationsDir, 'notes.txt'), 'ignore me');
  const pool = makeFakePool();
  await runMigrations(pool, migrationsDir);
  const sqlRuns = pool.executed.filter((e) => /^SELECT [12];$/m.test(e.sql)).map((e) => e.sql.trim());
  assert.deepEqual(sqlRuns, ['SELECT 1;', 'SELECT 2;'], 'must run in numeric order');
  assert.deepEqual([...pool.applied].sort(), [1, 2]);
  assert.ok(pool.executed.some((e) => /pg_advisory_lock/.test(e.sql)), 'must take the advisory lock');
  assert.ok(pool.executed.some((e) => /pg_advisory_unlock/.test(e.sql)), 'must release the advisory lock');
  // Second run: nothing new applied.
  const countBefore = pool.executed.filter((e) => /^SELECT [12];$/m.test(e.sql)).length;
  await runMigrations(pool, migrationsDir);
  const countAfter = pool.executed.filter((e) => /^SELECT [12];$/m.test(e.sql)).length;
  assert.equal(countAfter, countBefore, 're-run must be a no-op');
});

await test('failed migration rolls back and reports the file name', async () => {
  const migrationsDir = path.join(scratch, 'migrations-fail');
  fs.mkdirSync(migrationsDir);
  fs.writeFileSync(path.join(migrationsDir, '001_boom.sql'), 'BOOM;');
  const pool = makeFakePool();
  const client = await pool.connect();
  const origQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (sql === 'BOOM;') throw new Error('syntax error');
    return origQuery(sql, params);
  };
  pool.connect = async () => client;
  await assert.rejects(() => runMigrations(pool, migrationsDir), /001_boom\.sql failed/);
  assert.ok(pool.executed.some((e) => e.sql === 'ROLLBACK'), 'must roll back');
});

fs.rmSync(scratch, { recursive: true, force: true });
if (failed) { console.error(`\ndb tests: FAILED (${failed})`); process.exit(1); }
console.log('\ndb tests: OK');
