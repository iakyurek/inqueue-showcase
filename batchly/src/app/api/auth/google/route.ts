import { NextResponse } from "next/server";
import { getAuthorizationUrl } from "@/lib/services/drive";

// Without this, Next statically prerenders the redirect at build time and
// bakes the consent URL (and any config error) into the bundle.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = getAuthorizationUrl();
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Configuration error";
    return NextResponse.redirect(
      `${process.env.GOOGLE_REDIRECT_URI?.replace("/api/auth/google/callback", "") ?? "http://localhost:3030"}/settings?drive=error&reason=${encodeURIComponent(msg)}`
    );
  }
}
