import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateMadeToOrderReadinessProfile } from "@/lib/services/etsy";
import { isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";

export async function POST(req: NextRequest) {
  let storeId: string | undefined;

  try {
    const body = await req.json() as { storeId?: unknown };
    storeId = typeof body.storeId === "string" ? body.storeId : undefined;
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

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
    `[etsy/store-readiness-profile] storeId=${storeId} storeName=${store.name} ` +
    `storeFolder=${store.driveFolderName} etsyShopId=${store.etsyShopId}`,
  );

  try {
    const { profile, found } = await findOrCreateMadeToOrderReadinessProfile(storeId, 2, 5);
    const message = found
      ? "Existing made-to-order processing profile found."
      : "Made-to-order processing profile created.";
    console.log(
      `[etsy/store-readiness-profile] ${found ? "found" : "created"} — ` +
      `storeFolder=${store.driveFolderName} readiness_state_id=${profile.readiness_state_id}`,
    );
    return NextResponse.json({
      success: true,
      storeId,
      storeName: store.name,
      storeFolder: store.driveFolderName,
      etsyShopId: store.etsyShopId,
      found,
      profile,
      message,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    const etsyBody = (e as { etsyBody?: string }).etsyBody;
    console.error(
      `[etsy/store-readiness-profile] failed storeFolder=${store.driveFolderName}: ${message}`,
    );
    return NextResponse.json(
      { error: message, ...(etsyBody ? { etsyError: etsyBody } : {}) },
      { status: 500 },
    );
  }
}
