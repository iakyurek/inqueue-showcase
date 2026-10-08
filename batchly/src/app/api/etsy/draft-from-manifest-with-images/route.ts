export const runtime = "nodejs";

import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createDraftListing, uploadListingImage } from "@/lib/services/etsy";
import {
  TEST_STORE_FOLDER,
  TEST_DESIGN_ID,
  cleanTags,
  buildTestTitle,
  buildListingDescription,
  checkTrademarkWarnings,
  acquireDraftLock,
  releaseDraftLock,
  loadPresetAndIds,
  isPresetAndIdsError,
  findManifestData,
} from "@/lib/services/draftFlowHelpers";

const LOCK_KEY = `${TEST_STORE_FOLDER}/${TEST_DESIGN_ID}`;

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

  if (store.driveFolderName !== TEST_STORE_FOLDER) {
    return NextResponse.json({ error: "PHASE_6D_STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  if (!acquireDraftLock(LOCK_KEY)) {
    return NextResponse.json(
      { error: "A Store A / D001 draft creation is already in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  try {
    const presetResult = await loadPresetAndIds(storeId);
    if (isPresetAndIdsError(presetResult)) {
      return NextResponse.json({ error: presetResult.error }, { status: presetResult.status });
    }
    const { preset, storeEtsyIds } = presetResult;

    const found = findManifestData(TEST_STORE_FOLDER, TEST_DESIGN_ID, true);
    if (!found) {
      return NextResponse.json(
        {
          error:
            `No manifest row found for ${TEST_STORE_FOLDER} / ${TEST_DESIGN_ID} in workspace/downloads/. ` +
            "Download a batch from Google Drive first.",
        },
        { status: 400 },
      );
    }

    const { row, folderName, images } = found;

    if (images.length === 0) {
      return NextResponse.json(
        {
          error:
            `No image files (.jpg, .jpeg, .png) found in workspace/downloads/${folderName}/${TEST_STORE_FOLDER}/${TEST_DESIGN_ID}/. ` +
            "Add images to the folder and try again.",
        },
        { status: 400 },
      );
    }

    let testTitle: string;
    try {
      testTitle = buildTestTitle(row.title);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "INVALID_TITLE" },
        { status: 400 },
      );
    }

    const tags = cleanTags(row.tags);
    if (tags.length === 0) {
      return NextResponse.json(
        { error: `No valid tags found in manifest row for ${TEST_STORE_FOLDER} / ${TEST_DESIGN_ID}.` },
        { status: 400 },
      );
    }

    const description = buildListingDescription(row.title, preset.descriptionTemplate);
    const warnings = checkTrademarkWarnings([row.title, row.description, row.tags, description]);
    const price = row.price > 0 ? row.price : parseFloat(preset.defaultPrice) || 9.99;

    console.log(
      `[etsy/draft-from-manifest-with-images] storeId=${storeId} storeName=${store.name} ` +
      `folder=${folderName} sku=${row.sku} images=${images.length}`,
    );

    // Step 1: Create draft
    let listingId: string;
    try {
      const draftResult = await createDraftListing(storeId, {
        title: testTitle,
        description,
        price,
        quantity: preset.defaultQuantity,
        who_made: preset.whoMade,
        when_made: preset.whenMade,
        taxonomy_id: Number(storeEtsyIds.taxonomyId),
        shipping_profile_id: Number(storeEtsyIds.shippingProfileId),
        readiness_state_id: Number(storeEtsyIds.readinessStateId),
        tags,
        listing_type: preset.listingType,
      });
      listingId = draftResult.listingId;
    } catch (e) {
      const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      console.error(`[etsy/draft-from-manifest-with-images] draft creation failed: ${message}`);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    // Step 2: Upload images one by one
    let imagesUploaded = 0;
    const imageErrors: { file: string; error: string }[] = [];

    for (let i = 0; i < images.length; i++) {
      const imagePath = images[i];
      const basename = path.basename(imagePath);
      const rank = i + 1;
      try {
        await uploadListingImage(storeId, listingId, imagePath, rank);
        imagesUploaded++;
      } catch (e) {
        const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
        imageErrors.push({ file: basename, error: message });
      }
    }

    return NextResponse.json({
      success: true,
      listingId,
      manifestFolder: folderName,
      title: testTitle,
      sku: row.sku,
      storeFolder: row.store_folder,
      designId: row.design_id,
      imagesAttempted: images.length,
      imagesUploaded,
      imageErrors,
      warnings,
    });
  } finally {
    releaseDraftLock(LOCK_KEY);
  }
}
