// Focused unit tests for lib/sso.js (ticket + tool-session + path safety).
// Run: node lib/sso.test.mjs
import assert from 'node:assert/strict';

process.env.INQUEUE_SESSION_SECRET = 'test-secret-value-for-hmac-verification-only';

const {
  isValidTool,
  sanitizeNextPath,
  createSsoTicket,
  verifySsoTicket,
  createToolSessionToken,
  verifyToolSessionToken,
  newToolSessionCookieHeader,
  buildToolLaunchRedirect,
  TOOL_SESSION_COOKIE,
  TOOL_SSO_CALLBACK_PATH,
} = await import('./sso.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

console.log('lib/sso.js tests');

test('isValidTool accepts the three tools and rejects others', () => {
  for (const t of ['inkly', 'preply', 'batchly']) assert.equal(isValidTool(t), true);
  for (const t of ['hub', 'etsy', '', null, undefined, 'INKLY']) assert.equal(isValidTool(t), false);
});

test('sanitizeNextPath accepts safe relative paths', () => {
  assert.equal(sanitizeNextPath('/'), '/');
  assert.equal(sanitizeNextPath('/stores?x=1'), '/stores?x=1');
  assert.equal(sanitizeNextPath('/a/b/c'), '/a/b/c');
});

test('sanitizeNextPath rejects external / malformed paths', () => {
  for (const bad of [
    'https://evil.com', '//evil.com', '/\\evil.com', 'http://x', 'x/y',
    '', null, undefined, 'javascript:alert(1)', '/foo\\bar', '/a://b',
  ]) {
    assert.equal(sanitizeNextPath(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('ticket sign+verify roundtrip for the right tool', () => {
  const ticket = createSsoTicket({ username: 'KIV_LLC', tool: 'inkly', next: '/gallery' });
  const payload = verifySsoTicket(ticket, 'inkly');
  assert.ok(payload, 'expected a valid payload');
  assert.equal(payload.u, 'KIV_LLC');
  assert.equal(payload.tool, 'inkly');
  assert.equal(payload.next, '/gallery');
  assert.equal(typeof payload.iat, 'number');
  assert.equal(typeof payload.exp, 'number');
  assert.ok(payload.nonce);
});

test('ticket for one tool is rejected by another', () => {
  const ticket = createSsoTicket({ username: 'u', tool: 'inkly', next: '/' });
  assert.equal(verifySsoTicket(ticket, 'preply'), null);
  assert.equal(verifySsoTicket(ticket, 'batchly'), null);
});

test('expired ticket is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const ticket = createSsoTicket({ username: 'u', tool: 'preply', next: '/' }, { now: now - 120 });
  assert.equal(verifySsoTicket(ticket, 'preply'), null);
  // still valid inside the 60s window
  const fresh = createSsoTicket({ username: 'u', tool: 'preply', next: '/' }, { now: now - 30 });
  assert.ok(verifySsoTicket(fresh, 'preply'));
});

test('tampered ticket is rejected', () => {
  const ticket = createSsoTicket({ username: 'u', tool: 'batchly', next: '/' });
  // Mutate a char in the payload segment (before the dot) so the recomputed
  // signature can never match — mutating the last sig char is unreliable
  // because its low bits are base64 padding and may decode identically.
  const dot = ticket.indexOf('.');
  const flip = ticket[0] === 'e' ? 'f' : 'e';
  const evil = flip + ticket.slice(1);
  assert.notEqual(evil.slice(0, dot), ticket.slice(0, dot));
  assert.equal(verifySsoTicket(evil, 'batchly'), null);
});

test('ticket signed with a different secret is rejected', () => {
  const ticket = createSsoTicket({ username: 'u', tool: 'inkly', next: '/' }, { secret: 'another-secret-value-16+' });
  assert.equal(verifySsoTicket(ticket, 'inkly'), null); // verified with the env secret
});

test('ticket with an external next is neutralized to /', () => {
  // createSsoTicket sanitizes on the way in; verify also sanitizes on the way out.
  const ticket = createSsoTicket({ username: 'u', tool: 'inkly', next: 'https://evil.com' });
  const payload = verifySsoTicket(ticket, 'inkly');
  assert.equal(payload.next, '/');
});

test('tool session token roundtrip, tool-scoped', () => {
  const token = createToolSessionToken('inkly', 'KIV_LLC');
  const payload = verifyToolSessionToken(token, 'inkly');
  assert.ok(payload);
  assert.equal(payload.u, 'KIV_LLC');
  assert.equal(payload.tool, 'inkly');
  // wrong tool rejected
  assert.equal(verifyToolSessionToken(token, 'preply'), null);
});

test('tool session cookie is a browser-session cookie (no Max-Age/Expires)', () => {
  const header = newToolSessionCookieHeader('preply', 'u', { secure: true });
  assert.ok(header.startsWith(`${TOOL_SESSION_COOKIE.preply}=`));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Lax'));
  assert.ok(header.includes('Path=/'));
  assert.ok(header.includes('Secure'));
  assert.ok(!/Max-Age/i.test(header), 'must not set Max-Age');
  assert.ok(!/Expires/i.test(header), 'must not set Expires');
});

test('buildToolLaunchRedirect targets the hub launch with tool + safe next', () => {
  const url = new URL(buildToolLaunchRedirect('batchly', '/stores?x=1', 'https://hub.example'));
  assert.equal(url.origin, 'https://hub.example');
  assert.equal(url.pathname, '/auth/launch');
  assert.equal(url.searchParams.get('tool'), 'batchly');
  assert.equal(url.searchParams.get('next'), '/stores?x=1');
});

test('buildToolLaunchRedirect drops an unsafe next to /', () => {
  const url = new URL(buildToolLaunchRedirect('inkly', 'https://evil.com', 'https://hub.example'));
  assert.equal(url.searchParams.get('next'), '/');
});

test('callback paths: batchly is /api-prefixed, others are not', () => {
  assert.equal(TOOL_SSO_CALLBACK_PATH.inkly, '/auth/sso/callback');
  assert.equal(TOOL_SSO_CALLBACK_PATH.preply, '/auth/sso/callback');
  assert.equal(TOOL_SSO_CALLBACK_PATH.batchly, '/api/auth/sso/callback');
});

if (failed) { console.error(`\nlib/sso.js tests: FAILED (${failed})`); process.exit(1); }
console.log('\nlib/sso.js tests: OK');
