// Shared inQueue authentication utilities (Node ESM).
//
// Used by: root hub (server.js), Inkly (inkly/server.js), Preply (preply/server.js).
// Batchly (Next Edge middleware) reimplements verifySessionToken with Web Crypto
// because Node's `crypto` module is not available in the Edge runtime; the
// wire format and secret are identical so a cookie signed here verifies there.
//
// Design:
// - Stateless HMAC-SHA256 signed cookie. Payload is JSON `{u, exp}`.
// - Cookie format:  base64url(payloadJson) + "." + base64url(signature)
// - Signing key:    process.env.INQUEUE_SESSION_SECRET
// - TTL:            12 hours (SESSION_TTL_SECONDS)
// - Cookie flags:   HttpOnly, SameSite=Lax, Path=/, Secure when NODE_ENV=production
// - Password store: PBKDF2-SHA256 in INQUEUE_PASSWORD_HASH env var.
//                   Format: "pbkdf2$<iterations>$<saltHex>$<hashHex>"
//                   Fallback: INQUEUE_PASSWORD (plaintext) for local dev only,
//                   with a startup warning. Never log the value itself.

import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'inqueue_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours
export const DEFAULT_HUB_URL = process.env.INQUEUE_HUB_URL || 'http://localhost:4000';

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getSecret() {
  const secret = process.env.INQUEUE_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('INQUEUE_SESSION_SECRET is missing or too short (need >=16 chars).');
  }
  return secret;
}

// Sign a session token. `payload` is `{u: username}`; expiry is added automatically.
export function signSessionToken(payload, options = {}) {
  const secret = options.secret || getSecret();
  const ttl = Number(options.ttlSeconds || SESSION_TTL_SECONDS);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const body = { ...payload, exp };
  const encoded = base64UrlEncode(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

// Verify a token. Returns the decoded payload, or null if invalid/expired/tampered.
export function verifySessionToken(token, options = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const secret = options.secret || getSecret();
  const dot = token.indexOf('.');
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest();
  let providedBuf;
  try {
    providedBuf = base64UrlDecode(providedSig);
  } catch {
    return null;
  }
  if (providedBuf.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedSig)) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || !payload || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Parse the value of a Cookie: header into a { name: value } map.
export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

// Build a Set-Cookie value. `maxAge` in seconds; if 0 the cookie is cleared.
export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  const secure = options.secure ?? (process.env.NODE_ENV === 'production');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Verify a password against INQUEUE_PASSWORD_HASH. Supports:
//   - "pbkdf2$<iters>$<saltHex>$<hashHex>"  (recommended, production)
//   - INQUEUE_PASSWORD plaintext env var    (dev fallback, warns once)
let _plaintextWarned = false;
export function verifyPassword(password) {
  if (typeof password !== 'string' || !password) return false;
  const hashSpec = process.env.INQUEUE_PASSWORD_HASH;
  if (hashSpec) {
    const parts = hashSpec.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = Number(parts[1]);
    let salt, expected;
    try {
      salt = Buffer.from(parts[2], 'hex');
      expected = Buffer.from(parts[3], 'hex');
    } catch {
      return false;
    }
    if (!iterations || !salt.length || !expected.length) return false;
    const derived = crypto.pbkdf2Sync(password, salt, iterations, expected.length, 'sha256');
    return crypto.timingSafeEqual(derived, expected);
  }
  const plain = process.env.INQUEUE_PASSWORD;
  if (plain) {
    if (!_plaintextWarned) {
      console.warn('[auth] INQUEUE_PASSWORD (plaintext) fallback is active. Set INQUEUE_PASSWORD_HASH for production.');
      _plaintextWarned = true;
    }
    const a = Buffer.from(password);
    const b = Buffer.from(plain);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  return false;
}

export function verifyUsername(username) {
  const expected = process.env.INQUEUE_USERNAME;
  if (!expected) return false;
  if (typeof username !== 'string') return false;
  const a = Buffer.from(username);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Extract the session payload from a Node request, or null if unauthenticated.
export function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  return verifySessionToken(token);
}

// Route classifier: is this pathname public even without a session?
export function isPublicPath(pathname, extraExempt = []) {
  if (!pathname) return false;
  const alwaysPublic = new Set([
    '/login',
    '/login.js',
    '/config.js',
    '/api/login',
    '/api/logout',
    '/api/auth/status',
    '/favicon.ico',
  ]);
  if (alwaysPublic.has(pathname)) return true;
  for (const prefix of extraExempt) {
    if (pathname === prefix || pathname.startsWith(prefix)) return true;
  }
  return false;
}

// Build the URL to redirect an unauthenticated browser to. The hub owns the
// login page; each tool bounces back once auth completes.
export function buildLoginRedirect(currentUrl, hubUrl = DEFAULT_HUB_URL) {
  const target = new URL('/login', hubUrl);
  if (currentUrl) target.searchParams.set('next', currentUrl);
  return target.toString();
}

// Node http helper: gate a request. Returns true if authed. If not authed,
// writes the appropriate response (redirect or 401 JSON) and returns false.
export function enforceAuth(req, res, options = {}) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (isPublicPath(pathname, options.exemptPrefixes || [])) return true;
  if (getSessionFromRequest(req)) return true;
  const isApi = pathname.startsWith('/api/');
  if (isApi) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'UNAUTHENTICATED' }));
    return false;
  }
  const fullUrl = `${options.publicOrigin || `http://${req.headers.host}`}${req.url}`;
  const redirect = buildLoginRedirect(fullUrl, options.hubUrl || DEFAULT_HUB_URL);
  res.writeHead(302, { Location: redirect });
  res.end();
  return false;
}

// Build the Set-Cookie header value used at logout (Max-Age=0, empty value).
export function clearSessionCookieHeader() {
  return serializeCookie(SESSION_COOKIE_NAME, '', { maxAge: 0 });
}

// Build the Set-Cookie header value used at login.
export function newSessionCookieHeader(username, options = {}) {
  const token = signSessionToken({ u: username }, options);
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: options.ttlSeconds || SESSION_TTL_SECONDS,
    secure: options.secure,
  });
}
