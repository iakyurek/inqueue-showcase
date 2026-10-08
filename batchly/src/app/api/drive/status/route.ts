import { NextResponse } from "next/server";
import { getConnectionInfo, fetchAndStoreAccountEmail } from "@/lib/services/drive";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

export async function GET() {
  let info = await getConnectionInfo();
  // Lazily backfill the account email for connections made before it was
  // persisted at OAuth time. Read-only (drive.about.get), best-effort.
  if (info.connected && !info.email) {
    await fetchAndStoreAccountEmail();
    info = await getConnectionInfo();
  }
  return NextResponse.json(info);
}
