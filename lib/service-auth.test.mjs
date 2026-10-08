// Focused unit tests for lib/serviceAuth.js.
// Run: node lib/service-auth.test.mjs
import assert from 'node:assert/strict';

process.env.INQUEUE_SESSION_SECRET = 'test-secret-value-for-hmac-verification-only';

const {
  createServiceToken,
  verifyServiceToken,
  serviceAuthHeader,
  getServiceAuthFromRequest,
  SERVICE_TOKEN_TTL_SECONDS,
} = await import('./serviceAuth.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

console.log('lib/serviceAuth.js tests');

test('sign+verify roundtrip for the right audience', () => {
  const token = createServiceToken({ svc: 'hub', aud: 'preply' });
  const payload = verifyServiceToken(token, 'preply');
  assert.ok(payload);
  assert.equal(payload.svc, 'hub');
  assert.equal(payload.aud, 'preply');
  assert.equal(typeof payload.iat, 'number');
  assert.equal(payload.exp - payload.iat, SERVICE_TOKEN_TTL_SECONDS);
  assert.ok(payload.nonce);
});

test('token for one audience is rejected by another', () => {
  const token = createServiceToken({ svc: 'hub', aud: 'preply' });
  assert.equal(verifyServiceToken(token, 'batchly'), null);
  assert.equal(verifyServiceToken(token, 'hub'), null);
});

test('expired token is rejected', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = createServiceToken({ svc: 'hub', aud: 'batchly' }, { now: now - 120 });
  assert.equal(verifyServiceToken(token, 'batchly'), null);
  const fresh = createServiceToken({ svc: 'hub', aud: 'batchly' }, { now: now - 30 });
  assert.ok(verifyServiceToken(fresh, 'batchly'));
});

test('tampered payload is rejected', () => {
  const token = createServiceToken({ svc: 'hub', aud: 'preply' });
  const flip = token[0] === 'e' ? 'f' : 'e';
  assert.equal(verifyServiceToken(flip + token.slice(1), 'preply'), null);
});

test('token signed with a different secret is rejected', () => {
  const token = createServiceToken({ svc: 'hub', aud: 'preply' }, { secret: 'another-secret-value-16+' });
  assert.equal(verifyServiceToken(token, 'preply'), null);
});

test('malformed tokens are rejected', () => {
  for (const bad of ['', 'no-dot', 'a.b.c.d', null, undefined, 42, 'e30.']) {
    assert.equal(verifyServiceToken(bad, 'preply'), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('invalid aud at mint time throws', () => {
  assert.throws(() => createServiceToken({ svc: 'hub', aud: 'etsy' }));
  assert.throws(() => createServiceToken({ svc: '', aud: 'preply' }));
});

test('serviceAuthHeader + getServiceAuthFromRequest roundtrip', () => {
  const header = serviceAuthHeader('hub', 'batchly');
  assert.ok(header.startsWith('Bearer '));
  const req = { headers: { authorization: header } };
  const payload = getServiceAuthFromRequest(req, 'batchly');
  assert.ok(payload);
  assert.equal(payload.svc, 'hub');
  // wrong audience via request helper
  assert.equal(getServiceAuthFromRequest(req, 'preply'), null);
  // missing / non-Bearer headers
  assert.equal(getServiceAuthFromRequest({ headers: {} }, 'batchly'), null);
  assert.equal(getServiceAuthFromRequest({ headers: { authorization: 'Basic abc' } }, 'batchly'), null);
});

if (failed) { console.error(`\nlib/serviceAuth.js tests: FAILED (${failed})`); process.exit(1); }
console.log('\nlib/serviceAuth.js tests: OK');
