// Focused unit tests for lib/auth.js.
// Run: node lib/auth.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.INQUEUE_SESSION_SECRET = 'test-secret-value-for-hmac-verification-only';
process.env.INQUEUE_USERNAME = 'test-user';

// A test-fixture password. The real production password lives only in
// .env.local (gitignored). This suite is checking auth mechanics, so any
// non-empty string round-trips through PBKDF2 and back.
const TEST_PASSWORD = 'test-fixture-password-xyz';
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(TEST_PASSWORD, salt, 100000, 32, 'sha256');
process.env.INQUEUE_PASSWORD_HASH = `pbkdf2$100000$${salt.toString('hex')}$${hash.toString('hex')}`;

const {
  signSessionToken,
  verifySessionToken,
  parseCookies,
  serializeCookie,
  verifyPassword,
  verifyUsername,
  isPublicPath,
  enforceAuth,
  newSessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_COOKIE_NAME,
} = await import('./auth.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error('   ', err.message);
    process.exitCode = 1;
  }
}

console.log('lib/auth.js tests');

test('sign+verify roundtrip returns username', () => {
  const token = signSessionToken({ u: 'KIV_LLC' });
  const decoded = verifySessionToken(token);
  assert.equal(decoded.u, 'KIV_LLC');
  assert.equal(typeof decoded.exp, 'number');
});

test('tampered payload is rejected', () => {
  const token = signSessionToken({ u: 'KIV_LLC' });
  const [payload, sig] = token.split('.');
  const evilPayload = Buffer.from(JSON.stringify({ u: 'attacker', exp: 9999999999 })).toString('base64url');
  assert.equal(verifySessionToken(`${evilPayload}.${sig}`), null);
  assert.notEqual(payload, evilPayload);
});

test('tampered signature is rejected', () => {
  const token = signSessionToken({ u: 'KIV_LLC' });
  const [payload] = token.split('.');
  const badSig = Buffer.alloc(32, 0).toString('base64url');
  assert.equal(verifySessionToken(`${payload}.${badSig}`), null);
});

test('expired token is rejected', () => {
  const token = signSessionToken({ u: 'KIV_LLC' }, { ttlSeconds: -10 });
  assert.equal(verifySessionToken(token), null);
});

test('malformed inputs return null (no throw)', () => {
  assert.equal(verifySessionToken(''), null);
  assert.equal(verifySessionToken('nodotshere'), null);
  assert.equal(verifySessionToken('a.b.c.d'), null);
  assert.equal(verifySessionToken(null), null);
  assert.equal(verifySessionToken(undefined), null);
});

test('wrong secret cannot verify', () => {
  const token = signSessionToken({ u: 'KIV_LLC' });
  assert.equal(verifySessionToken(token, { secret: 'a-different-secret-value-of-sufficient-length' }), null);
});

test('parseCookies handles multiple values and URL-encoded values', () => {
  const cookies = parseCookies('a=1; b=hello%20world; inqueue_session=abc.def');
  assert.equal(cookies.a, '1');
  assert.equal(cookies.b, 'hello world');
  assert.equal(cookies.inqueue_session, 'abc.def');
});

test('serializeCookie sets HttpOnly, SameSite=Lax, Path=/', () => {
  const raw = serializeCookie('inqueue_session', 'val', { maxAge: 60, secure: false });
  assert.ok(raw.includes('HttpOnly'));
  assert.ok(raw.includes('SameSite=Lax'));
  assert.ok(raw.includes('Path=/'));
  assert.ok(raw.includes('Max-Age=60'));
  assert.ok(!raw.includes('Secure'));
});

test('serializeCookie sets Secure in production', () => {
  const raw = serializeCookie('x', 'y', { maxAge: 60, secure: true });
  assert.ok(raw.includes('Secure'));
});

test('verifyPassword accepts correct password against pbkdf2 hash', () => {
  assert.equal(verifyPassword(TEST_PASSWORD), true);
});

test('verifyPassword rejects wrong password', () => {
  assert.equal(verifyPassword('wrong'), false);
  assert.equal(verifyPassword(''), false);
  assert.equal(verifyPassword(TEST_PASSWORD + 'x'), false);
});

test('verifyUsername is case-sensitive', () => {
  assert.equal(verifyUsername('test-user'), true);
  assert.equal(verifyUsername('TEST-USER'), false);
  assert.equal(verifyUsername(''), false);
});

test('isPublicPath allows /login, /api/login, /api/logout, /api/auth/status', () => {
  assert.equal(isPublicPath('/login'), true);
  assert.equal(isPublicPath('/api/login'), true);
  assert.equal(isPublicPath('/api/logout'), true);
  assert.equal(isPublicPath('/api/auth/status'), true);
  assert.equal(isPublicPath('/'), false);
  assert.equal(isPublicPath('/api/batches'), false);
});

test('isPublicPath respects extra exempt prefixes (OAuth callbacks)', () => {
  const extras = ['/api/drive/oauth/callback', '/api/auth/etsy/callback', '/api/auth/google/callback'];
  assert.equal(isPublicPath('/api/drive/oauth/callback', extras), true);
  assert.equal(isPublicPath('/api/auth/etsy/callback', extras), true);
  assert.equal(isPublicPath('/api/auth/google/callback', extras), true);
  assert.equal(isPublicPath('/api/etsy/draft-from-manifest', extras), false);
});

test('enforceAuth redirects unauthenticated page to hub login', () => {
  const req = { url: '/', headers: { host: 'localhost:5500' } };
  const written = { code: null, headers: null, body: '' };
  const res = {
    writeHead(code, headers) { written.code = code; written.headers = headers; },
    end(body) { written.body = body || ''; },
  };
  const ok = enforceAuth(req, res, { hubUrl: 'http://localhost:4000' });
  assert.equal(ok, false);
  assert.equal(written.code, 302);
  assert.ok(written.headers.Location.startsWith('http://localhost:4000/login?next='));
});

test('enforceAuth returns 401 JSON for unauthenticated /api requests', () => {
  const req = { url: '/api/state', headers: { host: 'localhost:5500' } };
  const written = { code: null, headers: null, body: '' };
  const res = {
    writeHead(code, headers) { written.code = code; written.headers = headers; },
    end(body) { written.body = body || ''; },
  };
  const ok = enforceAuth(req, res);
  assert.equal(ok, false);
  assert.equal(written.code, 401);
  assert.deepEqual(JSON.parse(written.body), { error: 'UNAUTHENTICATED' });
});

test('enforceAuth admits requests carrying a valid session cookie', () => {
  const token = signSessionToken({ u: 'KIV_LLC' });
  const req = { url: '/api/state', headers: { host: 'localhost:5500', cookie: `inqueue_session=${token}` } };
  const res = { writeHead() { throw new Error('should not respond'); }, end() { throw new Error('should not respond'); } };
  assert.equal(enforceAuth(req, res), true);
});

test('enforceAuth admits an OAuth callback path via exemptPrefixes', () => {
  const req = { url: '/api/drive/oauth/callback?code=abc', headers: { host: 'localhost:3001' } };
  const res = { writeHead() { throw new Error('should not respond'); }, end() { throw new Error('should not respond'); } };
  assert.equal(enforceAuth(req, res, { exemptPrefixes: ['/api/drive/oauth/callback'] }), true);
});

test('newSessionCookieHeader produces a verifiable cookie', () => {
  const header = newSessionCookieHeader('KIV_LLC');
  const value = header.split(';')[0].split('=').slice(1).join('=');
  const decoded = verifySessionToken(value);
  assert.equal(decoded.u, 'KIV_LLC');
});

test('clearSessionCookieHeader has Max-Age=0 and empty value', () => {
  const header = clearSessionCookieHeader();
  assert.ok(header.startsWith(`${SESSION_COOKIE_NAME}=;`));
  assert.ok(header.includes('Max-Age=0'));
});

if (process.exitCode) {
  console.error('\nauth tests: FAILED');
} else {
  console.log('\nauth tests: OK');
}
