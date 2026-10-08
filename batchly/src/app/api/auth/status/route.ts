// Public — reports whether the current request carries a valid inQueue session
// cookie. Runs in the Node runtime so we can reuse Node's crypto for HMAC
// verification (the middleware uses Web Crypto for the same signature).
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyToolSession, TOOL_SESSION_COOKIE } from "@/lib/sso";

const SESSION_COOKIE = "inqueue_session";

function base64UrlDecode(input: string): Buffer {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function verify(token: string | undefined): { u: string; exp: number } | null {
  if (!token || !token.includes(".")) return null;
  const secret = process.env.INQUEUE_SESSION_SECRET;
  if (!secret || secret.length < 16) return null;
  const dot = token.indexOf(".");
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  let provided: Buffer;
  try { provided = base64UrlDecode(sig); } catch { return null; }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  let payload: { u?: string; exp?: number };
  try { payload = JSON.parse(base64UrlDecode(encoded).toString("utf8")); }
  catch { return null; }
  if (typeof payload.exp !== "number" || typeof payload.u !== "string") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload as { u: string; exp: number };
}

export async function GET(request: NextRequest) {
  // Either the shared hub cookie or this app's first-party SSO session counts.
  const session =
    verify(request.cookies.get(SESSION_COOKIE)?.value) ||
    (await verifyToolSession(request.cookies.get(TOOL_SESSION_COOKIE)?.value));
  return NextResponse.json({
    authenticated: Boolean(session),
    username: session?.u ?? null,
  });
}
