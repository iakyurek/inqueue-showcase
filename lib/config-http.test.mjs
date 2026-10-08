// HTTP tests for the hub's Store Configuration API. Self-contained: spawns
// server.js on a scratch port with a scratch JSON config file + generated
// credentials, plus stub Preply/Batchly servers for the proxy routes.
// Run: node lib/config-http.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const HUB_PORT = 4890 + Math.floor(Math.random() * 100);
const PREPLY_PORT = HUB_PORT + 100;
const BATCHLY_PORT = HUB_PORT + 200;
const BASE = `http://localhost:${HUB_PORT}`;

const SECRET = crypto.randomBytes(32).toString('hex');
const USERNAME = 'config-test-user';
const PASSWORD = 'config-test-password';
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(PASSWORD, salt, 100000, 32, 'sha256');
const PASSWORD_HASH = `pbkdf2$100000$${salt.toString('hex')}$${hash.toString('hex')}`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'inqueue-config-http-'));
const configFile = path.join(scratch, 'store-config.json');

process.env.INQUEUE_SESSION_SECRET = SECRET;
const { verifyServiceToken } = await import('./serviceAuth.js');

// ---------------------------------------------------------------------------
// Stub tool servers. They record requests and verify service tokens so the
// tests prove the hub sends real, audience-correct Bearer tokens.
// ---------------------------------------------------------------------------
const stubLog = { preply: [], batchly: [] };
function makeStub(tool, port, routes) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      const auth = verifyServiceToken(token, tool);
      const parsed = body ? JSON.parse(body) : {};
      stubLog[tool].push({ path: req.url, auth: Boolean(auth), body: parsed });
      if (!auth) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'BAD_SERVICE_TOKEN' }));
      }
      const handler = routes[req.url.split('?')[0]];
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'NOT_FOUND' }));
      }
      const out = handler(parsed);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const preplyStub = await makeStub('preply', PREPLY_PORT, {
  '/api/internal/drive/test-folder': (body) =>
    body.folderId === 'GOODFOLDER12345'
      ? { ok: true, folder: { id: body.folderId, name: 'Store SKU Root' } }
      : { ok: false, detail: 'not_found_or_no_access' },
  '/api/internal/drive/infer-prefix': () => ({
    candidates: [{ prefix: 'CU', count: 16, maxNumber: 16, example: 'CU16' }],
  }),
  '/api/internal/config-sync': (body) => ({
    applied: false,
    mode: 'dry-run',
    appliedVersion: null,
    diff: [{ slot: 'Store_A', field: 'skuPrefix', current: 'CU', incoming: body.stores?.[0]?.skuPrefix }],
  }),
});

const batchlyStub = await makeStub('batchly', BATCHLY_PORT, {
  '/api/internal/etsy/test-connection': (body) =>
    body.storeFolder === 'Store_A'
      ? { connected: true, shopId: '4242', shopName: 'NorthWindUS', etsyIds: { taxonomyId: 1071, shippingProfileId: 222, readinessStateId: 333 } }
      : { connected: false, reason: 'not_connected' },
  '/api/internal/config-sync': () => ({ applied: true, mode: 'hub', appliedVersion: 99 }),
});

// ---------------------------------------------------------------------------
// Spawn the hub.
// ---------------------------------------------------------------------------
const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: {
    ...process.env,
    PORT: String(HUB_PORT),
    INQUEUE_SESSION_SECRET: SECRET,
    INQUEUE_USERNAME: USERNAME,
    INQUEUE_PASSWORD_HASH: PASSWORD_HASH,
    INQUEUE_PASSWORD: '',
    INQUEUE_DATABASE_URL: '',
    INQUEUE_STORE_CONFIG_FILE: configFile,
    INQUEUE_HUB_URL: BASE,
    PREPLY_BASE_URL: `http://localhost:${PREPLY_PORT}`,
    BATCHLY_BASE_URL: `http://localhost:${BATCHLY_PORT}`,
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let hubStderr = '';
child.stderr.on('data', (d) => { hubStderr += d; });

async function waitForHub() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`hub did not come up\n${hubStderr}`);
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

let cookie = '';
async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

try {
  await waitForHub();
  console.log(`config HTTP tests — ${BASE}`);

  await test('unauthenticated /api/config → 401', async () => {
    const res = await fetch(`${BASE}/api/config`);
    assert.equal(res.status, 401);
  });

  await test('login', async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('inqueue_session='));
  });

  await test('GET /api/config returns six slots, presets, readiness', async () => {
    const { status, body } = await api('GET', '/api/config');
    assert.equal(status, 200);
    assert.equal(body.stores.length, 6);
    assert.equal(body.configVersion, 0);
    assert.ok(body.presets.listing);
    assert.equal(body.readiness.Store_A.ready, false);
    assert.ok(body.readiness.Store_A.missing.includes('etsy_connected'));
    assert.ok(body.readinessLabels.sku_prefix);
  });

  await test('PUT store: valid patch saves; rowVersion advances', async () => {
    const { body: before } = await api('GET', '/api/config');
    const rv = before.stores.find((s) => s.slot === 'Store_A').rowVersion;
    const { status, body } = await api('PUT', '/api/config/stores/Store_A', {
      displayName: 'NorthwindUS', skuPrefix: 'cu', driveFolderId: 'GOODFOLDER12345', expectedRowVersion: rv,
    });
    assert.equal(status, 200);
    assert.equal(body.store.skuPrefix, 'CU');
    assert.equal(body.store.rowVersion, rv + 1);
  });

  await test('PUT store: invalid slot → 400, unknown field → 422, missing rowVersion → 400', async () => {
    assert.equal((await api('PUT', '/api/config/stores/Store_G', { expectedRowVersion: 1 })).status, 400);
    const r = await api('PUT', '/api/config/stores/Store_B', { hacker: true, expectedRowVersion: 1 });
    assert.equal(r.status, 422);
    assert.equal((await api('PUT', '/api/config/stores/Store_B', { notes: 'x' })).status, 400);
  });

  await test('PUT store: stale rowVersion → 409', async () => {
    const r = await api('PUT', '/api/config/stores/Store_A', { notes: 'stale', expectedRowVersion: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'ROW_VERSION_CONFLICT');
  });

  await test('enable gate: enabling an unready store → 422 with missing[]', async () => {
    const { body: state } = await api('GET', '/api/config');
    const rv = state.stores.find((s) => s.slot === 'Store_B').rowVersion;
    const r = await api('PUT', '/api/config/stores/Store_B', { enabled: true, expectedRowVersion: rv });
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'NOT_READY');
    assert.ok(r.body.missing.includes('etsy_connected'));
  });

  await test('PUT presets: valid saves; invalid → 422', async () => {
    const { body: state } = await api('GET', '/api/config');
    const presets = state.presets;
    presets.listing.defaultPrice = '14.99';
    const ok = await api('PUT', '/api/config/presets', presets);
    assert.equal(ok.status, 200);
    presets.listing.whoMade = 'a_robot';
    const bad = await api('PUT', '/api/config/presets', presets);
    assert.equal(bad.status, 422);
  });

  await test('test-drive proxies to Preply with a valid service token and persists ok', async () => {
    const r = await api('POST', '/api/config/stores/Store_A/test-drive');
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
    const call = stubLog.preply.find((c) => c.path.startsWith('/api/internal/drive/test-folder'));
    assert.ok(call, 'stub must have been called');
    assert.equal(call.auth, true, 'service token must verify for aud=preply');
    assert.equal(call.body.folderId, 'GOODFOLDER12345');
    const { body: state } = await api('GET', '/api/config');
    assert.equal(state.stores.find((s) => s.slot === 'Store_A').driveTestStatus, 'ok');
  });

  await test('test-drive without a folder id → 422', async () => {
    const r = await api('POST', '/api/config/stores/Store_C/test-drive');
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'DRIVE_FOLDER_NOT_SET');
  });

  await test('infer-prefix returns candidates and never writes', async () => {
    const { body: before } = await api('GET', '/api/config');
    const r = await api('POST', '/api/config/stores/Store_A/infer-prefix');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.candidates[0], { prefix: 'CU', count: 16, maxNumber: 16, example: 'CU16' });
    const { body: after } = await api('GET', '/api/config');
    assert.equal(after.configVersion, before.configVersion, 'inference must not bump the version');
  });

  await test('test-etsy persists the mirror from Batchly', async () => {
    const r = await api('POST', '/api/config/stores/Store_A/test-etsy');
    assert.equal(r.status, 200);
    assert.equal(r.body.connected, true);
    assert.equal(r.body.shopName, 'NorthWindUS');
    const { body: state } = await api('GET', '/api/config');
    const a = state.stores.find((s) => s.slot === 'Store_A');
    assert.equal(a.etsyConnected, true);
    assert.ok(a.etsyStatusCheckedAt);
  });

  await test('refresh-etsy-ids imports StoreEtsyIds into the hub row', async () => {
    const r = await api('POST', '/api/config/stores/Store_A/refresh-etsy-ids');
    assert.equal(r.status, 200);
    assert.equal(r.body.etsyIds.taxonomyId, 1071);
    const { body: state } = await api('GET', '/api/config');
    const a = state.stores.find((s) => s.slot === 'Store_A');
    assert.equal(a.etsyIds.shippingProfileId, 222);
    assert.equal(a.etsyIds.readinessStateId, 333);
  });

  await test('etsy connect redirects through the hub SSO launch (no external URL in params)', async () => {
    const r = await api('GET', '/api/config/etsy/connect/Store_B');
    assert.equal(r.status, 302);
    const loc = r.headers.get('location');
    assert.ok(loc.startsWith('/auth/launch?tool=batchly&next='), loc);
    const next = decodeURIComponent(new URL(loc, BASE).searchParams.get('next'));
    assert.equal(next, '/api/auth/etsy/start?storeFolder=Store_B&returnTo=hub');
  });

  await test('sync pushes full state to both tools and records per-tool results', async () => {
    const r = await api('POST', '/api/config/sync', {});
    assert.equal(r.status, 200);
    const preply = r.body.results.find((x) => x.tool === 'preply');
    const batchly = r.body.results.find((x) => x.tool === 'batchly');
    assert.equal(preply.mode, 'dry-run');
    assert.ok(Array.isArray(preply.diff));
    assert.equal(batchly.applied, true);
    assert.equal(batchly.appliedVersion, 99);
    // Payload shape pushed to the tools
    const pushed = stubLog.preply.find((c) => c.path.startsWith('/api/internal/config-sync'));
    assert.equal(pushed.body.stores.length, 6);
    assert.ok(pushed.body.presets.listing);
    assert.ok(!('etsyShopName' in pushed.body.stores[0]), 'mirror fields must not sync');
    // Bookkeeping visible in state
    assert.equal(r.body.sync.batchly.ackedConfigVersion, 99);
    assert.equal(r.body.sync.batchly.mode, 'hub');
  });

  await test('sync to a single unreachable tool degrades without failing the save', async () => {
    batchlyStub.close();
    const r = await api('POST', '/api/config/sync', { tool: 'batchly' });
    assert.equal(r.status, 200);
    const result = r.body.results[0];
    assert.equal(result.applied, false);
    assert.equal(result.error, 'unreachable');
    assert.ok(r.body.sync.batchly.lastError.includes('unreachable'));
  });

  await test('readiness flips once everything is configured', async () => {
    const { body: state } = await api('GET', '/api/config');
    const a = state.stores.find((s) => s.slot === 'Store_A');
    assert.equal(state.readiness.Store_A.ready, true, `missing: ${state.readiness.Store_A.missing.join(',')}`);
    // And now the enable gate allows enabling Store_A.
    const r = await api('PUT', '/api/config/stores/Store_A', { enabled: true, expectedRowVersion: a.rowVersion });
    assert.equal(r.status, 200);
    assert.equal(r.body.store.enabled, true);
  });
} finally {
  child.kill('SIGTERM');
  preplyStub.close();
  try { batchlyStub.close(); } catch {}
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failed) { console.error(`\nconfig HTTP tests: FAILED (${failed})`); process.exit(1); }
console.log('\nconfig HTTP tests: OK');
