// Internal: hub → Batchly store-config sync. Authenticated by the service
// Bearer token in middleware.ts (aud=batchly) — no session cookie involved.
// Flag-aware: dry-run (default) reports a diff without writing; 'hub' mode
// applies. See src/lib/services/hubConfigSync.ts for the mapping rules.
import { NextRequest, NextResponse } from "next/server";
import { applyHubConfigSync } from "@/lib/services/hubConfigSync";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const result = await applyHubConfigSync(body);
  return NextResponse.json(result);
}
