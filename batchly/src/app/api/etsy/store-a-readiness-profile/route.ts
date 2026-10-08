import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findOrCreateMadeToOrderReadinessProfile } from "@/lib/services/etsy";

export async function POST(req: NextRequest) {
  let storeId: string | undefined;
  let confirm: boolean = false;

  try {
    const body = await req.json() as { storeId?: unknown; confirm?: unknown };
    storeId = typeof body.storeId === "string" ? body.storeId : undefined;
    confirm = body.confirm === true;
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  if (!confirm) {
    return NextResponse.json({ error: "CONFIRM_REQUIRED" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) {
    return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  }

  if (store.driveFolderName !== "Store_A") {
    return NextResponse.json({ error: "STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  console.log(
    `[etsy/store-a-readiness-profile] storeId=${storeId} storeName=${store.name} etsyShopId=${store.etsyShopId}`,
  );

  try {
    const { profile, found } = await findOrCreateMadeToOrderReadinessProfile(storeId, 2, 5);
    const message = found
      ? "Existing made-to-order processing profile found."
      : "Made-to-order processing profile created.";
    console.log(
      `[etsy/store-a-readiness-profile] ${found ? "found" : "created"} — readiness_state_id=${profile.readiness_state_id}`,
    );
    return NextResponse.json({ success: true, found, profile, message });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    const etsyBody = (e as { etsyBody?: string }).etsyBody;
    console.error(`[etsy/store-a-readiness-profile] failed: ${message}`);
    return NextResponse.json(
      { error: message, ...(etsyBody ? { etsyError: etsyBody } : {}) },
      { status: 500 },
    );
  }
}
