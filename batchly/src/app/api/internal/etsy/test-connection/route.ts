// Internal: hub → Batchly Etsy connection check. Authenticated by the service
// Bearer token in middleware.ts (aud=batchly).
//
// Read-only with respect to shop data: the only Etsy calls are the token
// refresh (an auth exchange) and two GETs for shop identity. No listings are
// created or modified. Never returns token material — only status + identity,
// plus the store's saved Etsy resource IDs so the hub's "Refresh IDs from
// Batchly" action can import them.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken, fetchShopIdentity } from "@/lib/services/etsy";

const SLOT_RE = /^Store_[A-H]$/;

export async function POST(req: NextRequest) {
  let body: { storeFolder?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const storeFolder = body.storeFolder ?? "";
  if (!SLOT_RE.test(storeFolder)) {
    return NextResponse.json({ error: "INVALID_STORE_FOLDER" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { driveFolderName: storeFolder },
    include: { etsyIds: true },
  });
  if (!store) {
    return NextResponse.json({ connected: false, reason: "store_not_found" });
  }

  const etsyIds = {
    taxonomyId: store.etsyIds?.taxonomyId ?? null,
    shippingProfileId: store.etsyIds?.shippingProfileId ?? null,
    readinessStateId: store.etsyIds?.readinessStateId ?? null,
    returnPolicyId: store.etsyIds?.returnPolicyId ?? null,
    sectionId: store.etsyIds?.sectionId ?? null,
  };

  if (!store.refreshToken) {
    return NextResponse.json({ connected: false, reason: "not_connected", etsyIds });
  }

  try {
    const accessToken = await refreshAccessToken(store.id);
    const shop = await fetchShopIdentity(accessToken);
    if (!shop) {
      // Token refresh worked but the identity fetch failed — report honestly.
      return NextResponse.json({
        connected: true,
        shopId: store.etsyShopId ?? null,
        shopName: store.etsyShopName ?? null,
        reason: "shop_identity_unavailable",
        etsyIds,
      });
    }
    return NextResponse.json({ connected: true, shopId: shop.shopId, shopName: shop.shopName, etsyIds });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "refresh_failed";
    // A failed refresh means the connection is NOT usable — never fake it.
    return NextResponse.json({ connected: false, reason, etsyIds });
  }
}
