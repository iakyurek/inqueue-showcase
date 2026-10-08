import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  let body: { storeId?: string };
  try {
    body = await req.json() as { storeId?: string };
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { storeId } = body;
  if (!storeId) return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  // Clear all Etsy OAuth fields — keep StoreEtsyIds, batch history, store record
  await prisma.store.update({
    where: { id: storeId },
    data: {
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      etsyShopId: null,
      etsyShopName: null,
    },
  });

  return NextResponse.json({ ok: true, storeId, storeName: store.name });
}
