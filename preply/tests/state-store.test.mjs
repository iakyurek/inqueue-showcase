// Durable-state layer — Postgres write-through for Preply's JSON state files.
// Covers the stateStore module against a fake pg pool (no live Postgres) and
// the server's write-through/remove integration via the test seam.
//
// Run: node preply/tests/state-store.test.mjs

import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-state-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
delete process.env.PREPLY_DATABASE_URL; // module must be inert without it

const { createStateStore } = await import('../stateStore.js');
const preply = await import('../server.js');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

console.log('Durable state (Postgres write-through) tests');

// ---------------------------------------------------------------------------
// stateStore module against a fake pool
// ---------------------------------------------------------------------------

// Minimal pg.Pool stand-in: answers the module's exact queries from an
// in-memory map and records every call for assertions.
function fakePool() {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/^CREATE TABLE/.test(sql)) return { rows: [] };
      if (/^SELECT key, value FROM preply_state/.test(sql)) {
        return { rows: [...rows.entries()].map(([key, value]) => ({ key, value })) };
      }
      if (/^INSERT INTO preply_state/.test(sql)) {
        rows.set(params[0], JSON.parse(params[1]));
        return { rows: [] };
      }
      if (/^DELETE FROM preply_state/.test(sql)) {
        rows.delete(params[0]);
        return { rows: [] };
      }
      throw new Error(`fakePool: unexpected query ${sql}`);
    },
    async end() {},
  };
}

await test('createStateStore returns null without a database URL', () => {
  assert.equal(createStateStore(undefined), null);
  assert.equal(createStateStore(''), null);
});

await test('init creates the table; put/getAll/remove roundtrip', async () => {
  const pool = fakePool();
  const store = createStateStore('postgres://fake', { poolFactory: () => pool });
  await store.init();
  assert.ok(pool.calls.some((c) => /CREATE TABLE IF NOT EXISTS preply_state/.test(c.sql)));

  await store.put('stores.json', [{ id: 'store-1' }]);
  await store.put('settings.json', { appName: 'Preply' });
  const all = await store.getAll();
  assert.deepEqual(all.get('stores.json'), [{ id: 'store-1' }]);
  assert.deepEqual(all.get('settings.json'), { appName: 'Preply' });

  await store.remove('settings.json');
  assert.equal((await store.getAll()).has('settings.json'), false);
});

await test('put upserts (second write replaces the first)', async () => {
  const pool = fakePool();
  const store = createStateStore('postgres://fake', { poolFactory: () => pool });
  await store.init();
  await store.put('sku-ledger.json', ['CU001']);
  await store.put('sku-ledger.json', ['CU001', 'CU002']);
  assert.deepEqual((await store.getAll()).get('sku-ledger.json'), ['CU001', 'CU002']);
});

// ---------------------------------------------------------------------------
// server.js write-through integration (via the test seam)
// ---------------------------------------------------------------------------

function recordingStore() {
  return {
    puts: [],
    removes: [],
    async put(key, value) { this.puts.push({ key, value }); },
    async remove(key) { this.removes.push(key); },
  };
}

await test('writeJsonFile writes through to the durable store for mapped files', async () => {
  const store = recordingStore();
  preply.__setStateStoreForTests(store);
  try {
    await preply.writeJsonFile(preply.SETTINGS_FILE, { appName: 'Preply', probe: 1 });
    assert.equal(store.puts.length, 1);
    assert.equal(store.puts[0].key, 'settings.json');
    assert.equal(store.puts[0].value.probe, 1);
    // Disk copy still written (write-through, not write-around).
    assert.ok(fsSync.existsSync(preply.SETTINGS_FILE));
  } finally {
    preply.__setStateStoreForTests(null);
  }
});

await test('writeJsonFile ignores files outside the durable map', async () => {
  const store = recordingStore();
  preply.__setStateStoreForTests(store);
  try {
    const scratchFile = path.join(SCRATCH, 'not-durable.json');
    await preply.writeJsonFile(scratchFile, { x: 1 });
    assert.equal(store.puts.length, 0);
  } finally {
    preply.__setStateStoreForTests(null);
  }
});

await test('removeJsonFile deletes disk file and durable copy', async () => {
  const store = recordingStore();
  preply.__setStateStoreForTests(store);
  try {
    await preply.writeJsonFile(preply.SETTINGS_FILE, { appName: 'Preply' });
    await preply.removeJsonFile(preply.SETTINGS_FILE);
    assert.deepEqual(store.removes, ['settings.json']);
    assert.equal(fsSync.existsSync(preply.SETTINGS_FILE), false);
    // Recreate defaults so later imports of this scratch dir stay sane.
    await preply.writeJsonFile(preply.SETTINGS_FILE, { appName: 'Preply' });
  } finally {
    preply.__setStateStoreForTests(null);
  }
});

await test('a failing durable write propagates (DB is authoritative)', async () => {
  preply.__setStateStoreForTests({
    async put() { throw new Error('db down'); },
    async remove() {},
  });
  try {
    await assert.rejects(
      () => preply.writeJsonFile(preply.SETTINGS_FILE, { appName: 'Preply' }),
      /db down/,
    );
  } finally {
    preply.__setStateStoreForTests(null);
  }
});

await test('every durable file has a distinct stable key', () => {
  const keys = [...preply.DURABLE_STATE_FILES.values()];
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[\w.-]+\.json$/);
  // The load-bearing files are all covered.
  for (const expected of ['stores.json', 'batches.json', 'sku-ledger.json', 'settings.json', 'google-oauth-token.json']) {
    assert.ok(keys.includes(expected), `missing durable key ${expected}`);
  }
});

process.exitCode = failed ? 1 : 0;
console.log(failed ? `${failed} test(s) FAILED` : 'all tests passed');
