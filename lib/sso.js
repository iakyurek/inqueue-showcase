// Shared inQueue single-sign-on helpers (Node ESM).
//
// Problem this solves: on Render each service (hub, Inkly, Preply, Batchly) is a
// separate origin, so the hub's `inqueue_session` cookie is never sent to a tool
// domain. The tool sees no cookie and bounces to login — forever.
//
// Flow:
//   1. Hub dashboard links point at  /auth/launch?tool=<tool>&next=<relative>.
//   2. /auth/launch checks the hub session. If missing → /login?next=<launch>.
//      If present → mint a short-lived (60s) HMAC ticket and 302 to the tool's
//      SSO callback on the tool's own origin.
//   3. The tool's callback verifies the ticket, sets its OWN first-party
//      browser-session cookie (inqueue_<tool>_session), and 302s to `next`.
//   4. Every later request to the tool carries that first-party cookie.
//
// Both the ticket and the tool session are HMAC-SHA256 signed with the shared
// INQUEUE_SESSION_SECRET, base64url-encoded, matching the wire format in
// lib/auth.js. Batchly (Edge runtime) reimplements this with Web Crypto in
// batchly/src/lib/sso.ts; the format is identical so tickets verify there too.

import crypto from 'crypto';
import {
  signSessionToken,
  verifySessionToken,
  serializeCookie,
  parseCookies,
} from './auth.js';

export const SSO_TOOLS = ['inkly', 'preply', 'batchly'];
export const SSO_TICKET_TTL_SECONDS = 60;

// First-party session cookie each tool sets after a successful SSO callback.
// Distinct per tool so a cookie leaked/replayed at one tool can't authenticate
// at another, and so it never collides with the hub's `inqueue_session`.
export const TOOL_SESSION_COOKIE = {
  inkly: 'inqueue_inkly_session',
  preply: 'inqueue_preply_session',
  batchly: 'inqueue_batchly_session',
};

// Callback path on each tool that accepts the SSO ticket. Batchly is a Next.js
// app whose API routes live under /api, so it uses the /api-prefixed path.
export const TOOL_SSO_CALLBACK_PATH = {
  inkly: '/auth/sso/callback',
  preply: '/auth/sso/callback',
  batchly: '/api/auth/sso/callback',
};

export function isValidTool(tool) {
  return typeof tool === 'string' && SSO_TOOLS.includes(tool);
}

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

// Accept only a safe, in-app relative path. Rejects protocol-relative ("//x"),
// scheme-bearing ("https://x"), backslash tricks, control chars, and anything
// not starting with a single "/". Returns the path or null. Never returns an
// absolute/external URL, which is what stops open redirects.
export function sanitizeNextPath(next) {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return null;
  if (next[0] !== '/') return null;              // must be root-relative
  if (next[1] === '/' || next[1] === '\\') return null; // no //host or /\host
  if (next.includes('\\')) return null;          // no backslashes at all
  if (next.includes('://')) return null;         // no embedded scheme
  if (/[\u0000-\u001f\u007f]/.test(next)) return null; // no control chars
  return next;
}

// ---------------------------------------------------------------------------
// SSO ticket — short-lived, single-hop credential minted by the hub.
// Payload: { u, tool, next, iat, exp, nonce }
// ---------------------------------------------------------------------------
export function createSsoTicket({ username, tool, next }, options = {}) {
  if (!isValidTool(tool)) throw new Error(`createSsoTicket: invalid tool ${tool}`);
  const secret = getSecret(options);
  const now = typeof options.now === 'number' ? options.now : Math.floor(Date.now() / 1000);
  const ttl = Number(options.ttlSeconds || SSO_TICKET_TTL_SECONDS);
  const payload = {
    u: String(username),
    tool,
    next: sanitizeNextPath(next) || '/',
    iat: now,
    exp: now + ttl,
    nonce: base64UrlEncode(crypto.randomBytes(12)),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${base64UrlEncode(sig)}`;
}

// Verify a ticket for a specific tool. Returns the payload (with a sanitized
// `next`) or null on any failure: bad signature, malformed, expired, or wrong
// tool. Never logs the ticket value.
export function verifySsoTicket(ticket, expectedTool, options = {}) {
  if (typeof ticket !== 'string' || !ticket.includes('.')) return null;
  let secret;
  try { secret = getSecret(options); } catch { return null; }
  const dot = ticket.indexOf('.');
  const encoded = ticket.slice(0, dot);
  const providedSig = ticket.slice(dot + 1);
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest();
  let providedBuf;
  try { providedBuf = base64UrlDecode(providedSig); } catch { return null; }
  if (providedBuf.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedSig)) return null;
  let payload;
  try { payload = JSON.parse(base64UrlDecode(encoded).toString('utf8')); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.u !== 'string' || typeof payload.tool !== 'string') return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
  const now = typeof options.now === 'number' ? options.now : Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  if (expectedTool && payload.tool !== expectedTool) return null;
  return { ...payload, next: sanitizeNextPath(payload.next) || '/' };
}

// ---------------------------------------------------------------------------
// Tool session — the first-party cookie a tool sets after SSO. Reuses the
// signed-token wire format from lib/auth.js, tagged with the tool so a cookie
// minted for one tool can't be replayed as another's.
// ---------------------------------------------------------------------------
export function createToolSessionToken(tool, username, options = {}) {
  if (!isValidTool(tool)) throw new Error(`createToolSessionToken: invalid tool ${tool}`);
  return signSessionToken({ u: String(username), tool }, options);
}

export function verifyToolSessionToken(token, tool, options = {}) {
  const payload = verifySessionToken(token, options);
  if (!payload) return null;
  if (tool && payload.tool !== tool) return null;
  return payload;
}

// Build the Set-Cookie header for a tool session. No Max-Age / no Expires →
// a browser-session cookie (cleared when the browser closes). HttpOnly,
// SameSite=Lax, Path=/, Secure in production — inherited from serializeCookie.
export function newToolSessionCookieHeader(tool, username, options = {}) {
  const token = createToolSessionToken(tool, username, options);
  return serializeCookie(TOOL_SESSION_COOKIE[tool], token, { secure: options.secure });
}

// Read a tool's first-party session from a Node request, or null.
export function getToolSessionFromRequest(req, tool) {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies[TOOL_SESSION_COOKIE[tool]];
  if (!token) return null;
  return verifyToolSessionToken(token, tool);
}

// Build the hub URL a tool sends an unauthenticated browser to. Replaces the
// old direct /login redirect: the hub launch route re-checks the hub session
// and mints a fresh ticket, so the tool never needs to see the hub cookie.
export function buildToolLaunchRedirect(tool, currentPath, hubUrl) {
  const base = hubUrl || process.env.INQUEUE_HUB_URL || 'http://localhost:4000';
  const target = new URL('/auth/launch', base);
  target.searchParams.set('tool', tool);
  target.searchParams.set('next', sanitizeNextPath(currentPath) || '/');
  return target.toString();
}
