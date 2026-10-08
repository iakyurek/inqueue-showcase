// Integration test — drives the running hub over HTTP. Requires the hub to be
// running on http://localhost:${PORT} with the same .env.local as this repo.
//   Run:  node lib/auth-http.test.mjs
import assert from 'node:assert/strict';

const BASE = process.env.HUB_URL || 'http://localhost:4000';
// Credentials come from the environment so the real password never lives in
// tracked source. Set these before running:
//   INQUEUE_TEST_USERNAME=KIV_LLC
//   INQUEUE_TEST_PASSWORD=<the password from .env.local>
const USERNAME = process.env.INQUEUE_TEST_USERNAME || process.env.INQUEUE_USERNAME;
const PASSWORD = process.env.INQUEUE_TEST_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error('Set INQUEUE_TEST_USERNAME and INQUEUE_TEST_PASSWORD before running these tests.');
  process.exit(2);
}

function test(name, fn) {
  return fn().then(
    () => console.log(`  ok  ${name}`),
    (err) => { console.error(`  FAIL ${name}\n    ${err.message}`); process.exitCode = 1; },
  );
}

async function main() {
  console.log(`hub HTTP tests — ${BASE}`);

  await test('unauthenticated GET / redirects to /login', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location') || '';
    assert.ok(loc.includes('/login'), `expected login redirect, got ${loc}`);
  });

  await test('unauthenticated GET /api/stores returns 401 JSON', async () => {
    const res = await fetch(`${BASE}/api/stores`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'UNAUTHENTICATED');
  });

  await test('GET /login is public and serves HTML', async () => {
    const res = await fetch(`${BASE}/login`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('id="loginForm"'), 'login form missing');
  });

  await test('POST /api/login with wrong password → 401', async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: 'this-is-not-the-password' }),
    });
    assert.equal(res.status, 401);
  });

  let sessionCookie = '';
  await test('POST /api/login with correct password → 200 + Set-Cookie', async () => {
    const res = await fetch(`${BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.startsWith('inqueue_session='), `expected session cookie, got: ${setCookie}`);
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Lax'));
    assert.ok(setCookie.includes('Path=/'));
    sessionCookie = setCookie.split(';')[0];
  });

  await test('authenticated GET / returns 200', async () => {
    const res = await fetch(`${BASE}/`, { headers: { cookie: sessionCookie } });
    assert.equal(res.status, 200);
  });

  await test('authenticated GET /api/stores returns 200 JSON', async () => {
    const res = await fetch(`${BASE}/api/stores`, { headers: { cookie: sessionCookie } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok('preplyStores' in body);
  });

  await test('GET /api/auth/status reflects the session', async () => {
    const unauth = await (await fetch(`${BASE}/api/auth/status`)).json();
    assert.equal(unauth.authenticated, false);
    const authed = await (await fetch(`${BASE}/api/auth/status`, { headers: { cookie: sessionCookie } })).json();
    assert.equal(authed.authenticated, true);
    assert.equal(authed.username, 'KIV_LLC');
  });

  await test('POST /api/logout clears the cookie (Max-Age=0)', async () => {
    const res = await fetch(`${BASE}/api/logout`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('Max-Age=0'));
    assert.ok(setCookie.startsWith('inqueue_session=;'));
  });

  await test('tampered cookie is rejected', async () => {
    const evil = sessionCookie.replace(/[A-Za-z0-9]$/, 'X');
    const res = await fetch(`${BASE}/api/stores`, { headers: { cookie: evil } });
    assert.equal(res.status, 401);
  });

  if (process.exitCode) console.error('\nhub HTTP tests: FAILED');
  else console.log('\nhub HTTP tests: OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
