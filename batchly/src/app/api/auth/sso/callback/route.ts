// SSO callback — the hub bounces the browser here with a short-lived ticket.
// We verify it for this tool, set Batchly's first-party browser-session cookie,
// and continue to the validated `next` path. This route is EXEMPT in
// middleware.ts (the ticket itself is the credential; no session exists yet).
import { NextRequest, NextResponse } from "next/server";
import {
  verifySsoTicket,
  createToolSessionToken,
  buildToolLaunchRedirect,
  sanitizeNextPath,
  TOOL,
  TOOL_SESSION_COOKIE,
} from "@/lib/sso";

const HUB_URL = process.env.INQUEUE_HUB_URL ?? "http://localhost:4000";

export async function GET(req: NextRequest) {
  const ticket = req.nextUrl.searchParams.get("ticket") ?? undefined;
  const payload = await verifySsoTicket(ticket, TOOL);
  if (!payload) {
    // Malformed / expired / wrong-tool ticket → restart the launch so the hub
    // re-checks auth and mints a fresh one. Never trust an unverified ticket.
    return NextResponse.redirect(buildToolLaunchRedirect("/", HUB_URL), 302);
  }

  const token = await createToolSessionToken(payload.u);
  if (!token) {
    // Secret missing/misconfigured — refuse rather than set an unsigned cookie.
    return NextResponse.redirect(buildToolLaunchRedirect("/", HUB_URL), 302);
  }

  // Redirect to the validated relative path on THIS origin. A RELATIVE Location
  // (not an env-configured base URL) means the browser resolves it against the
  // public Batchly origin it already reached — so a missing/blank
  // NEXT_PUBLIC_BASE_URL can never bounce the user to localhost in production.
  // sanitizeNextPath guarantees a single-slash root-relative path, so this can
  // never become an open redirect.
  const next = sanitizeNextPath(payload.next) ?? "/";
  const response = new NextResponse(null, { status: 302, headers: { Location: next } });
  response.cookies.set(TOOL_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // No maxAge / expires → browser-session cookie.
  });
  return response;
}
