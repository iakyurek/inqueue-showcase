import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import { buildRowPreview, isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";
import { listSupplementalImagesForPreset, validateSupplementalImagePreset, listSizeChartImages } from "@/lib/services/supplementalImageHelpers";
import { parseVariationOptions } from "@/lib/services/inventoryHelpers";
import { resolveVariationProfile } from "@/lib/services/variationProfiles";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");
const MAX_LISTINGS_PER_STORE = 30;

export interface StoreValidationResult {
  storeFolder: string;
  storeName: string;
  storeId: string | null;
  etsyConnected: boolean;
  etsyShopName: string | null;
  etsySetupReady: boolean;
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  manifestRowCount: number;
  validListingsCount: number;
  ineligibleCount: number;
  missingImageCount: number;
  missingTitleCount: number;
  missingSkuCount: number;
  missingTagsCount: number;
  invalidPriceCount: number;
  alreadyCreatedCount: number;
  eligibleNotCreatedCount: number;
  estimatedListings: number;
  warnings: string[];
  errors: string[];
}

export interface BatchValidationResult {
  batchFolder: string;
  overallStatus: "ready" | "warnings" | "failed";
  manifestStatus: "ok" | "warnings" | "errors";
  manifestRowCount: number;
  manifestErrors: string[];
  manifestWarnings: string[];
  storesInManifest: string[];
  globalPreset: { exists: boolean; hasTemplate: boolean; descriptionTemplateLength: number };
  variationPreset: { enabled: boolean; ready: boolean; combinationCount: number; issues: string[] };
  supplementalPreset: { enabled: boolean; filesAvailable: number; sizeChartCount: number; sizeChartRequired: number; issues: string[] };
  variationProfiles: {
    profilesUsed: string[];
    allUsable: boolean;
    issues: string[];
    applied: { key: string; offered: number; total: number }[];
  };
  storeResults: StoreValidationResult[];
  validatedAt: string;
}

export async function POST(req: NextRequest) {
  let batchFolder: string | undefined;

  try {
    const body = await req.json() as { batchFolder?: unknown };
    batchFolder = typeof body.batchFolder === "string" ? body.batchFolder.trim() : undefined;
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  if (!batchFolder) {
    return NextResponse.json({ error: "MISSING_BATCH_FOLDER" }, { status: 400 });
  }

  // Security: reject path traversal
  if (batchFolder.includes("..") || batchFolder.includes("/") || batchFolder.includes("\\")) {
    return NextResponse.json({ error: "INVALID_BATCH_FOLDER" }, { status: 400 });
  }

  const batchPath = path.join(DOWNLOADS_DIR, batchFolder);
  const csvPath = path.join(batchPath, "batch_manifest.csv");

  // ---------------------------------------------------------------------------
  // 1. Parse manifest
  // ---------------------------------------------------------------------------
  const manifest = parseManifest(csvPath);
  const manifestErrors = manifest.errors.map((e) => e.message);
  const manifestWarnings = manifest.warnings.map((e) => e.message);
  const manifestStatus =
    manifestErrors.length > 0 ? "errors" : manifestWarnings.length > 0 ? "warnings" : "ok";

  // ---------------------------------------------------------------------------
  // 2. Load all DB data in parallel
  // ---------------------------------------------------------------------------
  const [stores, storeEtsyIdsList, preset, variationPreset, supplementalPreset] = await Promise.all([
    prisma.store.findMany({
      select: { id: true, name: true, driveFolderName: true, etsyShopId: true, refreshToken: true, etsyShopName: true },
    }),
    prisma.storeEtsyIds.findMany(),
    prisma.globalListingPreset.findFirst(),
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
  ]);

  const storeByFolder = new Map(stores.map((s) => [s.driveFolderName, s]));
  const storeEtsyIdsMap = new Map(storeEtsyIdsList.map((e) => [e.storeId, e]));

  // ---------------------------------------------------------------------------
  // 3. Global preset summary
  // ---------------------------------------------------------------------------
  const globalPreset = {
    exists: !!preset,
    hasTemplate: !!(preset?.descriptionTemplate?.trim()),
    descriptionTemplateLength: preset?.descriptionTemplate?.trim().length ?? 0,
  };

  // ---------------------------------------------------------------------------
  // 4. Variation preset summary
  // ---------------------------------------------------------------------------
  const variationIssues: string[] = [];
  let variationCombinationCount = 0;
  let variationReady = false;

  if (variationPreset?.enabled) {
    if (!variationPreset.variation1PropertyId) variationIssues.push(`${variationPreset.variation1Name} property ID not set`);
    if (!variationPreset.variation2PropertyId) variationIssues.push(`${variationPreset.variation2Name} property ID not set`);
    const v1Opts = parseVariationOptions(variationPreset.variation1Options);
    const v2Opts = parseVariationOptions(variationPreset.variation2Options);
    variationCombinationCount = v1Opts.length * v2Opts.length;
    if (variationCombinationCount > 100) variationIssues.push(`Too many combinations (${variationCombinationCount}). Max 100.`);
    if (v1Opts.length === 0) variationIssues.push(`${variationPreset.variation1Name} options are empty`);
    if (v2Opts.length === 0) variationIssues.push(`${variationPreset.variation2Name} options are empty`);
    if (variationPreset.quantityPerVariation < 1) variationIssues.push("quantityPerVariation must be ≥ 1");
    variationReady = variationIssues.length === 0;
  }

  // ---------------------------------------------------------------------------
  // 5. Supplemental preset summary
  // ---------------------------------------------------------------------------
  const supplementalIssues: string[] = [];
  let supplementalFilesAvailable = 0;

  let sizeChartCount = 0;
  if (supplementalPreset?.enabled) {
    const { warnings, errors } = validateSupplementalImagePreset(supplementalPreset);
    supplementalIssues.push(...errors, ...warnings);
    if (errors.length === 0) {
      supplementalFilesAvailable = listSupplementalImagesForPreset(supplementalPreset).length;
      if (supplementalFilesAvailable === 0) supplementalIssues.push("No supplemental image files found in configured folders");
      if (supplementalPreset.includeSizeCharts) {
        const sizeCharts = listSizeChartImages(supplementalPreset);
        sizeChartCount = sizeCharts.length;
        const required = (supplementalPreset as { sizeChartRequiredCount?: number }).sizeChartRequiredCount ?? 3;
        if (sizeChartCount < required) {
          const filenames = sizeCharts.map((f) => f.basename).join(", ");
          supplementalIssues.push(
            `SIZE CHARTS REQUIRED: ${required} size chart images required — found ${sizeChartCount}. ` +
            `Add ${required - sizeChartCount} more to workspace/supplemental-images/size-charts/.` +
            (filenames ? ` Found: ${filenames}` : " Found: none.")
          );
        }
      }
    }
  } else if (!supplementalPreset) {
    supplementalIssues.push("Supplemental image preset not configured — run npm run db:seed");
  }

  // ---------------------------------------------------------------------------
  // 5b. Variation-profile resolution (per distinct key used in the manifest)
  // Each design carries a variation-profile key. front_sided is always usable;
  // an unknown key or an incomplete/pending profile (e.g. double_sided before
  // its matrix is configured) is a fatal error surfaced BEFORE any run, on the
  // same resolver the run itself gates on — no preview/submit drift.
  // ---------------------------------------------------------------------------
  const profileKeysUsed = Array.from(new Set(manifest.rows.map((r) => r.variation_profile)));
  const profileResolutions = new Map(
    await Promise.all(
      profileKeysUsed.map(async (key) => [key, await resolveVariationProfile(key)] as const),
    ),
  );
  const variationProfileIssues = profileKeysUsed
    .map((k) => profileResolutions.get(k)!)
    .filter((r) => !r.usable)
    .map((r) => r.reason || `Variation profile "${r.key}" is not usable`);
  // What the run will actually apply (same resolver → no preview/submit drift):
  // for a usable profile with a synced matrix, the full grid it will send.
  const appliedProfiles = profileKeysUsed
    .map((k) => profileResolutions.get(k)!)
    .filter((r) => r.usable && r.profile && Array.isArray(r.profile.offerings) && r.profile.offerings.length > 0)
    .map((r) => ({
      key: r.key,
      offered: r.profile!.offerings.length,
      total: r.profile!.offerings.length + (r.profile!.disabledCombinations?.length ?? 0),
    }));

  // ---------------------------------------------------------------------------
  // 6. Per-store validation
  // ---------------------------------------------------------------------------
  const storesInManifest = Array.from(new Set(manifest.rows.map((r) => r.store_folder))).sort();
  const storeResults: StoreValidationResult[] = [];

  for (const storeFolder of storesInManifest) {
    const dbStore = storeByFolder.get(storeFolder);
    const storeId = dbStore?.id ?? null;
    const storeEtsyIds = storeId ? (storeEtsyIdsMap.get(storeId) ?? null) : null;
    const etsyConnected = !!(dbStore?.etsyShopId && dbStore?.refreshToken);
    const etsySetupReady = !!(storeEtsyIds?.taxonomyId && storeEtsyIds?.shippingProfileId && storeEtsyIds?.readinessStateId);

    const storeRows = manifest.rows.filter((r) => r.store_folder === storeFolder);
    const storeErrors: string[] = [];
    const storeWarnings: string[] = [];

    if (!dbStore) {
      storeErrors.push(`Store ${storeFolder} not found in database`);
    }
    if (!etsyConnected) {
      storeErrors.push(`Store ${storeFolder} is not connected to Etsy`);
    }
    if (!etsySetupReady && etsyConnected) {
      if (!storeEtsyIds?.taxonomyId) storeErrors.push("taxonomyId not saved");
      if (!storeEtsyIds?.shippingProfileId) storeErrors.push("shippingProfileId not saved");
      if (!storeEtsyIds?.readinessStateId) storeErrors.push("readinessStateId not saved");
    }
    if (!(await isStoreFolderEnabled(storeFolder))) {
      storeErrors.push(`${storeFolder} is not in the enabled stores list`);
    }

    // Build row previews using the same logic as mini-batch-preview
    const previews = storeRows.map((row) =>
      buildRowPreview(row, batchFolder!, preset, storeEtsyIds ?? null),
    );

    // Duplicate check from DB
    let alreadyCreatedCount = 0;
    if (storeId) {
      const existing = await prisma.draftCreationRecord.findMany({
        where: { storeId, batchFolder },
        select: { designId: true, listingId: true },
      });
      alreadyCreatedCount = existing.filter((r) => !!r.listingId).length;
    }

    const validListingsCount = previews.filter((p) => p.eligible).length;
    const ineligibleCount = previews.filter((p) => !p.eligible).length;
    const eligibleNotCreatedCount = Math.max(0, validListingsCount - alreadyCreatedCount);
    const estimatedListings = Math.min(eligibleNotCreatedCount, MAX_LISTINGS_PER_STORE);

    // Count specific issues from previews (even for ineligible rows)
    let missingImageCount = 0;
    let missingTitleCount = 0;
    let missingSkuCount = 0;
    let missingTagsCount = 0;
    let invalidPriceCount = 0;

    for (const p of previews) {
      if (p.errors.some((e) => e.includes("image"))) missingImageCount++;
      if (p.errors.some((e) => e.includes("title"))) missingTitleCount++;
      if (p.errors.some((e) => e.includes("sku"))) missingSkuCount++;
      if (p.errors.some((e) => e.includes("tag"))) missingTagsCount++;
      if (p.errors.some((e) => e.includes("price"))) invalidPriceCount++;
      // Non-blocking warnings
      for (const w of p.warnings) {
        if (!storeWarnings.includes(w)) storeWarnings.push(w);
      }
    }

    // Warn when eligible rows exceed the per-store cap
    if (eligibleNotCreatedCount > MAX_LISTINGS_PER_STORE) {
      storeWarnings.push(
        `${eligibleNotCreatedCount} eligible rows — only ${MAX_LISTINGS_PER_STORE} will be created (hard cap). ` +
        `Remaining ${eligibleNotCreatedCount - MAX_LISTINGS_PER_STORE} can be created in a subsequent run.`,
      );
    }

    // Warn when store folder exists in manifest but has no image folders
    if (storeRows.length > 0 && missingImageCount === storeRows.length) {
      storeWarnings.push(`No image folders found for any row in ${storeFolder} — verify that design subfolders are present.`);
    }

    // Warn when no rows are in the manifest for a store but the folder was detected
    if (storeRows.length === 0) {
      storeWarnings.push(`Store folder ${storeFolder} was detected but has no rows in the manifest.`);
    }

    if (!preset) storeErrors.push("GlobalListingPreset not found — run npm run db:seed");
    if (!preset?.descriptionTemplate?.trim()) storeWarnings.push("No description template set — description will be title only");
    if (!preset?.materials?.trim()) storeWarnings.push("No materials set — listings will be created without material tags");
    if (!preset?.itemWeight || !preset?.itemWeightUnit) storeWarnings.push("Item weight not set — listings will be created without weight");
    if (!preset?.itemLength || !preset?.itemDimensionsUnit) storeWarnings.push("Item packed dimensions not set — listings will be created without dimension data");
    if (variationPreset?.enabled && !variationReady) {
      storeWarnings.push("Variation preset is enabled but has errors — inventory update will fail");
    }
    // Fatal: any row in this store uses an unusable variation profile.
    const unusableInStore = Array.from(
      new Set(storeRows.map((r) => r.variation_profile)),
    )
      .map((k) => profileResolutions.get(k)!)
      .filter((r) => r && !r.usable);
    for (const r of unusableInStore) {
      storeErrors.push(r.reason || `Variation profile "${r.key}" is not usable`);
    }

    storeResults.push({
      storeFolder,
      storeName: dbStore?.name ?? storeFolder,
      storeId,
      etsyConnected,
      etsyShopName: dbStore?.etsyShopName ?? null,
      etsySetupReady,
      taxonomyId: storeEtsyIds?.taxonomyId ?? null,
      shippingProfileId: storeEtsyIds?.shippingProfileId ?? null,
      readinessStateId: storeEtsyIds?.readinessStateId ?? null,
      manifestRowCount: storeRows.length,
      validListingsCount,
      ineligibleCount,
      missingImageCount,
      missingTitleCount,
      missingSkuCount,
      missingTagsCount,
      invalidPriceCount,
      alreadyCreatedCount,
      eligibleNotCreatedCount,
      estimatedListings,
      warnings: storeWarnings,
      errors: storeErrors,
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Compute overall status
  // ---------------------------------------------------------------------------
  const anyFatal =
    manifestStatus === "errors" ||
    storeResults.some((s) => s.errors.length > 0) ||
    !preset;

  const anyWarning =
    manifestStatus === "warnings" ||
    storeResults.some((s) => s.warnings.length > 0) ||
    supplementalIssues.length > 0;

  const overallStatus: "ready" | "warnings" | "failed" = anyFatal
    ? "failed"
    : anyWarning
      ? "warnings"
      : "ready";

  console.log(
    `[batches/validate] batchFolder=${batchFolder} status=${overallStatus} ` +
    `storesInManifest=${storesInManifest.length} totalRows=${manifest.rows.length}`,
  );

  const result: BatchValidationResult = {
    batchFolder,
    overallStatus,
    manifestStatus,
    manifestRowCount: manifest.rows.length,
    manifestErrors,
    manifestWarnings,
    storesInManifest,
    globalPreset,
    variationPreset: {
      enabled: variationPreset?.enabled ?? false,
      ready: variationPreset?.enabled ? variationReady : true,
      combinationCount: variationCombinationCount,
      issues: variationIssues,
    },
    supplementalPreset: {
      enabled: supplementalPreset?.enabled ?? false,
      filesAvailable: supplementalFilesAvailable,
      sizeChartCount,
      sizeChartRequired: (supplementalPreset as { sizeChartRequiredCount?: number } | null)?.sizeChartRequiredCount ?? 3,
      issues: supplementalIssues,
    },
    variationProfiles: {
      profilesUsed: profileKeysUsed,
      allUsable: variationProfileIssues.length === 0,
      issues: variationProfileIssues,
      applied: appliedProfiles,
    },
    storeResults,
    validatedAt: new Date().toISOString(),
  };

  return NextResponse.json(result);
}
