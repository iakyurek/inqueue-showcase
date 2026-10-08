// GET /api/etsy/listing-qa?storeId=<storeId>&listingId=<listingId>
// READ-ONLY. Does not create, edit, publish, activate, upload images, or update inventory.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";
import { runListingQA } from "@/lib/services/listingQa";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId")?.trim() ?? "";
  const listingId = req.nextUrl.searchParams.get("listingId")?.trim() ?? "";
  const expectedSku = req.nextUrl.searchParams.get("expectedSku")?.trim() || undefined;

  if (!storeId) return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  if (!listingId) return NextResponse.json({ error: "MISSING_LISTING_ID" }, { status: 400 });

  if (!/^\d+$/.test(listingId)) {
    return NextResponse.json({ error: "INVALID_LISTING_ID — must be numeric." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  if (!(await isStoreFolderEnabled(store.driveFolderName))) {
    return NextResponse.json(
      { error: `QA not enabled for ${store.driveFolderName}.` },
      { status: 403 },
    );
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  try {
    const result = await runListingQA(storeId, listingId, expectedSku);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/listing-qa] error storeId=${storeId} listingId=${listingId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
