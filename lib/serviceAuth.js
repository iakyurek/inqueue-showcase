// Shared inQueue service-to-service authentication (Node ESM).
//
// Used for the hub's internal config-sync/proxy calls into Preply and Batchly
// (/api/internal/* endpoints). These are server-to-server requests, so no
// browser cookie is involved: the caller sends a short-lived HMAC token as
//   Authorization: Bearer <token>
// and the receiving tool verifies it with the shared INQUEUE_SESSION_SECRET.
//
// Wire format matches lib/auth.js / lib/sso.js:
//   token = base64url(payloadJson) + "." + base64url(HMAC-SHA256(payload))
// Payload: { svc, aud, iat, exp, nonce }
//   svc   — who is calling (e.g. "hub")
//   aud   — who the token is FOR (e.g. "preply" | "batchly"); receivers MUST
//           check aud so a token minted for one tool can't be replayed at another
//   exp   — short TTL (default 60s); these tokens are minted per request
//
// Batchly's Edge middleware reimplements verification with Web Crypto (same
// format); Preply/Node can import this module directly.

import crypto from 'crypto';

export const SERVICE_TOKEN_TTL_SECONDS = 60;
export const SERVICE_AUDIENCES = ['hub', 'preply', 'batchly'];

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getSecret(options = {}) {
  const secret = options.secret || process.env.INQUEUE_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('INQUEUE_SESSION_SECRET is missing or too short (need >=16 chars).');
  }
  return secret;
}

// Mint a service token. `svc` identifies the caller, `aud` the intended
// receiver. Tokens are cheap — mint one per outbound request.
export function createServiceToken({ svc, aud }, options = {}) {
  if (typeof svc !== 'string' || !svc) throw new Error('createServiceToken: svc required');
  if (!SERVICE_AUDIENCES.includes(aud)) throw new Error(`createServiceToken: invalid aud ${aud}`);
  const secret = getSecret(options);
  const now = typeof options.now === 'number' ? options.now : Math.floor(Date.now() / 1000);
  const ttl = Number(options.ttlSeconds || SERVICE_TOKEN_TTL_SECONDS);
  const payload = {
    svc,
    aud,
    iat: now,
    exp: now + ttl,
    nonce: base64UrlEncode(crypto.randomBytes(8)),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

// Verify a service token for a specific audience. Returns the payload or null
// on any failure: bad signature, malformed, expired, or wrong audience.
export function verifyServiceToken(token, expectedAud, options = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  let secret;
  try { secret = getSecret(options); } catch { return null; }
  const dot = token.indexOf('.');
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest();
  let providedBuf;
  try { providedBuf = base64UrlDecode(providedSig); } catch { return null; }
  if (providedBuf.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedSig)) return null;
  let payload;
  try { payload = JSON.parse(base64UrlDecode(encoded).toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.svc !== 'string' || typeof payload.aud !== 'string') return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  const now = typeof options.now === 'number' ? options.now : Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (expectedAud && payload.aud !== expectedAud) return null;
  return payload;
}

// Build the Authorization header value for an outbound internal request.
export function serviceAuthHeader(svc, aud, options = {}) {
  return `Bearer ${createServiceToken({ svc, aud }, options)}`;
}

// Extract + verify the Bearer token from a Node request. Returns payload or null.
export function getServiceAuthFromRequest(req, expectedAud, options = {}) {
  const header = req.headers?.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return verifyServiceToken(header.slice('Bearer '.length).trim(), expectedAud, options);
}
