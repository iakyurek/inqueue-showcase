import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStoreConfig } from "@/lib/services/etsy";
import { isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId");

  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) {
    return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  }

  if (!(await isStoreFolderEnabled(store.driveFolderName))) {
    return NextResponse.json(
      { error: `Store ${store.driveFolderName} is not enabled for Batchly operations.` },
      { status: 403 },
    );
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  console.log(
    `[etsy/store-config] storeId=${storeId} storeName=${store.name} ` +
    `storeFolder=${store.driveFolderName} etsyShopId=${store.etsyShopId}`,
  );

  try {
    const config = await fetchStoreConfig(storeId);
    return NextResponse.json(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/store-config] failed storeFolder=${store.driveFolderName}: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
