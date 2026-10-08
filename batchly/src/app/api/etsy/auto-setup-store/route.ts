import { NextRequest, NextResponse } from "next/server";
import { autoSetupStoreEtsyIds } from "@/lib/services/etsy";

export async function POST(req: NextRequest) {
  let storeId: string | undefined;
  let force = false;

  try {
    const body = await req.json() as { storeId?: unknown; force?: unknown };
    storeId = typeof body.storeId === "string" ? body.storeId.trim() : undefined;
    force = body.force === true;
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  try {
    const result = await autoSetupStoreEtsyIds(storeId, force);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    if (message === "STORE_NOT_CONNECTED") {
      return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
    }
    console.error(`[api/auto-setup-store] storeId=${storeId} error: ${message}`);
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
