import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDraftListing } from "@/lib/services/etsy";
import type { EtsyDraftListingPayload } from "@/lib/services/etsy";
import { TEST_STORE_FOLDER } from "@/lib/services/draftFlowHelpers";

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

  // Phase 6B restriction — Store A only
  if (store.driveFolderName !== TEST_STORE_FOLDER) {
    return NextResponse.json({ error: "PHASE_6B_STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // Read from DB — GlobalListingPreset + StoreEtsyIds
  const [preset, storeEtsyIds] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
  ]);

  if (!storeEtsyIds?.taxonomyId) {
    return NextResponse.json(
      { error: "Missing Store A taxonomyId. Save it in the Store Etsy IDs form on /stores first." },
      { status: 400 },
    );
  }

  if (!storeEtsyIds.shippingProfileId) {
    return NextResponse.json(
      { error: "Missing Store A shippingProfileId. Save it in the Store Etsy IDs form on /stores first." },
      { status: 400 },
    );
  }

  if (!storeEtsyIds.readinessStateId) {
    return NextResponse.json(
      { error: "Missing Store A readinessStateId. Save it in the Store Etsy IDs form on /stores first." },
      { status: 400 },
    );
  }

  console.log(
    `[etsy/draft-test] storeId=${storeId} storeName=${store.name} etsyShopId=${store.etsyShopId}`,
  );

  const testPayload: EtsyDraftListingPayload = {
    title: "Batchly Test Draft - Phase 6B",
    description:
      "This is a test draft listing created by Batchly during Phase 6B development. Do not activate.",
    price: preset?.defaultPrice ? parseFloat(preset.defaultPrice) : 9.99,
    quantity: preset?.defaultQuantity ?? 1,
    who_made: preset?.whoMade ?? "i_did",
    when_made: preset?.whenMade ?? "made_to_order",
    taxonomy_id: Number(storeEtsyIds.taxonomyId),
    shipping_profile_id: Number(storeEtsyIds.shippingProfileId),
    readiness_state_id: Number(storeEtsyIds.readinessStateId),
    tags: ["test", "draft", "development"],
    listing_type: preset?.listingType ?? "physical",
  };

  try {
    const result = await createDraftListing(storeId, testPayload);
    return NextResponse.json({ success: true, etsyListingId: result.listingId, title: result.title });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/draft-test] createDraftListing threw: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
