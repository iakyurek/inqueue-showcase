import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import { parseVariationOptions } from "@/lib/services/inventoryHelpers";
import {
  listSupplementalImagesForPreset,
  validateSupplementalImagePreset,
} from "@/lib/services/supplementalImageHelpers";
import {
  isStoreFolderEnabled,
  findLatestManifestFolder,
  buildRowPreview,
} from "@/lib/services/draftFlowHelpers";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId") ?? undefined;

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

  // Server-side enablement check
  if (!(await isStoreFolderEnabled(store.driveFolderName))) {
    return NextResponse.json(
      { error: `Mini-batch preview is not enabled for ${store.driveFolderName}.` },
      { status: 403 },
    );
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // Read-only DB loads — no writes
  const [preset, storeEtsyIds, variationPreset, supplementalPreset] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
  ]);

  const setupStatus = {
    hasTaxonomyId: !!storeEtsyIds?.taxonomyId,
    hasShippingProfileId: !!storeEtsyIds?.shippingProfileId,
    hasReadinessStateId: !!storeEtsyIds?.readinessStateId,
    isReadyForCreation: !!(
      storeEtsyIds?.taxonomyId &&
      storeEtsyIds?.shippingProfileId &&
      storeEtsyIds?.readinessStateId
    ),
  };

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

  // Filter only rows for this store's folder — derived from DB, not client input
  const storeFolder = store.driveFolderName;
  const storeRows = manifest.rows.filter((r) => r.store_folder === storeFolder);

  // Load creation history for this store + batch in one query
  const existingRecords = await prisma.draftCreationRecord.findMany({
    where: { storeId, batchFolder: folderName },
    select: { designId: true, listingId: true, status: true, createdAt: true },
  });
  const existingMap = new Map(existingRecords.map((r) => [r.designId, r]));

  const rows = storeRows.map((row) => {
    const preview = buildRowPreview(row, folderName, preset, storeEtsyIds ?? null);
    const existing = existingMap.get(row.design_id);
    return {
      ...preview,
      alreadyCreated: !!existing,
      existingListingId: existing?.listingId ?? null,
      existingStatus: existing?.status ?? null,
      existingCreatedAt: existing?.createdAt?.toISOString() ?? null,
    };
  });

  const eligibleCount = rows.filter((r) => r.eligible && !r.alreadyCreated).length;
  const warningCount = rows.filter((r) => r.warnings.length > 0).length;
  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  const alreadyCreatedCount = rows.filter((r) => r.alreadyCreated).length;

  // Variation preset summary for UI
  const variationErrors: string[] = [];
  let variationCombinationsCount = 0;
  let variationOptionsSummary = "";

  if (variationPreset?.enabled) {
    if (!variationPreset.variation1PropertyId) {
      variationErrors.push(`${variationPreset.variation1Name} property ID not set.`);
    }
    if (!variationPreset.variation2PropertyId) {
      variationErrors.push(`${variationPreset.variation2Name} property ID not set.`);
    }
    const v1Opts = parseVariationOptions(variationPreset.variation1Options);
    const v2Opts = parseVariationOptions(variationPreset.variation2Options);
    variationCombinationsCount = v1Opts.length * v2Opts.length;
    if (variationCombinationsCount > 100) {
      variationErrors.push(`Too many combinations (${variationCombinationsCount}). Max 100.`);
    }
    variationOptionsSummary = `${v1Opts.length} ${variationPreset.variation1Name} × ${v2Opts.length} ${variationPreset.variation2Name}`;
  }

  // Supplemental image readiness
  let supplementalImagesEnabled = false;
  let supplementalImagesAvailableCount = 0;
  const supplementalImageFiles: { basename: string; category: string }[] = [];
  const supplementalImageWarnings: string[] = [];
  const supplementalImageErrors: string[] = [];

  if (supplementalPreset) {
    supplementalImagesEnabled = supplementalPreset.enabled;
    if (supplementalPreset.enabled) {
      const { warnings, errors } = validateSupplementalImagePreset(supplementalPreset);
      supplementalImageWarnings.push(...warnings);
      supplementalImageErrors.push(...errors);

      const files = listSupplementalImagesForPreset(supplementalPreset);
      supplementalImagesAvailableCount = files.length;
      supplementalImageFiles.push(...files.map((f) => ({ basename: f.basename, category: f.category })));
    }
  }

  console.log(
    `[etsy/store-mini-batch-preview] storeId=${storeId} storeFolder=${storeFolder} ` +
    `folder=${folderName} rows=${rows.length} eligible=${eligibleCount} alreadyCreated=${alreadyCreatedCount}`,
  );

  return NextResponse.json({
    storeFolder,
    batchFolder: folderName,
    totalRows: rows.length,
    eligibleCount,
    warningCount,
    errorCount,
    alreadyCreatedCount,
    setupStatus,
    variationPresetEnabled: variationPreset?.enabled ?? false,
    variationOptionsSummary,
    variationCombinationsCount,
    variationErrors,
    supplementalImagesEnabled,
    supplementalImagesAvailableCount,
    supplementalImageFiles,
    supplementalImageWarnings,
    supplementalImageErrors,
    rows,
  });
}
