// Phase 5: hub /api/admin/status over HTTP. Spawns the hub on a scratch port
// with test credentials, then checks: auth gating, graceful degradation when
// Preply/Batchly are down, no token material in responses, and no secrets in
// the frontend bundle. Self-contained — no other service needs to run.
//
// Run: node lib/admin-status-http.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = 4890 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;

const TEST_USERNAME = 'phase5-admin-test';
const TEST_PASSWORD = crypto.randomBytes(12).toString('hex');
const iterations = 100_000;
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(TEST_PASSWORD, Buffer.from(salt, 'hex'), iterations, 32, 'sha256').toString('hex');

const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    INQUEUE_SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
    INQUEUE_USERNAME: TEST_USERNAME,
    INQUEUE_PASSWORD_HASH: `pbkdf2$${iterations}$${salt}$${hash}`,
    INQUEUE_PASSWORD: '',
    // Point tool URLs at dead ports so degradation paths are exercised.
    PREPLY_BASE_URL: 'http://127.0.0.1:59901',
    BATCHLY_BASE_URL: 'http://127.0.0.1:59902',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/auth/status`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('hub did not start');
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

console.log('Phase 5 hub admin-status HTTP tests');

try {
  await waitForServer();

  await test('unauthenticated GET /api/admin/status returns 401 JSON', async () => {
    const res = await fetch(`${BASE}/api/admin/status`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'UNAUTHENTICATED');
  });

  // Log in once for the remaining checks.
  const loginRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  assert.equal(loginRes.status, 200, 'login must succeed');
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('inqueue_session='), 'session cookie issued');

  await test('authenticated status degrades gracefully when both tools are down', async () => {
    const res = await fetch(`${BASE}/api/admin/status`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.hub.ok, true);
    assert.ok(Array.isArray(data.hub.warnings));
    assert.equal(data.preply.online, false);
    assert.equal(data.preply.status, null);
    assert.ok(['offline', 'timeout'].includes(data.preply.reason), data.preply.reason);
    assert.equal(data.batchly.online, false);
  });

  await test('admin status response contains no token or secret material', async () => {
    const res = await fetch(`${BASE}/api/admin/status`, { headers: { cookie } });
    const raw = await res.text();
    for (const needle of ['refresh_token', 'accessToken', 'client_secret', 'CLIENT_SECRET', 'PASSWORD_HASH=', TEST_PASSWORD]) {
      assert.ok(!raw.includes(needle), `response leaked ${needle}`);
    }
  });

  await test('frontend bundle exposes no secrets (config.js, app.js, index.html)', async () => {
    // Env var *names* may appear in user-facing fix instructions; what must
    // never appear is an assignment/value: FOO=..., token values, passwords.
    const targets = ['/config.js', '/app.js', '/'];
    for (const target of targets) {
      const res = await fetch(`${BASE}${target}`, { headers: { cookie } });
      const raw = await res.text();
      for (const needle of ['CLIENT_SECRET=', 'refresh_token', 'INQUEUE_PASSWORD=', 'SESSION_SECRET=', TEST_PASSWORD]) {
        assert.ok(!raw.includes(needle), `${target} leaked ${needle}`);
      }
    }
  });

  await test('unauthenticated page request redirects to login', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.ok((res.headers.get('location') || '').includes('/login'));
  });
} finally {
  child.kill('SIGTERM');
}

console.log('');
if (failed) { console.error(`Phase 5 hub admin-status HTTP tests: FAILED (${failed})`); process.exit(1); }
console.log('Phase 5 hub admin-status HTTP tests: OK');
