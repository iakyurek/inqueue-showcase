// End-to-end SSO flow across live servers — proves the one-login behavior the
// Render deployment needs: log in once at the hub, then reach every tool
// without another login screen, each tool holding its OWN first-party session.
//
// Prereqs — all four running with the SAME INQUEUE_SESSION_SECRET, and the
// hub's INKLY_BASE_URL / PREPLY_BASE_URL / BATCHLY_BASE_URL pointing at them:
//   http://localhost:4000  hub
//   http://localhost:5500  Inkly
//   http://localhost:3001  Preply
//   http://localhost:3030  Batchly
// Override with HUB_URL / INKLY_URL / PREPLY_URL / BATCHLY_URL.
//
// Credentials come from the environment (never tracked): set
//   INQUEUE_TEST_USERNAME, INQUEUE_TEST_PASSWORD
// and INQUEUE_SESSION_SECRET (same value the servers use — this test mints
// adversarial tickets to prove each tool's rejection paths).
//
// Run: node lib/sso-http.test.mjs
import assert from 'node:assert/strict';
import { createSsoTicket, TOOL_SESSION_COOKIE, TOOL_SSO_CALLBACK_PATH } from './sso.js';

const HUB     = process.env.HUB_URL     || 'http://localhost:4000';
const TOOLS = {
  inkly:   process.env.INKLY_URL   || 'http://localhost:5500',
  preply:  process.env.PREPLY_URL  || 'http://localhost:3001',
  batchly: process.env.BATCHLY_URL || 'http://localhost:3030',
};

const USERNAME = process.env.INQUEUE_TEST_USERNAME || process.env.INQUEUE_USERNAME;
const PASSWORD = process.env.INQUEUE_TEST_PASSWORD;
if (!USERNAME || !PASSWORD) {
  console.error('Set INQUEUE_TEST_USERNAME and INQUEUE_TEST_PASSWORD before running these tests.');
  process.exit(2);
}
if (!process.env.INQUEUE_SESSION_SECRET) {
  console.error('Set INQUEUE_SESSION_SECRET (same value the servers use) to mint adversarial tickets.');
  process.exit(2);
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

function setCookieHeaders(res) {
  // Node fetch exposes getSetCookie() for multiple Set-Cookie headers.
  return typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
}
function firstCookiePair(res, name) {
  for (const line of setCookieHeaders(res)) {
    if (line.startsWith(`${name}=`)) return line.split(';')[0];
  }
  return null;
}

async function main() {
  console.log(`SSO HTTP tests — hub ${HUB}`);

  // ---- log in at the hub -------------------------------------------------
  let hubCookie = '';
  await test('hub login returns a session cookie', async () => {
    const res = await fetch(`${HUB}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    assert.equal(res.status, 200);
    hubCookie = firstCookiePair(res, 'inqueue_session');
    assert.ok(hubCookie, 'expected inqueue_session cookie');
  });

  // ---- launch route ------------------------------------------------------
  await test('unauthenticated /auth/launch redirects to hub /login', async () => {
    const res = await fetch(`${HUB}/auth/launch?tool=inkly&next=/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const loc = res.headers.get('location') || '';
    assert.ok(loc.includes('/login'), `expected /login, got ${loc}`);
  });

  await test('/auth/launch rejects an unknown tool with 400', async () => {
    const res = await fetch(`${HUB}/auth/launch?tool=evil&next=/`, {
      redirect: 'manual', headers: { cookie: hubCookie },
    });
    assert.equal(res.status, 400);
  });

  // ---- per-tool: authed launch → callback → first-party session ----------
  for (const [tool, base] of Object.entries(TOOLS)) {
    await test(`authenticated /auth/launch?tool=${tool} → tool callback with a ticket`, async () => {
      const res = await fetch(`${HUB}/auth/launch?tool=${tool}&next=/`, {
        redirect: 'manual', headers: { cookie: hubCookie },
      });
      assert.equal(res.status, 302);
      const loc = new URL(res.headers.get('location'));
      assert.equal(loc.origin, new URL(base).origin);
      assert.equal(loc.pathname, TOOL_SSO_CALLBACK_PATH[tool]);
      assert.ok(loc.searchParams.get('ticket'), 'expected a ticket param');
    });

    await test(`${tool} accepts a valid ticket, sets ${TOOL_SESSION_COOKIE[tool]}, and lets the user in`, async () => {
      const ticket = createSsoTicket({ username: USERNAME, tool, next: '/' });
      const res = await fetch(`${base}${TOOL_SSO_CALLBACK_PATH[tool]}?ticket=${encodeURIComponent(ticket)}`, {
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      const cookie = firstCookiePair(res, TOOL_SESSION_COOKIE[tool]);
      assert.ok(cookie, `expected ${TOOL_SESSION_COOKIE[tool]}`);
      const setLine = setCookieHeaders(res).find(l => l.startsWith(TOOL_SESSION_COOKIE[tool]));
      assert.ok(/HttpOnly/i.test(setLine), 'HttpOnly missing');
      assert.ok(/SameSite=Lax/i.test(setLine), 'SameSite=Lax missing');
      assert.ok(/Path=\//.test(setLine), 'Path=/ missing');
      assert.ok(!/Max-Age/i.test(setLine), 'must be a browser-session cookie (no Max-Age)');
      assert.ok(!/Expires/i.test(setLine), 'must be a browser-session cookie (no Expires)');

      // With that cookie the tool no longer bounces to login.
      const authed = await fetch(`${base}/api/auth/status`, { headers: { cookie } });
      assert.equal(authed.status, 200);
      const body = await authed.json();
      assert.equal(body.authenticated, true);
    });

    await test(`${tool} rejects an expired ticket (no cookie, back to launch)`, async () => {
      const now = Math.floor(Date.now() / 1000);
      const ticket = createSsoTicket({ username: USERNAME, tool, next: '/' }, { now: now - 120 });
      const res = await fetch(`${base}${TOOL_SSO_CALLBACK_PATH[tool]}?ticket=${encodeURIComponent(ticket)}`, {
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      assert.equal(firstCookiePair(res, TOOL_SESSION_COOKIE[tool]), null, 'must not set a session cookie');
      assert.ok((res.headers.get('location') || '').includes('/auth/launch'));
    });

    await test(`${tool} rejects a ticket minted for a different tool`, async () => {
      const otherTool = tool === 'inkly' ? 'preply' : 'inkly';
      const ticket = createSsoTicket({ username: USERNAME, tool: otherTool, next: '/' });
      const res = await fetch(`${base}${TOOL_SSO_CALLBACK_PATH[tool]}?ticket=${encodeURIComponent(ticket)}`, {
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      assert.equal(firstCookiePair(res, TOOL_SESSION_COOKIE[tool]), null, 'must not set a session cookie');
    });

    await test(`${tool} neutralizes an external next to a relative path`, async () => {
      const ticket = createSsoTicket({ username: USERNAME, tool, next: 'https://evil.com/x' });
      const res = await fetch(`${base}${TOOL_SSO_CALLBACK_PATH[tool]}?ticket=${encodeURIComponent(ticket)}`, {
        redirect: 'manual',
      });
      assert.equal(res.status, 302);
      const loc = res.headers.get('location') || '';
      // Must be a same-origin relative redirect, never off to evil.com.
      assert.ok(!/evil\.com/.test(loc), `leaked external redirect: ${loc}`);
      assert.ok(loc === '/' || loc.startsWith('/') || loc.startsWith(base), `unexpected redirect: ${loc}`);
    });

    await test(`${tool} direct unauthenticated page visit redirects to hub launch`, async () => {
      const res = await fetch(`${base}/`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      const loc = res.headers.get('location') || '';
      assert.ok(loc.includes('/auth/launch'), `expected /auth/launch, got ${loc}`);
      assert.ok(loc.includes(`tool=${tool}`), `expected tool=${tool}, got ${loc}`);
    });

    await test(`${tool} unauthenticated API request returns 401 JSON`, async () => {
      const res = await fetch(`${base}/api/auth/status`);
      // /api/auth/status is public and returns {authenticated:false}; a gated
      // API must 401. Use a definitely-gated endpoint instead.
      assert.equal(res.status, 200);
      const gated = await fetch(`${base}/api/does-not-exist-but-gated`, { redirect: 'manual' });
      assert.equal(gated.status, 401, 'gated API must 401 when unauthenticated');
    });
  }

  if (failed) { console.error(`\nSSO HTTP tests: FAILED (${failed})`); process.exit(1); }
  console.log('\nSSO HTTP tests: OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
