import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import { createDraftListing, uploadListingImage, updateListingInventory } from "@/lib/services/etsy";
import { parseVariationOptions, buildDraftInventoryProducts } from "@/lib/services/inventoryHelpers";
import { listSupplementalImagesForPreset } from "@/lib/services/supplementalImageHelpers";
import { loadPresetSizeCharts, calcSizeChartSlots } from "@/lib/services/presetSizeCharts";
import {
  isStoreFolderEnabled,
  findLatestManifestFolder,
  buildRowPreview,
  cleanTags,
  buildTestTitle,
  buildListingDescription,
  acquireDraftLock,
  releaseDraftLock,
  isPresetAndIdsError,
  loadPresetAndIds,
} from "@/lib/services/draftFlowHelpers";
import { buildPreflight } from "@/lib/services/preflightHelpers";

const MAX_SELECTED = 3;
const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

type RowStatus = "created" | "skipped" | "failed" | "partial" | "duplicate";
type VariationInventoryStatus = "disabled" | "updated" | "failed" | "skipped";
type SupplementalImageStatus = "disabled" | "uploaded" | "none-found" | "partial" | "failed" | "skipped";

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
  variationInventoryStatus: VariationInventoryStatus;
  variationProductCount?: number;
  variationError?: string;
  supplementalImageStatus: SupplementalImageStatus;
  supplementalImagesAttempted: number;
  supplementalImagesUploaded: number;
  supplementalImageErrors: { file: string; error: string }[];
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
    return NextResponse.json({ error: "Select at least 1 row to create." }, { status: 400 });
  }

  if (designIds.length > MAX_SELECTED) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SELECTED} selected rows can be created at once.` },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // 2. Verify store — storeFolder derived from DB, never from client
  // ---------------------------------------------------------------------------
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { name: true, driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) {
    return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  }

  // Server-side enablement check — storeFolder always from DB, never from client
  const storeFolder = store.driveFolderName;
  if (!(await isStoreFolderEnabled(storeFolder))) {
    return NextResponse.json(
      { error: `Mini-batch creation is not enabled for ${storeFolder}.` },
      { status: 403 },
    );
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // 3. Load preset + storeEtsyIds + variation preset
  // ---------------------------------------------------------------------------
  const presetResult = await loadPresetAndIds(storeId);
  if (isPresetAndIdsError(presetResult)) {
    return NextResponse.json({ error: presetResult.error }, { status: presetResult.status });
  }
  const { preset, storeEtsyIds } = presetResult;

  const [variationPreset, supplementalPreset] = await Promise.all([
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
  ]);

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
  // Filter rows for this store only — storeFolder from DB
  const storeRows = manifest.rows.filter((r) => r.store_folder === storeFolder);

  // ---------------------------------------------------------------------------
  // 5. Server-side preflight enforcement — must pass before any Etsy calls
  // ---------------------------------------------------------------------------
  {
    // Load row previews for the selected design IDs only — read-only
    const existingRecords = await prisma.draftCreationRecord.findMany({
      where: { storeId, batchFolder: folderName },
      select: { designId: true, listingId: true, status: true },
    });
    const existingMap = new Map(existingRecords.map((r) => [r.designId, r]));
    const preflightRows = storeRows.map((row) => {
      const preview = buildRowPreview(row, folderName, preset, storeEtsyIds);
      return { ...preview, alreadyCreated: !!existingMap.get(row.design_id) };
    });

    const preflight = buildPreflight({
      store: { etsyShopId: store.etsyShopId, refreshToken: store.refreshToken },
      storeEtsyIds,
      rows: preflightRows,
      selectedDesignIds: designIds,
      preset,
      variationPreset: variationPreset ?? null,
      supplementalPreset: supplementalPreset ?? null,
      presetSizeCharts: loadPresetSizeCharts(),
    });

    if (!preflight.canCreate || preflight.status === "fail") {
      console.warn(
        `[etsy/store-mini-batch-create] preflight FAIL storeId=${storeId} storeFolder=${storeFolder} ` +
        `designIds=${designIds.join(",")} — blocking creation`,
      );
      return NextResponse.json(
        {
          error: "PREFLIGHT_FAILED",
          message: "Preflight checks failed. Fix the issues below before creating drafts.",
          preflight,
        },
        { status: 400 },
      );
    }

    // Warnings are non-fatal — include them in the eventual response context but allow creation
    if (preflight.status === "warning") {
      console.log(
        `[etsy/store-mini-batch-create] preflight WARN storeId=${storeId} storeFolder=${storeFolder} ` +
        `designIds=${designIds.join(",")} warnings=${preflight.checks.filter((c) => c.status === "warning").length}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Load preset size charts — hard stop if missing (preflight already checked,
  //    but we need the file list here for uploads)
  // ---------------------------------------------------------------------------
  const presetSizeChartsResult = loadPresetSizeCharts();
  if (!presetSizeChartsResult.found) {
    return NextResponse.json(
      {
        error: "PRESET_SIZE_CHARTS_MISSING",
        message: presetSizeChartsResult.error ?? "Preset size charts not found in assets/size-charts/.",
      },
      { status: 500 },
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Acquire per-store lock
  // ---------------------------------------------------------------------------
  const lockKey = `${storeFolder}/mini-batch`;
  if (!acquireDraftLock(lockKey)) {
    return NextResponse.json(
      { error: `A ${storeFolder} mini-batch draft creation is already in progress. Wait for it to finish.` },
      { status: 409 },
    );
  }

  // ---------------------------------------------------------------------------
  // 7. Create DraftCreationRun
  // ---------------------------------------------------------------------------
  const run = await prisma.draftCreationRun.create({
    data: {
      storeId,
      storeFolder,
      batchFolder: folderName,
      requestedDesignIds: designIds.join(","),
      status: "started",
    },
  });

  const results: RowResult[] = [];

  try {
    for (const designId of designIds) {
      // Duplicate check
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
          variationInventoryStatus: "skipped",
          supplementalImageStatus: "skipped",
          supplementalImagesAttempted: 0,
          supplementalImagesUploaded: 0,
          supplementalImageErrors: [],
        });
        continue;
      }

      const row = storeRows.find((r) => r.design_id === designId);

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
          errors: [`Row for ${storeFolder} / ${designId} not found in manifest.`],
          variationInventoryStatus: "skipped",
          supplementalImageStatus: "skipped",
          supplementalImagesAttempted: 0,
          supplementalImagesUploaded: 0,
          supplementalImageErrors: [],
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
          variationInventoryStatus: "skipped",
          supplementalImageStatus: "skipped",
          supplementalImagesAttempted: 0,
          supplementalImagesUploaded: 0,
          supplementalImageErrors: [],
        });
        continue;
      }

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
          variationInventoryStatus: "skipped",
          supplementalImageStatus: "skipped",
          supplementalImagesAttempted: 0,
          supplementalImagesUploaded: 0,
          supplementalImageErrors: [],
        });
        continue;
      }

      const tags = cleanTags(row.tags);
      const price = row.price > 0 ? row.price : parseFloat(preset.defaultPrice) || 9.99;
      const description = buildListingDescription(row.title, preset.descriptionTemplate);

      console.log(
        `[etsy/store-mini-batch-create] storeId=${storeId} storeFolder=${storeFolder} ` +
        `designId=${designId} sku=${row.sku} folder=${folderName}`,
      );

      // Create draft — uses store's own OAuth token and etsyShopId via createDraftListing
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
        console.error(
          `[etsy/store-mini-batch-create] draft creation failed storeFolder=${storeFolder} designId=${designId}: ${message}`,
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
          variationInventoryStatus: "skipped",
          supplementalImageStatus: "skipped",
          supplementalImagesAttempted: 0,
          supplementalImagesUploaded: 0,
          supplementalImageErrors: [],
        });
        continue;
      }

      // ---------------------------------------------------------------------------
      // Upload design/mockup images
      // ---------------------------------------------------------------------------
      const imagePaths = preview.imageFiles.map((f) =>
        path.join(DOWNLOADS_DIR, folderName, storeFolder, designId, f),
      );

      let imagesUploaded = 0;
      const imageErrors: { file: string; error: string }[] = [];

      for (let i = 0; i < imagePaths.length; i++) {
        try {
          await uploadListingImage(storeId, listingId, imagePaths[i], i + 1);
          imagesUploaded++;
        } catch (e) {
          const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
          imageErrors.push({ file: preview.imageFiles[i], error: message });
        }
      }

      // ---------------------------------------------------------------------------
      // Upload preset size chart images — appended after mockups, before supplemental
      // ---------------------------------------------------------------------------
      let sizeChartRankStart = imagesUploaded; // ranks are 1-based; charts go after successfully uploaded mockups
      {
        const { chartsToUpload, skipped, limitWarning } = calcSizeChartSlots(
          imagePaths.length,
          presetSizeChartsResult.charts.length,
        );

        if (limitWarning) {
          console.warn(`[etsy/store-mini-batch-create] size chart limit: ${limitWarning} listingId=${listingId}`);
        }

        console.log(
          `[etsy/store-mini-batch-create] uploading ${chartsToUpload} preset size chart(s)` +
          `${skipped > 0 ? ` (${skipped} skipped — image limit)` : ""} listingId=${listingId}`,
        );

        for (let i = 0; i < chartsToUpload; i++) {
          const chart = presetSizeChartsResult.charts[i];
          const rank = imagePaths.length + i + 1;
          try {
            await uploadListingImage(storeId, listingId, chart.absolutePath, rank);
            sizeChartRankStart++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "UNKNOWN_ERROR";
            console.error(
              `[etsy/store-mini-batch-create] size chart upload failed ` +
              `listingId=${listingId} file=${chart.basename}: ${msg}`,
            );
            // Size chart failures are logged but non-fatal — listing was already created
          }
        }
      }

      // ---------------------------------------------------------------------------
      // Upload supplemental images (size charts + promo) — non-blocking
      // ---------------------------------------------------------------------------
      let supplementalImageStatus: SupplementalImageStatus = "disabled";
      let supplementalImagesAttempted = 0;
      let supplementalImagesUploaded = 0;
      const supplementalImageErrors: { file: string; error: string }[] = [];

      if (supplementalPreset?.enabled) {
        const suppFiles = listSupplementalImagesForPreset(supplementalPreset);

        if (suppFiles.length === 0) {
          supplementalImageStatus = "none-found";
          console.log(
            `[etsy/store-mini-batch-create] no supplemental images found — listingId=${listingId}`,
          );
        } else {
          // Supplemental images go after mockups + size charts
          const designRankCount = sizeChartRankStart;
          const remainingSlots = Math.max(0, 10 - designRankCount);
          const toUpload = suppFiles.slice(0, Math.min(remainingSlots, supplementalPreset.maxSupplementalImages));
          supplementalImagesAttempted = toUpload.length;

          console.log(
            `[etsy/store-mini-batch-create] uploading ${toUpload.length} supplemental images ` +
            `(designRanks=${designRankCount} remainingSlots=${remainingSlots}) listingId=${listingId}`,
          );

          for (let i = 0; i < toUpload.length; i++) {
            const rank = designRankCount + i + 1;
            try {
              await uploadListingImage(storeId, listingId, toUpload[i].absolutePath, rank);
              supplementalImagesUploaded++;
            } catch (e) {
              const msg = e instanceof Error ? e.message : "UNKNOWN_ERROR";
              supplementalImageErrors.push({ file: toUpload[i].basename, error: msg });
              console.error(
                `[etsy/store-mini-batch-create] supplemental upload failed ` +
                `listingId=${listingId} file=${toUpload[i].basename}: ${msg}`,
              );
            }
          }

          if (supplementalImageErrors.length === 0) {
            supplementalImageStatus = "uploaded";
          } else if (supplementalImagesUploaded > 0) {
            supplementalImageStatus = "partial";
          } else {
            supplementalImageStatus = "failed";
          }
        }
      }

      // ---------------------------------------------------------------------------
      // Inventory update (variation preset) — non-blocking
      // ---------------------------------------------------------------------------
      let variationInventoryStatus: VariationInventoryStatus = "disabled";
      let variationProductCount: number | undefined;
      let variationError: string | undefined;

      if (variationPreset?.enabled) {
        const v1Options = parseVariationOptions(variationPreset.variation1Options);
        const v2Options = parseVariationOptions(variationPreset.variation2Options);
        const v1PropId = variationPreset.variation1PropertyId
          ? Number(variationPreset.variation1PropertyId)
          : null;
        const v2PropId = variationPreset.variation2PropertyId
          ? Number(variationPreset.variation2PropertyId)
          : null;

        if (!v1PropId || !v2PropId) {
          variationInventoryStatus = "failed";
          variationError = "Variation property IDs not configured. Save them in Settings → Global Variation Preset.";
          console.warn(
            `[etsy/store-mini-batch-create] variation preset enabled but property IDs missing — listingId=${listingId}`,
          );
        } else {
          const invResult = buildDraftInventoryProducts({
            baseSku: row.sku,
            price,
            quantityPerVariation: variationPreset.quantityPerVariation,
            variation1PropertyId: v1PropId,
            variation1Name: variationPreset.variation1Name,
            variation1Values: v1Options,
            variation2PropertyId: v2PropId,
            variation2Name: variationPreset.variation2Name,
            variation2Values: v2Options,
            readinessStateId: Number(storeEtsyIds.readinessStateId),
          });

          if (!invResult.ok) {
            variationInventoryStatus = "failed";
            variationError = invResult.error;
            console.warn(
              `[etsy/store-mini-batch-create] inventory build failed listingId=${listingId}: ${invResult.error}`,
            );
          } else {
            variationProductCount = invResult.combinationCount;
            try {
              await updateListingInventory(storeId, listingId, invResult.payload);
              variationInventoryStatus = "updated";
              console.log(
                `[etsy/store-mini-batch-create] inventory updated listingId=${listingId} products=${invResult.combinationCount}`,
              );
            } catch (e) {
              const msg = e instanceof Error ? e.message : "UNKNOWN_ERROR";
              variationInventoryStatus = "failed";
              variationError = msg;
              console.error(
                `[etsy/store-mini-batch-create] inventory update failed listingId=${listingId}: ${msg}`,
              );
            }
          }
        }
      }

      const allErrors: string[] = [];
      if (variationError) allErrors.push(variationError);
      if (supplementalImageErrors.length > 0) {
        allErrors.push(`${supplementalImageErrors.length} supplemental image(s) failed to upload.`);
      }

      const rowStatus: RowStatus =
        imageErrors.length > 0 ||
        variationInventoryStatus === "failed" ||
        supplementalImageStatus === "failed" ||
        supplementalImageStatus === "partial"
          ? "partial"
          : "created";

      await prisma.draftCreationRecord.create({
        data: {
          runId: run.id,
          storeId,
          storeFolder,
          batchFolder: folderName,
          designId,
          sku: row.sku,
          title: testTitle,
          listingId,
          status: rowStatus,
          imagesAttempted: imagePaths.length,
          imagesUploaded,
          warnings: JSON.stringify(preview.warnings),
          errors: JSON.stringify(allErrors),
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
        errors: allErrors,
        variationInventoryStatus,
        variationProductCount,
        variationError,
        supplementalImageStatus,
        supplementalImagesAttempted,
        supplementalImagesUploaded,
        supplementalImageErrors,
      });
    }
  } finally {
    releaseDraftLock(lockKey);
  }

  // ---------------------------------------------------------------------------
  // 8. Update DraftCreationRun
  // ---------------------------------------------------------------------------
  const createdCount = results.filter((r) => r.status === "created" || r.status === "partial").length;
  const partialCount = results.filter((r) => r.status === "partial").length;
  const skippedCount = results.filter((r) => r.status === "skipped" || r.status === "duplicate").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const duplicateCount = results.filter((r) => r.status === "duplicate").length;

  const runStatus =
    createdCount > 0 && failedCount === 0 ? "completed"
    : createdCount > 0 ? "partial"
    : "failed";

  await prisma.draftCreationRun.update({
    where: { id: run.id },
    data: { status: runStatus, createdCount, skippedCount, failedCount, completedAt: new Date() },
  });

  return NextResponse.json({
    success: true,
    runId: run.id,
    storeFolder,
    batchFolder: folderName,
    requestedCount: designIds.length,
    createdCount,
    partialCount,
    skippedCount,
    failedCount,
    duplicateCount,
    results,
  });
}
