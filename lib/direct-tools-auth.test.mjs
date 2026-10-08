// Direct-tool auth verification — hits the hub, Inkly, Preply, and Batchly on
// their real ports and confirms every path the operator might visit is gated
// behind the shared inQueue session cookie. This is deliberately end-to-end:
// it wants to see redirects, 401s, and Set-Cookie headers on live servers,
// not a mocked handler.
//
// Prereqs (all four must be running with the same INQUEUE_SESSION_SECRET):
//   http://localhost:4000  root hub
//   http://localhost:5500  Inkly
//   http://localhost:3001  Preply
//   http://localhost:3030  Batchly
// Override with HUB_URL / INKLY_URL / PREPLY_URL / BATCHLY_URL if different.
//
// Run: node lib/direct-tools-auth.test.mjs

import assert from 'node:assert/strict';

const HUB     = process.env.HUB_URL     || 'http://localhost:4000';
const INKLY   = process.env.INKLY_URL   || 'http://localhost:5500';
const PREPLY  = process.env.PREPLY_URL  || 'http://localhost:3001';
const BATCHLY = process.env.BATCHLY_URL || 'http://localhost:3030';

// Credentials come from the environment so the real password never lives in
// tracked source. Set INQUEUE_TEST_USERNAME and INQUEUE_TEST_PASSWORD first.
const USERNAME = process.env.INQUEUE_TEST_USERNAME || process.env.INQUEUE_USERNAME;
const PASSWORD = process.env.INQUEUE_TEST_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error('Set INQUEUE_TEST_USERNAME and INQUEUE_TEST_PASSWORD before running these tests.');
  process.exit(2);
}

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${err.message}`);
  }
}

function assertLoginRedirect(res, { expectedHubPrefix = HUB } = {}) {
  assert.equal(res.status, 302, `expected 302, got ${res.status}`);
  const loc = res.headers.get('location') || '';
  assert.ok(loc.startsWith(`${expectedHubPrefix}/login`), `expected redirect to ${expectedHubPrefix}/login, got: ${loc}`);
  assert.ok(loc.includes('next='), `expected next= param in redirect, got: ${loc}`);
}

async function assertJsonUnauth(res) {
  assert.equal(res.status, 401, `expected 401, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.error, 'UNAUTHENTICATED');
}

async function main() {
  console.log('inQueue direct-tools auth tests');
  console.log(`  hub=${HUB}  inkly=${INKLY}  preply=${PREPLY}  batchly=${BATCHLY}`);
  console.log('');

  // ----- 1-4. Unauthenticated page requests redirect to hub /login ---------

  await test('1. hub  GET / (unauth) redirects to /login', async () => {
    const res = await fetch(`${HUB}/`, { redirect: 'manual' });
    assertLoginRedirect(res);
  });

  await test('2. inkly GET / (unauth) redirects to hub /login', async () => {
    const res = await fetch(`${INKLY}/`, { redirect: 'manual' });
    assertLoginRedirect(res);
  });

  await test('3. preply GET / (unauth) redirects to hub /login', async () => {
    const res = await fetch(`${PREPLY}/`, { redirect: 'manual' });
    assertLoginRedirect(res);
  });

  await test('4a. batchly GET /dashboard (unauth) redirects to hub /login', async () => {
    const res = await fetch(`${BATCHLY}/dashboard`, { redirect: 'manual' });
    assertLoginRedirect(res);
  });
  await test('4b. batchly GET /batches (unauth) redirects to hub /login', async () => {
    const res = await fetch(`${BATCHLY}/batches`, { redirect: 'manual' });
    assertLoginRedirect(res);
  });

  // ----- 5-7. Unauthenticated API requests → 401 JSON ----------------------

  await test('5. inkly  GET /api/status (unauth) → 401 JSON', async () => {
    await assertJsonUnauth(await fetch(`${INKLY}/api/status`));
  });
  await test('6a. preply GET /api/state (unauth) → 401 JSON', async () => {
    await assertJsonUnauth(await fetch(`${PREPLY}/api/state`));
  });
  await test('6b. preply GET /api/assets (unauth) → 401 JSON', async () => {
    await assertJsonUnauth(await fetch(`${PREPLY}/api/assets`));
  });
  await test('7a. batchly GET /api/dashboard/summary (unauth) → 401 JSON', async () => {
    await assertJsonUnauth(await fetch(`${BATCHLY}/api/dashboard/summary`));
  });
  await test('7b. batchly GET /api/batches/local (unauth) → 401 JSON', async () => {
    await assertJsonUnauth(await fetch(`${BATCHLY}/api/batches/local`));
  });

  // ----- 8. Correct login at hub sets the inqueue_session cookie ----------

  let cookie = '';
  await test('8. hub POST /api/login (correct creds) sets inqueue_session cookie', async () => {
    const res = await fetch(`${HUB}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.startsWith('inqueue_session='), `no session cookie: ${setCookie}`);
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Lax'));
    assert.ok(setCookie.includes('Path=/'));
    cookie = setCookie.split(';')[0];
  });

  // ----- 9. Authenticated GETs succeed on all four apps -------------------

  await test('9a. authed GET hub /  → 200 HTML', async () => {
    const res = await fetch(`${HUB}/`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('inQueue'));
  });

  await test('9b. authed GET inkly /  → 200 HTML', async () => {
    const res = await fetch(`${INKLY}/`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(res.status, 200);
  });

  await test('9c. authed GET preply /  → 200 HTML', async () => {
    const res = await fetch(`${PREPLY}/`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(res.status, 200);
  });

  await test('9d. authed GET batchly /dashboard → 200', async () => {
    const res = await fetch(`${BATCHLY}/dashboard`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(res.status, 200);
  });

  await test('9e. authed GET each app /api/auth/status → authenticated=true', async () => {
    for (const [name, url] of [['hub', HUB], ['inkly', INKLY], ['preply', PREPLY], ['batchly', BATCHLY]]) {
      const res = await fetch(`${url}/api/auth/status`, { headers: { cookie } });
      assert.equal(res.status, 200, `${name} auth/status HTTP ${res.status}`);
      const body = await res.json();
      assert.equal(body.authenticated, true, `${name} not authenticated`);
    }
  });

  // ----- 10. Logout clears the cookie -------------------------------------

  let clearedCookieHeader = '';
  await test('10. hub POST /api/logout clears the cookie (Max-Age=0)', async () => {
    const res = await fetch(`${HUB}/api/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('Max-Age=0'));
    assert.ok(setCookie.startsWith('inqueue_session=;'));
    clearedCookieHeader = setCookie;
  });

  // ----- 11. After logout, all direct tool URLs are blocked again ---------
  // Simulate the browser: after logout it holds only the cleared cookie value ("").

  const clearedCookie = 'inqueue_session=';
  await test('11a. after logout, hub / redirects to /login', async () => {
    const res = await fetch(`${HUB}/`, { headers: { cookie: clearedCookie }, redirect: 'manual' });
    assertLoginRedirect(res);
  });
  await test('11b. after logout, inkly / redirects to hub /login', async () => {
    const res = await fetch(`${INKLY}/`, { headers: { cookie: clearedCookie }, redirect: 'manual' });
    assertLoginRedirect(res);
  });
  await test('11c. after logout, preply / redirects to hub /login', async () => {
    const res = await fetch(`${PREPLY}/`, { headers: { cookie: clearedCookie }, redirect: 'manual' });
    assertLoginRedirect(res);
  });
  await test('11d. after logout, batchly /dashboard redirects to hub /login', async () => {
    const res = await fetch(`${BATCHLY}/dashboard`, { headers: { cookie: clearedCookie }, redirect: 'manual' });
    assertLoginRedirect(res);
  });
  await test('11e. after logout, /api/* returns 401 on every app', async () => {
    await assertJsonUnauth(await fetch(`${INKLY}/api/status`,        { headers: { cookie: clearedCookie } }));
    await assertJsonUnauth(await fetch(`${PREPLY}/api/state`,        { headers: { cookie: clearedCookie } }));
    await assertJsonUnauth(await fetch(`${BATCHLY}/api/dashboard/summary`, { headers: { cookie: clearedCookie } }));
  });

  // ----- 12. OAuth callback exemptions remain reachable without a session -
  // "Reachable" = NOT a 302 to /login and NOT a 401 UNAUTHENTICATED. The route
  // will typically 400/500 because we're missing code/state, and that's fine —
  // we're only checking the auth gate did not intercept it.

  async function assertCallbackReachable(name, url) {
    const res = await fetch(url, { redirect: 'manual' });
    assert.notEqual(res.status, 401, `${name} was blocked with 401: auth gate intercepted the callback`);
    // If it's a 302, it must NOT be a redirect to the hub /login page.
    if (res.status === 302) {
      const loc = res.headers.get('location') || '';
      assert.ok(!loc.includes('/login'), `${name} was redirected to login: ${loc}`);
    }
  }

  await test('12a. preply /api/drive/oauth/callback is reachable without session', async () => {
    await assertCallbackReachable('preply drive callback', `${PREPLY}/api/drive/oauth/callback`);
  });
  await test('12b. batchly /api/auth/etsy/callback is reachable without session', async () => {
    await assertCallbackReachable('batchly etsy callback', `${BATCHLY}/api/auth/etsy/callback`);
  });
  await test('12c. batchly /api/auth/google/callback is reachable without session', async () => {
    await assertCallbackReachable('batchly google callback', `${BATCHLY}/api/auth/google/callback`);
  });

  console.log('');
  if (failed) {
    console.error(`direct-tools auth tests: FAILED (${failed})`);
    process.exit(1);
  }
  console.log('direct-tools auth tests: OK');
}

main().catch(err => { console.error(err); process.exit(1); });
