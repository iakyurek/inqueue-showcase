import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchStoreConfig } from "@/lib/services/etsy";

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

  // Read-only helper — Store A only
  if (store.driveFolderName !== "Store_A") {
    return NextResponse.json({ error: "STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  console.log(`[etsy/store-a-config] called for storeId=${storeId} storeName=${store.name} etsyShopId=${store.etsyShopId}`);

  try {
    const config = await fetchStoreConfig(storeId);
    return NextResponse.json(config);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/store-a-config] fetchStoreConfig threw: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
