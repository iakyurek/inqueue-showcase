// Edge middleware — gates every Batchly route behind the shared inQueue
// session cookie. The wire format matches lib/auth.js in the root repo:
//   cookie value = base64url(payloadJson) + "." + base64url(HMAC-SHA256(payload))
// Payload:      { u: string, exp: number (unix seconds) }
// Signing key:  process.env.INQUEUE_SESSION_SECRET (must match hub's env)
//
// Exempt:
//   - Etsy PKCE callback: /api/auth/etsy/callback   (Etsy redirects the browser
//     back with an authorization code; the code exchange itself is the auth.)
//   - Google Drive callback: /api/auth/google/callback (same reason).
//   - Static Next assets and the favicon (matched via the `matcher` below).

import { NextRequest, NextResponse } from "next/server";
import {
  verifyToolSession,
  verifyServiceAuthHeader,
  buildToolLaunchRedirect,
  TOOL_SESSION_COOKIE,
} from "@/lib/sso";

const SESSION_COOKIE = "inqueue_session";
const HUB_URL = process.env.INQUEUE_HUB_URL ?? "http://localhost:4000";

const EXEMPT_PATHS = new Set<string>([
  "/api/auth/etsy/callback",
  "/api/auth/google/callback",
  // The SSO ticket exchange runs before any Batchly session exists.
  "/api/auth/sso/callback",
]);

function base64UrlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyToken(token: string | undefined): Promise<{ u: string; exp: number } | null> {
  if (!token || !token.includes(".")) return null;
  const secret = process.env.INQUEUE_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    console.error("[batchly middleware] INQUEUE_SESSION_SECRET is missing/short — rejecting session.");
    return null;
  }
  const dot = token.indexOf(".");
  const encoded = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  if (!encoded || !providedSig) return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(encoded)));
  let provided: Uint8Array;
  try {
    provided = base64UrlToBytes(providedSig);
  } catch {
    return null;
  }
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: { u?: string; exp?: number };
  try {
    const bytes = base64UrlToBytes(encoded);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || typeof payload.u !== "string") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload as { u: string; exp: number };
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (EXEMPT_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === "/api/auth/status") return NextResponse.next();

  // Internal service endpoints (hub → Batchly): authenticated by a short-lived
  // HMAC Bearer token (aud=batchly), never by cookies. Deliberately NOT in
  // EXEMPT_PATHS — an invalid or missing token is a hard 401.
  if (pathname.startsWith("/api/internal/")) {
    const service = await verifyServiceAuthHeader(request.headers.get("authorization"));
    if (service) return NextResponse.next();
    return NextResponse.json({ error: "BAD_SERVICE_TOKEN" }, { status: 401 });
  }

  // Accept the hub's shared cookie (same-origin/local dev) OR this app's own
  // first-party SSO session (the only cookie present cross-origin on Render).
  const hubSession = await verifyToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (hubSession) return NextResponse.next();
  const toolSession = await verifyToolSession(request.cookies.get(TOOL_SESSION_COOKIE)?.value);
  if (toolSession) return NextResponse.next();

  // Unauthenticated: API → 401 JSON, page → 302 to the hub SSO launch, which
  // re-checks auth and hands back a fresh ticket for this tool.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const currentPath = pathname + request.nextUrl.search;
  return NextResponse.redirect(buildToolLaunchRedirect(currentPath, HUB_URL), 302);
}

// Skip Next internals and static files. Everything else — pages, API routes —
// runs through the gate. The exempt callback paths are re-checked above.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|assets/).*)",
  ],
};
