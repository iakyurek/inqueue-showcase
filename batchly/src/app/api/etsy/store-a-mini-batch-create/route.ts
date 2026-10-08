import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import { createDraftListing, uploadListingImage } from "@/lib/services/etsy";
import {
  TEST_STORE_FOLDER,
  findLatestManifestFolder,
  buildRowPreview,
  cleanTags,
  buildTestTitle,
  acquireDraftLock,
  releaseDraftLock,
  isPresetAndIdsError,
  loadPresetAndIds,
} from "@/lib/services/draftFlowHelpers";

const MAX_SELECTED = 3;
const LOCK_KEY = "Store_A/mini-batch";
const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

type RowStatus = "created" | "skipped" | "failed" | "partial" | "duplicate";

interface RowResult {
  designId: string;
  sku: string;
  title: string;
  eligible: boolean;
  status: RowStatus;
  listingId?: string;
  imagesAttempted: number;
  imagesUploaded: number;
  imageErrors: { file: string; error: string }[];
  warnings: string[];
  errors: string[];
}

export async function POST(req: NextRequest) {
  // ---------------------------------------------------------------------------
  // 1. Parse + validate request body
  // ---------------------------------------------------------------------------
  let storeId: string | undefined;
  let rawDesignIds: unknown;

  try {
    const body = await req.json() as { storeId?: unknown; designIds?: unknown };
    storeId = typeof body.storeId === "string" ? body.storeId : undefined;
    rawDesignIds = body.designIds;
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  if (!Array.isArray(rawDesignIds)) {
    return NextResponse.json({ error: "designIds must be an array of strings." }, { status: 400 });
  }

  const designIds = Array.from(new Set(
    (rawDesignIds as unknown[])
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim())
      .filter((d) => d.length > 0),
  ));

  if (designIds.length < 1) {
    return NextResponse.json({ error: "Select at least 1 Store A row to create." }, { status: 400 });
  }

  if (designIds.length > MAX_SELECTED) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SELECTED} selected Store A rows can be created at once.` },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Verify store
  // ---------------------------------------------------------------------------
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) {
    return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  }

  if (store.driveFolderName !== TEST_STORE_FOLDER) {
    return NextResponse.json({ error: "STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // 3. Load preset + storeEtsyIds
  // ---------------------------------------------------------------------------
  const presetResult = await loadPresetAndIds(storeId);
  if (isPresetAndIdsError(presetResult)) {
    return NextResponse.json({ error: presetResult.error }, { status: presetResult.status });
  }
  const { preset, storeEtsyIds } = presetResult;

  // ---------------------------------------------------------------------------
  // 4. Find manifest
  // ---------------------------------------------------------------------------
  const folderName = findLatestManifestFolder();
  if (!folderName) {
    return NextResponse.json(
      {
        error:
          "No downloaded batch found in workspace/downloads/. " +
          "Download a batch from Google Drive first.",
      },
      { status: 404 },
    );
  }

  const csvPath = path.join(DOWNLOADS_DIR, folderName, "batch_manifest.csv");
  const manifest = parseManifest(csvPath);
  const storeARows = manifest.rows.filter((r) => r.store_folder === TEST_STORE_FOLDER);

  // ---------------------------------------------------------------------------
  // 5. Acquire lock
  // ---------------------------------------------------------------------------
  if (!acquireDraftLock(LOCK_KEY)) {
    return NextResponse.json(
      { error: "A Store A mini-batch draft creation is already in progress. Wait for it to finish." },
      { status: 409 },
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Create DraftCreationRun record
  // ---------------------------------------------------------------------------
  const run = await prisma.draftCreationRun.create({
    data: {
      storeId,
      storeFolder: TEST_STORE_FOLDER,
      batchFolder: folderName,
      requestedDesignIds: designIds.join(","),
      status: "started",
    },
  });

  const results: RowResult[] = [];

  try {
    // -------------------------------------------------------------------------
    // 7. Process each selected designId sequentially
    // -------------------------------------------------------------------------
    for (const designId of designIds) {
      // Check for existing successful record — duplicate prevention
      const existing = await prisma.draftCreationRecord.findUnique({
        where: { storeId_batchFolder_designId: { storeId, batchFolder: folderName, designId } },
      });

      if (existing) {
        results.push({
          designId,
          sku: existing.sku ?? "",
          title: existing.title ?? "",
          eligible: true,
          status: "duplicate",
          listingId: existing.listingId ?? undefined,
          imagesAttempted: existing.imagesAttempted,
          imagesUploaded: existing.imagesUploaded,
          imageErrors: [],
          warnings: existing.warnings ? (JSON.parse(existing.warnings) as string[]) : [],
          errors: [
            existing.listingId
              ? `Draft already created for this batch/design. Listing ID: ${existing.listingId}`
              : "Draft already created for this batch/design.",
          ],
        });
        continue;
      }

      const row = storeARows.find((r) => r.design_id === designId);

      if (!row) {
        results.push({
          designId,
          sku: "",
          title: "",
          eligible: false,
          status: "failed",
          imagesAttempted: 0,
          imagesUploaded: 0,
          imageErrors: [],
          warnings: [],
          errors: [`Row for ${TEST_STORE_FOLDER} / ${designId} not found in manifest.`],
        });
        continue;
      }

      const preview = buildRowPreview(row, folderName, preset, storeEtsyIds);

      if (!preview.eligible) {
        results.push({
          designId,
          sku: row.sku,
          title: row.title,
          eligible: false,
          status: "skipped",
          imagesAttempted: 0,
          imagesUploaded: 0,
          imageErrors: [],
          warnings: preview.warnings,
          errors: preview.errors,
        });
        continue;
      }

      // Build payload
      let testTitle: string;
      try {
        testTitle = buildTestTitle(row.title);
      } catch (e) {
        results.push({
          designId,
          sku: row.sku,
          title: row.title,
          eligible: false,
          status: "failed",
          imagesAttempted: 0,
          imagesUploaded: 0,
          imageErrors: [],
          warnings: preview.warnings,
          errors: [e instanceof Error ? e.message : "INVALID_TITLE"],
        });
        continue;
      }

      const tags = cleanTags(row.tags);
      const price = row.price > 0 ? row.price : parseFloat(preset.defaultPrice) || 9.99;

      console.log(
        `[etsy/store-a-mini-batch-create] storeId=${storeId} designId=${designId} ` +
        `sku=${row.sku} folder=${folderName}`,
      );

      // Create draft
      let listingId: string;
      try {
        const draftResult = await createDraftListing(storeId, {
          title: testTitle,
          description: row.description,
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
        console.error(
          `[etsy/store-a-mini-batch-create] draft creation failed for ${designId}: ${message}`,
        );
        results.push({
          designId,
          sku: row.sku,
          title: row.title,
          eligible: true,
          status: "failed",
          imagesAttempted: 0,
          imagesUploaded: 0,
          imageErrors: [],
          warnings: preview.warnings,
          errors: [message],
        });
        continue;
      }

      // Upload images
      const imagePaths = preview.imageFiles.map((f) =>
        path.join(DOWNLOADS_DIR, folderName, TEST_STORE_FOLDER, designId, f),
      );

      let imagesUploaded = 0;
      const imageErrors: { file: string; error: string }[] = [];

      for (let i = 0; i < imagePaths.length; i++) {
        const imagePath = imagePaths[i];
        const basename = preview.imageFiles[i];
        const rank = i + 1;
        try {
          await uploadListingImage(storeId, listingId, imagePath, rank);
          imagesUploaded++;
        } catch (e) {
          const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
          imageErrors.push({ file: basename, error: message });
        }
      }

      const rowStatus: RowStatus = imageErrors.length > 0 ? "partial" : "created";

      // Persist successful/partial record — this is what blocks future duplicates
      await prisma.draftCreationRecord.create({
        data: {
          runId: run.id,
          storeId,
          storeFolder: TEST_STORE_FOLDER,
          batchFolder: folderName,
          designId,
          sku: row.sku,
          title: testTitle,
          listingId,
          status: rowStatus,
          imagesAttempted: imagePaths.length,
          imagesUploaded,
          warnings: JSON.stringify(preview.warnings),
          errors: JSON.stringify([]),
          imageErrors: JSON.stringify(imageErrors),
        },
      });

      results.push({
        designId,
        sku: row.sku,
        title: testTitle,
        eligible: true,
        status: rowStatus,
        listingId,
        imagesAttempted: imagePaths.length,
        imagesUploaded,
        imageErrors,
        warnings: preview.warnings,
        errors: [],
      });
    }
  } finally {
    releaseDraftLock(LOCK_KEY);
  }

  // ---------------------------------------------------------------------------
  // 8. Update DraftCreationRun
  // ---------------------------------------------------------------------------
  const createdCount = results.filter((r) => r.status === "created" || r.status === "partial").length;
  const skippedCount = results.filter((r) => r.status === "skipped" || r.status === "duplicate").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const duplicateCount = results.filter((r) => r.status === "duplicate").length;

  const runStatus =
    createdCount > 0 && failedCount === 0 ? "completed"
    : createdCount > 0 ? "partial"
    : "failed";

  await prisma.draftCreationRun.update({
    where: { id: run.id },
    data: {
      status: runStatus,
      createdCount,
      skippedCount,
      failedCount,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    runId: run.id,
    batchFolder: folderName,
    requestedCount: designIds.length,
    createdCount,
    skippedCount,
    failedCount,
    duplicateCount,
    results,
  });
}
