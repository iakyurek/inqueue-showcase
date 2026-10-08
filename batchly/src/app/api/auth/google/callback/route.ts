import { type NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, fetchAndStoreAccountEmail } from "@/lib/services/drive";

// Base URL for post-OAuth redirects. Env-driven so Render deploys can point
// to the public HTTPS Batchly URL; falls back to the local dev port.
const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3030";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${BASE}/settings?drive=error&reason=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${BASE}/settings?drive=error&reason=missing_code`);
  }

  try {
    await exchangeCodeForTokens(code);
    // Persist the connected account email for status displays (best-effort).
    await fetchAndStoreAccountEmail();
    return NextResponse.redirect(`${BASE}/settings?drive=connected`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(`${BASE}/settings?drive=error&reason=${encodeURIComponent(msg)}`);
  }
}
