// Batchly-side SSO helpers — the counterpart to lib/sso.js in the repo root,
// reimplemented with Web Crypto so the identical code runs in both the Edge
// middleware (verify) and Node route handlers (verify + sign). Wire format
// matches the hub exactly:
//   value = base64url(payloadJson) + "." + base64url(HMAC-SHA256(payload))
// signed with the shared INQUEUE_SESSION_SECRET.
//
// Two credentials pass through here:
//   - SSO ticket  { u, tool, next, iat, exp, nonce }  — minted by the hub,
//     60s TTL, single hop, verified in the SSO callback route.
//   - Tool session { u, tool, exp }                   — this app's own
//     first-party cookie, set after a valid ticket, verified on every request.

export const TOOL = "batchly";
export const TOOL_SESSION_COOKIE = "inqueue_batchly_session";
export const TOOL_SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h, matches the hub

export interface TicketPayload {
  u: string;
  tool: string;
  next: string;
  iat: number;
  exp: number;
  nonce: string;
}
export interface SessionPayload {
  u: string;
  tool: string;
  exp: number;
}

function base64UrlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSign(encoded: string): Promise<Uint8Array | null> {
  const secret = process.env.INQUEUE_SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(encoded)));
}

// Accept only a safe root-relative path; anything else collapses to null so the
// caller falls back to "/". This is the open-redirect guard.
export function sanitizeNextPath(next: unknown): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return null;
  if (next[0] !== "/") return null;
  if (next[1] === "/" || next[1] === "\\") return null;
  if (next.includes("\\")) return null;
  if (next.includes("://")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  return next;
}

async function verifySigned(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!token || !token.includes(".")) return null;
  const dot = token.indexOf(".");
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!encoded || !providedSig) return null;
  const expected = await hmacSign(encoded);
  if (!expected) return null;
  let provided: Uint8Array;
  try {
    provided = base64UrlToBytes(providedSig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(provided, expected)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch {
    return null;
  }
}

// Verify an SSO ticket for the given tool. Returns the payload (with a
// sanitized `next`) or null on any failure. Never logs the ticket value.
export async function verifySsoTicket(
  ticket: string | undefined,
  expectedTool: string,
): Promise<TicketPayload | null> {
  const payload = await verifySigned(ticket);
  if (!payload) return null;
  if (typeof payload.u !== "string" || typeof payload.tool !== "string") return null;
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;
  if ((payload.exp as number) < Math.floor(Date.now() / 1000)) return null;
  if (expectedTool && payload.tool !== expectedTool) return null;
  const next = sanitizeNextPath(payload.next) || "/";
  return { ...(payload as unknown as TicketPayload), next };
}

// Verify this app's first-party session cookie. Returns the payload or null.
export async function verifyToolSession(
  token: string | undefined,
  tool: string = TOOL,
): Promise<SessionPayload | null> {
  const payload = await verifySigned(token);
  if (!payload) return null;
  if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
  if (typeof payload.tool !== "string" || payload.tool !== tool) return null;
  if ((payload.exp as number) < Math.floor(Date.now() / 1000)) return null;
  return payload as unknown as SessionPayload;
}

// Mint this app's first-party session token. Signed, tool-tagged, 12h server
// validity. Returns null if the secret is missing (caller must handle).
export async function createToolSessionToken(username: string): Promise<string | null> {
  const payload: SessionPayload = {
    u: String(username),
    tool: TOOL,
    exp: Math.floor(Date.now() / 1000) + TOOL_SESSION_TTL_SECONDS,
  };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSign(encoded);
  if (!sig) return null;
  return `${encoded}.${bytesToBase64Url(sig)}`;
}

// Build the hub launch URL for an unauthenticated visitor to this app.
export function buildToolLaunchRedirect(currentPath: string, hubUrl: string): string {
  const target = new URL("/auth/launch", hubUrl);
  target.searchParams.set("tool", TOOL);
  target.searchParams.set("next", sanitizeNextPath(currentPath) || "/");
  return target.toString();
}

// Send the browser back to the hub's Configure tab with a status query. Used by
// the Etsy OAuth flow when it was initiated from the hub (returnTo=hub sentinel
// in the single-use PKCE state file).
//
// The hub ORIGIN always comes from INQUEUE_HUB_URL on this server — never from
// a request parameter — so there is no open-redirect surface. Only the query
// values vary, and they are status codes we generate.
export function buildHubConfigureRedirect(hubUrl: string, params: Record<string, string>): string {
  const url = new URL("/configure", hubUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

// Canonicalize a store slot: accepts Store_A / store_a / STORE-A and returns
// the exact `Store_X` form Batchly stores in Store.driveFolderName. Anything
// else (display names like "NorthwindUS", junk, path traversal) → null.
export function canonicalStoreFolder(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^store[_-]?([a-h])$/i.exec(String(raw).trim());
  return match ? `Store_${match[1].toUpperCase()}` : null;
}

// ---------------------------------------------------------------------------
// Service-to-service auth (hub → Batchly internal endpoints).
// Wire format matches lib/serviceAuth.js at the repo root: HMAC token with
// payload { svc, aud, iat, exp, nonce }, sent as `Authorization: Bearer`.
// Receivers MUST pin the audience so a token minted for another tool can't be
// replayed here.
// ---------------------------------------------------------------------------

export interface ServiceTokenPayload {
  svc: string;
  aud: string;
  iat: number;
  exp: number;
}

export async function verifyServiceToken(
  token: string | undefined,
  expectedAud: string = TOOL,
): Promise<ServiceTokenPayload | null> {
  const payload = await verifySigned(token);
  if (!payload) return null;
  if (typeof payload.svc !== "string" || typeof payload.aud !== "string") return null;
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;
  if ((payload.exp as number) < Math.floor(Date.now() / 1000)) return null;
  if (payload.aud !== expectedAud) return null;
  return payload as unknown as ServiceTokenPayload;
}

// Extract + verify the Bearer token from a request's Authorization header.
export async function verifyServiceAuthHeader(
  authorization: string | null | undefined,
  expectedAud: string = TOOL,
): Promise<ServiceTokenPayload | null> {
  if (!authorization || !authorization.startsWith("Bearer ")) return null;
  return verifyServiceToken(authorization.slice("Bearer ".length).trim(), expectedAud);
}
