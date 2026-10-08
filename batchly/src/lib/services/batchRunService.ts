/**
 * batchRunService.ts
 *
 * Durable step-based batch runner (Phase 8B).
 *
 * Design: the frontend drives progress by calling POST /api/batches/runs/[runId]/step
 * repeatedly until done=true. Each step processes exactly one queued BatchRunRow.
 * This avoids HTTP timeouts on large batches (8 stores × 30 rows = 240 rows).
 *
 * Status transitions:
 *   BatchRun:      queued → running → completed | partial | failed
 *   BatchRunStore: queued → running → completed | partial | failed | skipped
 *   BatchRunRow:   queued → running → created | recovered_existing_draft
 *                  | partial | failed | skipped | duplicate
 *
 * Phase 4 additions:
 * - Etsy calls go through etsyFetch() with 429/5xx retry, Retry-After honor,
 *   and per-store token-refresh mutex.
 * - createDraftListing that fails ambiguously (server 5xx or network
 *   mid-flight) triggers findExistingDraftForRow() to check whether Etsy
 *   actually created the draft; if so we adopt the existing listingId
 *   instead of creating a second draft (row status = recovered_existing_draft).
 * - retryFailedRows reconciles before re-queueing so a failed row whose
 *   draft actually exists on Etsy is adopted, not re-created.
 */

import path from "path";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import {
  createDraftListing,
  uploadListingImage,
  updateListingInventory,
  findExistingDraftForRow,
  EtsyAmbiguousError,
} from "@/lib/services/etsy";
import { parseVariationOptions, buildDraftInventoryProducts, buildProfileInventoryProducts } from "@/lib/services/inventoryHelpers";
import { resolveVariationProfile } from "@/lib/services/variationProfiles";
import { listSupplementalImagesForPreset, listSizeChartImages } from "@/lib/services/supplementalImageHelpers";
import { assertUniqueStoreDriveFolders } from "@/lib/services/storeIntegrity";
import {
  isStoreFolderEnabled,
  buildRowPreview,
  cleanTags,
  buildTestTitle,
  buildListingDescription,
  acquireDraftLock,
  releaseDraftLock,
  ETSY_MAX_LISTING_IMAGES,
} from "@/lib/services/draftFlowHelpers";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");
const HARD_MAX_LISTINGS_PER_STORE = 30;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BatchRunProgress {
  runId: string;
  batchFolder: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalStores: number;
  totalRows: number;
  attempted: number;
  created: number;
  skipped: number;
  partial: number;
  failed: number;
  percentComplete: number;
  currentStore: string | null;
  currentDesignId: string | null;
  stores: BatchRunStoreProgress[];
}

export interface BatchRunStoreProgress {
  storeRunId: string;
  storeFolder: string;
  storeName: string;
  status: string;
  skipReason: string | null;
  attempted: number;
  created: number;
  skipped: number;
  partial: number;
  failed: number;
  rows: BatchRunRowProgress[];
}

export interface BatchRunRowProgress {
  rowId: string;
  designId: string;
  sku: string | null;
  title: string | null;
  status: string;
  listingId: string | null;
  imagesAttempted: number;
  imagesUploaded: number;
  variationInventoryStatus: string;
  supplementalImageStatus: string;
  supplementalImagesAttempted: number;
  supplementalImagesUploaded: number;
  errors: string[];
  warnings: string[];
}

export interface StepResult {
  done: boolean;
  processedDesignId: string | null;
  processedStoreFolder: string | null;
  rowStatus: string | null;
  progress: BatchRunProgress;
}

// ---------------------------------------------------------------------------
// createBatchRun
// Creates BatchRun + BatchRunStore + BatchRunRow records without any Etsy calls.
// ---------------------------------------------------------------------------

export async function createBatchRun(
  batchFolder: string,
  options: { maxListingsPerStore?: number; selectedStoreFolders?: string[] } = {},
): Promise<{ runId: string; totalStores: number; totalRows: number; storeCount: number; skippedStores: string[] }> {
  const maxListings = Math.min(
    options.maxListingsPerStore ?? HARD_MAX_LISTINGS_PER_STORE,
    HARD_MAX_LISTINGS_PER_STORE,
  );
  const selectedFolders = options.selectedStoreFolders?.length
    ? new Set(options.selectedStoreFolders)
    : null; // null = all stores

  // B5 guard: refuse to run if any two stores share a driveFolderName — a
  // duplicate makes the storeByFolder lookup below nondeterministic and could
  // create listings in the wrong Etsy shop.
  await assertUniqueStoreDriveFolders();

  const csvPath = path.join(DOWNLOADS_DIR, batchFolder, "batch_manifest.csv");
  const manifest = parseManifest(csvPath);
  if (manifest.errors.length > 0) {
    throw new Error(`MANIFEST_ERRORS: ${manifest.errors.map((e) => e.message).join("; ")}`);
  }

  const [preset, stores, storeEtsyIdsList] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.store.findMany({
      select: { id: true, name: true, driveFolderName: true, etsyShopId: true, refreshToken: true },
    }),
    prisma.storeEtsyIds.findMany(),
  ]);

  if (!preset) throw new Error("GLOBAL_PRESET_MISSING");

  const storeByFolder = new Map(stores.map((s) => [s.driveFolderName, s]));
  const storeEtsyIdsMap = new Map(storeEtsyIdsList.map((e) => [e.storeId, e]));
  const storesInManifest = Array.from(new Set(manifest.rows.map((r) => r.store_folder))).sort();

  const run = await prisma.batchRun.create({ data: { batchFolder, status: "queued" } });

  let totalRows = 0;
  let activeStoreCount = 0;
  const skippedStores: string[] = [];

  for (const storeFolder of storesInManifest) {
    let skipReason: string | null = null;
    let storeId: string | null = null;
    let storeName = storeFolder;

    if (selectedFolders && !selectedFolders.has(storeFolder)) {
      skipReason = `${storeFolder} not selected for this run`;
    } else {
      const dbStore = storeByFolder.get(storeFolder);
      if (!dbStore) {
        skipReason = `Store ${storeFolder} not configured in Batchly — add it via /stores with Drive Folder Name = "${storeFolder}"`;
      } else if (!(await isStoreFolderEnabled(storeFolder))) {
        skipReason = `"${storeFolder}" is not an enabled Batchly store folder`;
      } else {
        storeId = dbStore.id;
        storeName = dbStore.name;
        if (!dbStore.etsyShopId || !dbStore.refreshToken) {
          skipReason = `${storeFolder} is not connected to Etsy`;
        } else {
          const ids = storeEtsyIdsMap.get(dbStore.id);
          if (!ids?.taxonomyId || !ids.shippingProfileId || !ids.readinessStateId) {
            skipReason = `${storeFolder} is missing Etsy IDs (taxonomyId/shippingProfileId/readinessStateId)`;
          }
        }
      }
    }

    const storeRun = await prisma.batchRunStore.create({
      data: {
        runId: run.id,
        storeFolder,
        storeName,
        storeId,
        status: skipReason ? "skipped" : "queued",
        skipReason,
      },
    });

    if (skipReason) {
      skippedStores.push(storeFolder);
      continue;
    }

    const dbStore = storeByFolder.get(storeFolder)!;
    const storeEtsyIds = storeEtsyIdsMap.get(dbStore.id)!;
    const storeRows = manifest.rows.filter((r) => r.store_folder === storeFolder);

    const existingRecords = await prisma.draftCreationRecord.findMany({
      where: { storeId: dbStore.id, batchFolder },
      select: { designId: true, listingId: true },
    });
    const alreadyCreated = new Set(
      existingRecords
        .filter((r) => !!r.listingId)
        .map((r) => r.designId),
    );

    let rowsQueued = 0;
    for (const row of storeRows) {
      if (alreadyCreated.has(row.design_id)) {
        await prisma.batchRunRow.create({
          data: {
            runId: run.id,
            storeRunId: storeRun.id,
            storeFolder,
            batchFolder,
            designId: row.design_id,
            sku: row.sku,
            title: row.title,
            status: "duplicate",
          },
        });
        continue;
      }

      // Only check eligibility (and count against cap) for non-duplicate rows
      if (rowsQueued >= maxListings) {
        // Remaining rows are capped — skip recording them; they'll be eligible next run
        continue;
      }

      const preview = buildRowPreview(row, batchFolder, preset, storeEtsyIds);
      if (!preview.eligible) {
        await prisma.batchRunRow.create({
          data: {
            runId: run.id,
            storeRunId: storeRun.id,
            storeFolder,
            batchFolder,
            designId: row.design_id,
            sku: row.sku,
            title: row.title,
            status: "skipped",
            warnings: JSON.stringify(preview.warnings),
            errors: JSON.stringify(preview.errors),
          },
        });
        continue;
      }

      await prisma.batchRunRow.create({
        data: {
          runId: run.id,
          storeRunId: storeRun.id,
          storeFolder,
          batchFolder,
          designId: row.design_id,
          sku: row.sku,
          title: row.title,
          status: "queued",
        },
      });

      rowsQueued++;
      totalRows++;
    }

    if (rowsQueued === 0) {
      await prisma.batchRunStore.update({
        where: { id: storeRun.id },
        data: { status: "skipped", skipReason: "No eligible, not-yet-created rows found" },
      });
      skippedStores.push(storeFolder);
    } else {
      activeStoreCount++;
    }
  }

  await prisma.batchRun.update({
    where: { id: run.id },
    data: {
      totalStores: activeStoreCount,
      totalRows,
      status: totalRows > 0 ? "queued" : "completed",
    },
  });

  return {
    runId: run.id,
    totalStores: activeStoreCount,
    totalRows,
    storeCount: storesInManifest.length,
    skippedStores,
  };
}

// ---------------------------------------------------------------------------
// processNextRow
// Finds the next queued row and processes it. Returns done=true when finished.
// ---------------------------------------------------------------------------

export async function processNextRow(runId: string): Promise<StepResult> {
  const run = await prisma.batchRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("RUN_NOT_FOUND");
  if (run.status === "canceled") throw new Error("RUN_CANCELED");

  if (run.status === "queued") {
    await prisma.batchRun.update({ where: { id: runId }, data: { status: "running" } });
  }

  // Find next queued row — process stores in alphabetical order, rows in creation order
  const nextRow = await prisma.batchRunRow.findFirst({
    where: { runId, status: "queued" },
    orderBy: [{ storeFolder: "asc" }, { createdAt: "asc" }],
  });

  if (!nextRow) {
    const finalProgress = await finalizeBatchRun(runId);
    return { done: true, processedDesignId: null, processedStoreFolder: null, rowStatus: null, progress: finalProgress };
  }

  // Mark row as running
  await prisma.batchRunRow.update({
    where: { id: nextRow.id },
    data: { status: "running", startedAt: new Date() },
  });

  // Mark parent store as running if still queued
  const storeRun = await prisma.batchRunStore.findUnique({ where: { id: nextRow.storeRunId } });
  if (storeRun?.status === "queued") {
    await prisma.batchRunStore.update({
      where: { id: nextRow.storeRunId },
      data: { status: "running", startedAt: new Date() },
    });
  }

  // Load all data needed for creation
  const [preset, variationPreset, supplementalPreset, store, storeEtsyIds] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
    prisma.store.findFirst({
      where: { driveFolderName: nextRow.storeFolder },
      select: { id: true, name: true, etsyShopId: true, refreshToken: true },
    }),
    prisma.storeEtsyIds.findFirst({
      where: { store: { driveFolderName: nextRow.storeFolder } },
    }),
  ]);

  if (!preset || !store || !storeEtsyIds) {
    const missing = [!preset && "GlobalListingPreset", !store && "Store", !storeEtsyIds && "StoreEtsyIds"]
      .filter(Boolean)
      .join(", ");
    await _markRowFailed(nextRow.id, [`Missing configuration: ${missing}`]);
    await _updateStoreCounts(nextRow.storeRunId);
    await _updateRunCounts(runId);
    const progress = await getBatchRunProgress(runId);
    return { done: false, processedDesignId: nextRow.designId, processedStoreFolder: nextRow.storeFolder, rowStatus: "failed", progress };
  }

  // Acquire per-store lock to prevent concurrent Etsy calls for same store
  const lockKey = `${nextRow.storeFolder}/batch-run`;
  const locked = acquireDraftLock(lockKey);
  let rowStatus = "failed";

  try {
    if (!locked) {
      // Lock busy — just requeue cleanly without touching the row's error/completedAt fields
      await prisma.batchRunRow.update({
        where: { id: nextRow.id },
        data: { status: "queued", startedAt: null },
      });
      rowStatus = "queued";
    } else {
      rowStatus = await _processRow(
        nextRow,
        run,
        preset,
        variationPreset,
        supplementalPreset,
        store,
        storeEtsyIds,
      );
    }
  } finally {
    if (locked) releaseDraftLock(lockKey);
  }

  await _updateStoreCounts(nextRow.storeRunId);
  await _updateRunCounts(runId);

  const remainingQueued = await prisma.batchRunRow.count({ where: { runId, status: "queued" } });

  if (remainingQueued === 0) {
    const finalProgress = await finalizeBatchRun(runId);
    return { done: true, processedDesignId: nextRow.designId, processedStoreFolder: nextRow.storeFolder, rowStatus, progress: finalProgress };
  }

  const progress = await getBatchRunProgress(runId);
  return { done: false, processedDesignId: nextRow.designId, processedStoreFolder: nextRow.storeFolder, rowStatus, progress };
}

// ---------------------------------------------------------------------------
// _processRow — core single-row creation logic
// ---------------------------------------------------------------------------

async function _processRow(
  nextRow: {
    id: string;
    runId: string;
    storeRunId: string;
    storeFolder: string;
    batchFolder: string;
    designId: string;
    sku: string | null;
    title: string | null;
  },
  run: { id: string; batchFolder: string },
  preset: {
    id: string;
    whoMade: string;
    whenMade: string;
    listingType: string;
    renewalOption: string;
    isPersonalizable: boolean;
    defaultQuantity: number;
    defaultPrice: string;
    descriptionTemplate: string | null;
    materials: string;
    itemWeight: number;
    itemWeightUnit: string;
    itemLength: number;
    itemWidth: number;
    itemHeight: number;
    itemDimensionsUnit: string;
  },
  variationPreset: {
    id: string;
    enabled: boolean;
    variation1Name: string;
    variation1PropertyId: string | null;
    variation1Options: string;
    variation2Name: string;
    variation2PropertyId: string | null;
    variation2Options: string;
    quantityPerVariation: number;
  } | null,
  supplementalPreset: {
    id: string;
    enabled: boolean;
    includeSizeCharts: boolean;
    sizeChartRequiredCount?: number;
    includePromoImages: boolean;
    sizeChartFolder: string;
    promoFolder: string;
    maxSupplementalImages: number;
  } | null,
  store: { id: string; etsyShopId: string | null; refreshToken: string | null },
  storeEtsyIds: {
    id: string;
    storeId: string;
    taxonomyId: string | null;
    shippingProfileId: string | null;
    readinessStateId: string | null;
    returnPolicyId: string | null;
    sectionId: string | null;
  },
): Promise<string> {
  const { id: rowId, storeFolder, batchFolder, designId } = nextRow;

  // Parse manifest to get full row data (imageFiles come from buildRowPreview)
  const manifestPath = path.join(DOWNLOADS_DIR, batchFolder, "batch_manifest.csv");
  const manifest = parseManifest(manifestPath);
  const manifestRow = manifest.rows.find(
    (r) => r.store_folder === storeFolder && r.design_id === designId,
  );

  if (!manifestRow) {
    await _markRowFailed(rowId, [`Row not found in manifest: store=${storeFolder} design=${designId}`]);
    return "failed";
  }

  const preview = buildRowPreview(manifestRow, batchFolder, preset, storeEtsyIds);

  // Build listing fields
  let testTitle: string;
  try {
    testTitle = buildTestTitle(manifestRow.title);
  } catch (e) {
    await _markRowFailed(rowId, [e instanceof Error ? e.message : "INVALID_TITLE"]);
    return "failed";
  }

  const tags = cleanTags(manifestRow.tags);
  const price = manifestRow.price > 0 ? manifestRow.price : parseFloat(preset.defaultPrice) || 9.99;
  const description = buildListingDescription(manifestRow.title, preset.descriptionTemplate);

  // --- Variation-profile gate (hard stop before ANY Etsy write) ---
  // Each design carries a variation-profile key in the manifest. front_sided is
  // allowed (default, existing behavior); an unknown key or an incomplete/pending
  // profile (e.g. double_sided before its matrix is configured) fails the row
  // here so it never reaches createDraftListing. Draft-only safety unchanged.
  const profileResolution = await resolveVariationProfile(manifestRow.variation_profile);
  if (!profileResolution.usable) {
    await _markRowFailed(rowId, [profileResolution.reason || `Unsupported variation profile "${profileResolution.key}"`]);
    return "failed";
  }

  // --- Create draft listing ---
  // Reconciliation path: if a previous ambiguous failure left a draft on Etsy,
  // adopt it instead of creating a duplicate. We check BEFORE creating only if
  // there is no in-memory hint that this row is a first attempt — but the SKU
  // is unique per manifest row, so a pre-flight check is cheap enough on retry
  // and it stops the "500 after creation" race entirely. We do the pre-flight
  // only when the row has been touched before (existing DraftCreationRecord).
  // Empty string is the "not yet assigned" sentinel; every path below either
  // sets it to a real listingId or `return`s "failed" before reaching the
  // downstream image/inventory work. TS narrowing can't see across our try
  // / catch so we initialise here to unblock it.
  let listingId = "";
  let rowStatusFromCreation: "created" | "recovered_existing_draft" = "created";
  let adoptionInfo: { matchedBy: "sku" | "title" } | null = null;
  try {
    // Preflight adoption: if this design was attempted before for this store
    // and a matching draft exists on Etsy, adopt it and skip create.
    const priorAttempt = await prisma.draftCreationRecord.findUnique({
      where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId } },
      select: { status: true, listingId: true },
    });
    if (priorAttempt && !priorAttempt.listingId) {
      const existing = await findExistingDraftForRow(store.id, {
        sku: manifestRow.sku,
        title: testTitle,
      }).catch((err) => {
        console.warn(`[batchRunService] reconcile lookup failed ${storeFolder}/${designId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (existing) {
        listingId = existing.listingId;
        rowStatusFromCreation = "recovered_existing_draft";
        adoptionInfo = { matchedBy: existing.matchedBy };
        console.log(
          `[batchRunService] adopted existing draft store=${storeFolder} design=${designId} listingId=${listingId} matchedBy=${existing.matchedBy}`,
        );
      }
    }

    if (rowStatusFromCreation !== "recovered_existing_draft") {
      const materials = preset.materials
        ? preset.materials.split(",").map((m) => m.trim()).filter(Boolean)
        : [];
      const draftResult = await createDraftListing(store.id, {
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
        materials: materials.length > 0 ? materials : undefined,
        item_weight: preset.itemWeight || undefined,
        item_weight_unit: preset.itemWeightUnit || undefined,
        item_length: preset.itemLength || undefined,
        item_width: preset.itemWidth || undefined,
        item_height: preset.itemHeight || undefined,
        item_dimensions_unit: preset.itemDimensionsUnit || undefined,
      });
      listingId = draftResult.listingId;
    } else {
      // For adopted drafts we still need a variable value; `listingId` was set above.
      // TypeScript wants us to be explicit for the narrowing path.
    }
  } catch (e) {
    // Ambiguous 5xx/network — the draft may have been created. Reconcile.
    if (e instanceof EtsyAmbiguousError) {
      const existing = await findExistingDraftForRow(store.id, {
        sku: manifestRow.sku,
        title: testTitle,
      }).catch((err) => {
        console.warn(`[batchRunService] post-ambiguous reconcile failed ${storeFolder}/${designId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (existing) {
        console.log(
          `[batchRunService] adopted draft after ${e.reason} store=${storeFolder} design=${designId} listingId=${existing.listingId} matchedBy=${existing.matchedBy}`,
        );
        listingId = existing.listingId;
        rowStatusFromCreation = "recovered_existing_draft";
        adoptionInfo = { matchedBy: existing.matchedBy };
      } else {
        // No draft exists — safe to report failure without creating a phantom.
        const message = `${e.message} (reconciled: no matching draft found; safe to retry)`;
        console.error(`[batchRunService] ambiguous+no-draft ${storeFolder}/${designId}: ${message}`);
        await _markRowFailed(rowId, [message]);
        await prisma.draftCreationRecord.upsert({
          where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId } },
          create: {
            storeId: store.id, storeFolder, batchFolder, designId,
            sku: manifestRow.sku, title: testTitle,
            status: "failed", errors: JSON.stringify([message]),
          },
          update: { status: "failed", errors: JSON.stringify([message]), updatedAt: new Date() },
        });
        return "failed";
      }
    } else {
      const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      console.error(`[batchRunService] draft creation failed store=${storeFolder} design=${designId}: ${message}`);
      await _markRowFailed(rowId, [message]);
      // Persist a failed DraftCreationRecord so duplicate detection knows about this attempt
      await prisma.draftCreationRecord.upsert({
        where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId } },
        create: {
          storeId: store.id,
          storeFolder,
          batchFolder,
          designId,
          sku: manifestRow.sku,
          title: testTitle,
          status: "failed",
          errors: JSON.stringify([message]),
        },
        update: { status: "failed", errors: JSON.stringify([message]), updatedAt: new Date() },
      });
      return "failed";
    }
  }

  // If we adopted an existing draft, skip image + inventory work — those were
  // done on the previous attempt that created this listing (or the operator
  // will fix them manually on the recovered listing). Persist and return
  // immediately so a second draft is never created and no duplicate images.
  if (rowStatusFromCreation === "recovered_existing_draft") {
    const adoptionNote = `Adopted existing Etsy draft (matched by ${adoptionInfo?.matchedBy ?? "unknown"}) instead of creating a duplicate.`;
    await prisma.batchRunRow.update({
      where: { id: rowId },
      data: {
        status: "recovered_existing_draft",
        listingId,
        imagesAttempted: 0, imagesUploaded: 0,
        imageErrors: JSON.stringify([]),
        variationInventoryStatus: "adopted-existing",
        supplementalImageStatus: "adopted-existing",
        supplementalImagesAttempted: 0, supplementalImagesUploaded: 0,
        supplementalImageErrors: JSON.stringify([]),
        warnings: JSON.stringify([...preview.warnings, adoptionNote]),
        errors: JSON.stringify([]),
        completedAt: new Date(),
      },
    });
    await prisma.draftCreationRecord.upsert({
      where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId } },
      create: {
        storeId: store.id, storeFolder, batchFolder, designId,
        sku: manifestRow.sku, title: testTitle, listingId,
        status: "recovered_existing_draft",
        warnings: JSON.stringify([adoptionNote]),
        errors: JSON.stringify([]),
      },
      update: {
        listingId, title: testTitle,
        status: "recovered_existing_draft",
        warnings: JSON.stringify([adoptionNote]),
        errors: JSON.stringify([]),
        updatedAt: new Date(),
      },
    });
    console.log(
      `[batchRunService] recovered_existing_draft store=${storeFolder} design=${designId} listingId=${listingId} matchedBy=${adoptionInfo?.matchedBy}`,
    );
    return "recovered_existing_draft";
  }

  // --- Upload design/mockup images ---
  const imagePaths = preview.imageFiles.map((f) =>
    path.join(DOWNLOADS_DIR, batchFolder, storeFolder, designId, f),
  );
  let imagesUploaded = 0;
  const imageErrors: { file: string; error: string }[] = [];

  for (let i = 0; i < imagePaths.length; i++) {
    try {
      await uploadListingImage(store.id, listingId, imagePaths[i], i + 1);
      imagesUploaded++;
    } catch (e) {
      imageErrors.push({
        file: preview.imageFiles[i],
        error: e instanceof Error ? e.message : "UNKNOWN_ERROR",
      });
    }
  }

  // --- Upload supplemental images ---
  let supplementalImageStatus = "disabled";
  let supplementalImagesAttempted = 0;
  let supplementalImagesUploaded = 0;
  const supplementalImageErrors: { file: string; error: string }[] = [];

  if (supplementalPreset?.enabled) {
    const sizeCharts = supplementalPreset.includeSizeCharts
      ? listSizeChartImages(supplementalPreset)
      : [];
    const requiredSizeCharts = supplementalPreset.includeSizeCharts
      ? supplementalPreset.sizeChartRequiredCount ?? 3
      : 0;
    const promoFiles = supplementalPreset.includePromoImages
      ? listSupplementalImagesForPreset({ ...supplementalPreset, includeSizeCharts: false })
      : [];
    const orderedSupplementalFiles = [...sizeCharts, ...promoFiles];
    let uploadedSizeCharts = 0;

    if (orderedSupplementalFiles.length === 0) {
      supplementalImageStatus = "none-found";
    } else {
      const remainingSlots = Math.max(0, ETSY_MAX_LISTING_IMAGES - imagePaths.length);
      const toUpload = orderedSupplementalFiles.slice(
        0,
        Math.min(remainingSlots, supplementalPreset.maxSupplementalImages),
      );
      supplementalImagesAttempted = toUpload.length;

      if (toUpload.length === 0) {
        supplementalImageStatus = "none-found";
      } else {
        for (let i = 0; i < toUpload.length; i++) {
          const rank = imagePaths.length + i + 1;
          try {
            await uploadListingImage(store.id, listingId, toUpload[i].absolutePath, rank);
            supplementalImagesUploaded++;
            if (toUpload[i].category === "size-chart") uploadedSizeCharts++;
          } catch (e) {
            const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
            supplementalImageErrors.push({
              file: toUpload[i].basename,
              // Etsy tiers that still enforce the old 10-image cap reject the
              // 11th upload — surface the config fix instead of a bare error.
              error: /maximum|image limit|too many/i.test(message)
                ? `${message} — if this shop is capped at 10 images, set ETSY_MAX_LISTING_IMAGES=10 on the Batchly service.`
                : message,
            });
          }
        }
        supplementalImageStatus =
          supplementalImageErrors.length === 0
            ? "uploaded"
            : supplementalImagesUploaded > 0
              ? "partial"
              : "failed";
      }
    }

    if (requiredSizeCharts > 0) {
      const capacityForSizeCharts = Math.min(
        Math.max(0, ETSY_MAX_LISTING_IMAGES - imagePaths.length),
        supplementalPreset.maxSupplementalImages,
      );
      const expectedSizeChartsForListing = sizeCharts.length === 0
        ? requiredSizeCharts
        : Math.min(requiredSizeCharts, sizeCharts.length, capacityForSizeCharts);
      if (uploadedSizeCharts < expectedSizeChartsForListing) {
        supplementalImageStatus = supplementalImagesUploaded > 0 ? "partial" : "failed";
        supplementalImageErrors.push({
          file: "size-charts",
          error:
            `Expected ${expectedSizeChartsForListing} size chart image(s), ` +
            `uploaded ${Math.max(0, uploadedSizeCharts)}. Etsy image cap or upload errors prevented the full set.`,
        });
      }
    }
  }

  // --- Variation inventory ---
  let variationInventoryStatus = "disabled";
  let variationProductCount: number | undefined;
  let variationError: string | undefined;

  // A synced, complete variation profile (e.g. front_sided) drives the full
  // grid from its offerings. Until the profile is synced (no offerings yet), or
  // for the legacy simple preset, fall through to the existing behavior — no
  // regression. double_sided/unknown never reach here (blocked at the gate).
  const resolvedProfile = profileResolution.profile;
  const applyProfileMatrix = !!(
    resolvedProfile &&
    resolvedProfile.status === "complete" &&
    Array.isArray(resolvedProfile.offerings) &&
    resolvedProfile.offerings.length > 0
  );

  if (applyProfileMatrix && resolvedProfile) {
    // Reuse the Hub Variations panel property IDs as the Style / Primary-color
    // axis IDs (operator sets them from their real listing).
    const styleProp = variationPreset?.variation1PropertyId ? Number(variationPreset.variation1PropertyId) : null;
    const colorProp = variationPreset?.variation2PropertyId ? Number(variationPreset.variation2PropertyId) : null;
    if (!styleProp || !colorProp) {
      variationInventoryStatus = "failed";
      variationError = `Variation profile "${resolvedProfile.key}" needs the Style and Primary-color property IDs — set them in the Hub Variations panel.`;
    } else {
      const invResult = buildProfileInventoryProducts(
        { key: resolvedProfile.key, offerings: resolvedProfile.offerings as never, disabledCombinations: resolvedProfile.disabledCombinations as never },
        { baseSku: manifestRow.sku, stylePropertyId: styleProp, colorPropertyId: colorProp, readinessStateId: Number(storeEtsyIds.readinessStateId) },
      );
      if (!invResult.ok) {
        variationInventoryStatus = "failed";
        variationError = invResult.error;
      } else {
        variationProductCount = invResult.combinationCount;
        try {
          await updateListingInventory(store.id, listingId, invResult.payload);
          variationInventoryStatus = "profile-applied";
        } catch (e) {
          variationInventoryStatus = "failed";
          variationError = `${resolvedProfile.key} inventory update failed: ${e instanceof Error ? e.message : "UNKNOWN_ERROR"}`;
        }
      }
    }
  } else if (variationPreset?.enabled) {
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
      variationError = "Variation property IDs not configured";
    } else {
      const invResult = buildDraftInventoryProducts({
        baseSku: manifestRow.sku,
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
      } else {
        variationProductCount = invResult.combinationCount;
        try {
          await updateListingInventory(store.id, listingId, invResult.payload);
          variationInventoryStatus = "updated";
        } catch (e) {
          variationInventoryStatus = "failed";
          variationError = e instanceof Error ? e.message : "UNKNOWN_ERROR";
        }
      }
    }
  } else {
    // No variations: Etsy auto-creates a single inventory product with an empty
    // SKU. Write the manifest SKU onto that single product so the draft carries
    // the real SKU from batch_manifest.csv (requirement 4).
    if (manifestRow.sku) {
      const singleProductPayload = {
        products: [
          {
            sku: manifestRow.sku,
            property_values: [],
            offerings: [
              {
                price: Number(price.toFixed(2)),
                quantity: preset.defaultQuantity,
                is_enabled: true,
                readiness_state_id: Number(storeEtsyIds.readinessStateId),
              },
            ],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      };
      try {
        await updateListingInventory(store.id, listingId, singleProductPayload);
        variationInventoryStatus = "sku-set";
      } catch (e) {
        variationInventoryStatus = "failed";
        variationError = `SKU inventory update failed: ${e instanceof Error ? e.message : "UNKNOWN_ERROR"}`;
      }
    }
  }

  // --- Determine row status ---
  const allErrors: string[] = [];
  if (variationError) allErrors.push(variationError);
  if (supplementalImageErrors.length > 0)
    allErrors.push(`${supplementalImageErrors.length} supplemental image(s) failed`);
  if (imageErrors.length > 0)
    allErrors.push(`${imageErrors.length} design image(s) failed`);

  const rowStatus =
    imageErrors.length > 0 ||
    variationInventoryStatus === "failed" ||
    supplementalImageStatus === "failed" ||
    supplementalImageStatus === "partial"
      ? "partial"
      : "created";

  // --- Persist BatchRunRow result ---
  await prisma.batchRunRow.update({
    where: { id: rowId },
    data: {
      status: rowStatus,
      listingId,
      imagesAttempted: imagePaths.length,
      imagesUploaded,
      imageErrors: JSON.stringify(imageErrors),
      variationInventoryStatus,
      variationProductCount,
      variationError,
      supplementalImageStatus,
      supplementalImagesAttempted,
      supplementalImagesUploaded,
      supplementalImageErrors: JSON.stringify(supplementalImageErrors),
      warnings: JSON.stringify(preview.warnings),
      errors: JSON.stringify(allErrors),
      completedAt: new Date(),
    },
  });

  // --- Persist DraftCreationRecord for cross-run duplicate protection ---
  await prisma.draftCreationRecord.upsert({
    where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId } },
    create: {
      storeId: store.id,
      storeFolder,
      batchFolder,
      designId,
      sku: manifestRow.sku,
      title: testTitle,
      listingId,
      status: rowStatus,
      imagesAttempted: imagePaths.length,
      imagesUploaded,
      warnings: JSON.stringify(preview.warnings),
      errors: JSON.stringify(allErrors),
      imageErrors: JSON.stringify(imageErrors),
    },
    update: {
      listingId,
      title: testTitle,
      status: rowStatus,
      imagesAttempted: imagePaths.length,
      imagesUploaded,
      warnings: JSON.stringify(preview.warnings),
      errors: JSON.stringify(allErrors),
      imageErrors: JSON.stringify(imageErrors),
      updatedAt: new Date(),
    },
  });

  console.log(
    `[batchRunService] ${rowStatus} store=${storeFolder} design=${designId} listingId=${listingId}`,
  );
  return rowStatus;
}

// ---------------------------------------------------------------------------
// retryFailedRows
// Resets truly-failed rows (no listingId) to queued for re-processing.
// Partial rows with a listingId are repaired in place when the failed step can
// be safely retried without creating another Etsy draft.
// ---------------------------------------------------------------------------

export async function retryFailedRows(
  runId: string,
): Promise<{
  retriableCount: number;
  partialManualCount: number;
  repairedPartialCount: number;
  repairErrors: string[];
  recoveredExistingDraftCount: number;
}> {
  const run = await prisma.batchRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error("RUN_NOT_FOUND");

  const partialRows = await prisma.batchRunRow.findMany({
    where: { runId, status: "partial", listingId: { not: null } },
  });
  let repairedPartialCount = 0;
  const repairErrors: string[] = [];
  const touchedStoreRunIds = new Set<string>();

  for (const row of partialRows) {
    const repair = await _repairPartialRowInventory(row);
    if (repair.ok) {
      repairedPartialCount++;
      touchedStoreRunIds.add(row.storeRunId);
    } else {
      repairErrors.push(`${row.storeFolder}/${row.designId}: ${repair.error}`);
    }
  }

  // Phase 4: reconcile every failed row against Etsy BEFORE requeueing. A row
  // that failed with an ambiguous 5xx/network error might have created a
  // draft on Etsy already; requeueing blindly would create a duplicate.
  const failedRows = await prisma.batchRunRow.findMany({
    where: { runId, status: "failed", listingId: null },
  });
  let recoveredExistingDraftCount = 0;
  for (const row of failedRows) {
    const store = await prisma.store.findFirst({
      where: { driveFolderName: row.storeFolder },
      select: { id: true, refreshToken: true, etsyShopId: true },
    });
    if (!store?.refreshToken || !store.etsyShopId) continue;
    const existing = await findExistingDraftForRow(store.id, {
      sku: row.sku,
      title: row.title,
    }).catch((err) => {
      console.warn(`[batchRunService/retry] reconcile lookup failed ${row.storeFolder}/${row.designId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (!existing) continue;

    const adoptionNote = `Adopted existing Etsy draft on retry (matched by ${existing.matchedBy}) — no new draft created.`;
    await prisma.batchRunRow.update({
      where: { id: row.id },
      data: {
        status: "recovered_existing_draft",
        listingId: existing.listingId,
        errors: JSON.stringify([]),
        warnings: JSON.stringify([adoptionNote]),
        variationInventoryStatus: "adopted-existing",
        supplementalImageStatus: "adopted-existing",
        completedAt: new Date(),
      },
    });
    await prisma.draftCreationRecord.upsert({
      where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder: row.batchFolder, designId: row.designId } },
      create: {
        storeId: store.id, storeFolder: row.storeFolder, batchFolder: row.batchFolder, designId: row.designId,
        sku: row.sku, title: row.title, listingId: existing.listingId,
        status: "recovered_existing_draft",
        warnings: JSON.stringify([adoptionNote]),
      },
      update: {
        listingId: existing.listingId, title: row.title,
        status: "recovered_existing_draft",
        warnings: JSON.stringify([adoptionNote]),
        errors: JSON.stringify([]),
        updatedAt: new Date(),
      },
    });
    touchedStoreRunIds.add(row.storeRunId);
    recoveredExistingDraftCount += 1;
    console.log(
      `[batchRunService/retry] recovered_existing_draft ${row.storeFolder}/${row.designId} listingId=${existing.listingId} matchedBy=${existing.matchedBy}`,
    );
  }

  // Only reset truly-failed rows (no listing created, no draft found on Etsy).
  // Any row we just adopted has status="recovered_existing_draft" and will not
  // match this update.
  const result = await prisma.batchRunRow.updateMany({
    where: { runId, status: "failed" },
    data: {
      status: "queued",
      startedAt: null,
      completedAt: null,
      listingId: null,
      errors: null,
      variationError: null,
      imagesAttempted: 0,
      imagesUploaded: 0,
    },
  });

  if (result.count > 0) {
    await prisma.batchRun.update({
      where: { id: runId },
      data: { status: "running", completedAt: null },
    });

    // Reset store statuses where rows are now queued
    const affectedStoreRunIds = await prisma.batchRunRow.findMany({
      where: { runId, status: "queued" },
      select: { storeRunId: true },
      distinct: ["storeRunId"],
    });

    for (const { storeRunId } of affectedStoreRunIds) {
      await prisma.batchRunStore.update({
        where: { id: storeRunId },
        data: { status: "running", completedAt: null },
      });
    }
  }

  for (const storeRunId of Array.from(touchedStoreRunIds)) {
    await _updateStoreCounts(storeRunId);
  }
  if (repairedPartialCount > 0) {
    await _updateRunCounts(runId);
    const remainingQueued = await prisma.batchRunRow.count({ where: { runId, status: "queued" } });
    const remainingRunning = await prisma.batchRunRow.count({ where: { runId, status: "running" } });
    if (remainingQueued === 0 && remainingRunning === 0) {
      await finalizeBatchRun(runId);
    }
  }

  const remainingPartialWithListing = await prisma.batchRunRow.count({
    where: { runId, status: "partial", listingId: { not: null } },
  });

  return {
    retriableCount: result.count,
    partialManualCount: remainingPartialWithListing,
    repairedPartialCount,
    repairErrors,
    recoveredExistingDraftCount,
  };
}

async function _repairPartialRowInventory(row: {
  id: string;
  runId: string;
  storeRunId: string;
  storeFolder: string;
  batchFolder: string;
  designId: string;
  listingId: string | null;
  imageErrors: string | null;
  supplementalImageErrors: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!row.listingId) return { ok: false, error: "No Etsy listing ID is available to repair." };

  const [preset, variationPreset, store, storeEtsyIds] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.globalVariationPreset.findFirst(),
    prisma.store.findFirst({
      where: { driveFolderName: row.storeFolder },
      select: { id: true },
    }),
    prisma.storeEtsyIds.findFirst({
      where: { store: { driveFolderName: row.storeFolder } },
    }),
  ]);

  if (!preset || !store || !storeEtsyIds) {
    const missing = [!preset && "GlobalListingPreset", !store && "Store", !storeEtsyIds && "StoreEtsyIds"]
      .filter(Boolean)
      .join(", ");
    return { ok: false, error: `Missing configuration: ${missing}` };
  }

  const manifestPath = path.join(DOWNLOADS_DIR, row.batchFolder, "batch_manifest.csv");
  const manifest = parseManifest(manifestPath);
  const manifestRow = manifest.rows.find(
    (r) => r.store_folder === row.storeFolder && r.design_id === row.designId,
  );
  if (!manifestRow) {
    return { ok: false, error: `Row not found in manifest: ${row.storeFolder}/${row.designId}` };
  }

  const price = manifestRow.price > 0 ? manifestRow.price : parseFloat(preset.defaultPrice) || 9.99;
  let variationInventoryStatus = "disabled";
  let variationProductCount: number | undefined;

  try {
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
        return { ok: false, error: "Variation property IDs are not configured." };
      }

      const invResult = buildDraftInventoryProducts({
        baseSku: manifestRow.sku,
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
      if (!invResult.ok) return { ok: false, error: invResult.error };

      await updateListingInventory(store.id, row.listingId, invResult.payload);
      variationInventoryStatus = "updated";
      variationProductCount = invResult.combinationCount;
    } else {
      await updateListingInventory(store.id, row.listingId, {
        products: [
          {
            sku: manifestRow.sku,
            property_values: [],
            offerings: [
              {
                price: Number(price.toFixed(2)),
                quantity: preset.defaultQuantity,
                is_enabled: true,
                readiness_state_id: Number(storeEtsyIds.readinessStateId),
              },
            ],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      });
      variationInventoryStatus = "sku-set";
      variationProductCount = 1;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    await prisma.batchRunRow.update({
      where: { id: row.id },
      data: {
        variationInventoryStatus: "failed",
        variationError: message,
        errors: JSON.stringify([`SKU inventory update failed: ${message}`]),
        completedAt: new Date(),
      },
    });
    return { ok: false, error: message };
  }

  const imageErrorsRemain = storedJsonArrayHasEntries(row.imageErrors);
  const supplementalErrorsRemain = storedJsonArrayHasEntries(row.supplementalImageErrors);
  const rowStatus = imageErrorsRemain || supplementalErrorsRemain ? "partial" : "created";
  const remainingErrors = rowStatus === "created" ? [] : ["Non-inventory post-create errors remain."];

  await prisma.batchRunRow.update({
    where: { id: row.id },
    data: {
      status: rowStatus,
      variationInventoryStatus,
      variationProductCount,
      variationError: null,
      errors: JSON.stringify(remainingErrors),
      completedAt: new Date(),
    },
  });

  await prisma.draftCreationRecord.updateMany({
    where: {
      storeId: store.id,
      batchFolder: row.batchFolder,
      designId: row.designId,
      listingId: row.listingId,
    },
    data: {
      status: rowStatus,
      errors: JSON.stringify(remainingErrors),
      updatedAt: new Date(),
    },
  });

  console.log(
    `[batchRunService] repaired partial inventory store=${row.storeFolder} ` +
      `design=${row.designId} listingId=${row.listingId} status=${rowStatus}`,
  );
  return { ok: true };
}

function storedJsonArrayHasEntries(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return value.trim().length > 0;
  }
}

// ---------------------------------------------------------------------------
// getBatchRunProgress
// ---------------------------------------------------------------------------

function parseStoredStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    return [String(parsed)];
  } catch {
    return [value];
  }
}

export async function getBatchRunProgress(runId: string): Promise<BatchRunProgress> {
  const run = await prisma.batchRun.findUnique({
    where: { id: runId },
    include: {
      stores: {
        include: { rows: { orderBy: { createdAt: "asc" } } },
        orderBy: { storeFolder: "asc" },
      },
    },
  });

  if (!run) throw new Error("RUN_NOT_FOUND");

  const percentComplete =
    run.totalRows > 0 ? Math.round((run.attempted / run.totalRows) * 100) : 0;

  // Find the currently running row (if any)
  let currentStore: string | null = null;
  let currentDesignId: string | null = null;
  for (const store of run.stores) {
    const runningRow = store.rows.find((r) => r.status === "running");
    if (runningRow) {
      currentStore = store.storeFolder;
      currentDesignId = runningRow.designId;
      break;
    }
  }

  const stores: BatchRunStoreProgress[] = run.stores.map((s) => ({
    storeRunId: s.id,
    storeFolder: s.storeFolder,
    storeName: s.storeName,
    status: s.status,
    skipReason: s.skipReason,
    attempted: s.attempted,
    created: s.created,
    skipped: s.skipped,
    partial: s.partial,
    failed: s.failed,
    rows: s.rows.map((r) => ({
      rowId: r.id,
      designId: r.designId,
      sku: r.sku,
      title: r.title,
      status: r.status,
      listingId: r.listingId,
      imagesAttempted: r.imagesAttempted,
      imagesUploaded: r.imagesUploaded,
      variationInventoryStatus: r.variationInventoryStatus,
      supplementalImageStatus: r.supplementalImageStatus,
      supplementalImagesAttempted: r.supplementalImagesAttempted,
      supplementalImagesUploaded: r.supplementalImagesUploaded,
      errors: parseStoredStringArray(r.errors),
      warnings: parseStoredStringArray(r.warnings),
    })),
  }));

  return {
    runId: run.id,
    batchFolder: run.batchFolder,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    totalStores: run.totalStores,
    totalRows: run.totalRows,
    attempted: run.attempted,
    created: run.created,
    skipped: run.skipped,
    partial: run.partial,
    failed: run.failed,
    percentComplete,
    currentStore,
    currentDesignId,
    stores,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _markRowFailed(rowId: string, errors: string[]) {
  await prisma.batchRunRow.update({
    where: { id: rowId },
    data: { status: "failed", errors: JSON.stringify(errors), completedAt: new Date() },
  });
}

async function _updateStoreCounts(storeRunId: string) {
  const rows = await prisma.batchRunRow.findMany({ where: { storeRunId } });
  const created = rows.filter((r) => r.status === "created").length;
  const recovered = rows.filter((r) => r.status === "recovered_existing_draft").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const attempted = rows.filter(
    (r) => !["queued", "duplicate", "skipped"].includes(r.status),
  ).length;

  const allDone = rows.every((r) => !["queued", "running"].includes(r.status));
  // "recovered_existing_draft" is a successful outcome (no duplicate created)
  // and rolls up the same as "created" for status purposes.
  const succeeded = created + recovered;
  const status = !allDone
    ? "running"
    : partial > 0
      ? "partial"
      : failed > 0 && succeeded > 0
        ? "partial"
        : failed > 0
          ? "failed"
          : succeeded > 0
            ? "completed"
            : "skipped";

  await prisma.batchRunStore.update({
    where: { id: storeRunId },
    data: {
      attempted,
      // Both "created" (new draft) and "recovered_existing_draft" (adopted an
      // existing draft after ambiguous failure) count as successful drafts.
      // "partial" is folded in for backwards-compatible progress percentages.
      created: created + recovered + partial,
      partial,
      failed,
      skipped,
      status,
      ...(allDone ? { completedAt: new Date() } : {}),
    },
  });
}

async function _updateRunCounts(runId: string) {
  const rows = await prisma.batchRunRow.findMany({ where: { runId } });
  const created = rows.filter((r) => r.status === "created").length;
  const recovered = rows.filter((r) => r.status === "recovered_existing_draft").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const attempted = rows.filter(
    (r) => !["queued", "duplicate", "skipped"].includes(r.status),
  ).length;

  await prisma.batchRun.update({
    where: { id: runId },
    data: { attempted, created: created + recovered + partial, partial, failed, skipped },
  });
}

async function finalizeBatchRun(runId: string): Promise<BatchRunProgress> {
  const rows = await prisma.batchRunRow.findMany({ where: { runId } });
  const created = rows.filter((r) => r.status === "created").length;
  const recovered = rows.filter((r) => r.status === "recovered_existing_draft").length;
  const partial = rows.filter((r) => r.status === "partial").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const succeeded = created + recovered;

  const finalStatus =
    partial > 0
      ? "partial"
      : failed > 0 && succeeded > 0
        ? "partial"
        : failed > 0
          ? "failed"
          : "completed";

  await prisma.batchRun.update({
    where: { id: runId },
    data: { status: finalStatus, completedAt: new Date() },
  });

  // Finalize any stores still showing as running
  const runningStores = await prisma.batchRunStore.findMany({
    where: { runId, status: "running" },
  });
  for (const s of runningStores) {
    await _updateStoreCounts(s.id);
  }

  console.log(
    `[batchRunService] finalized run=${runId} status=${finalStatus} ` +
      `created=${created} recovered_existing_draft=${recovered} partial=${partial} failed=${failed}`,
  );
  return getBatchRunProgress(runId);
}
