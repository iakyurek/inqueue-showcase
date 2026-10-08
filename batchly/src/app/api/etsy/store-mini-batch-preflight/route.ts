import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import {
  isStoreFolderEnabled,
  findLatestManifestFolder,
  buildRowPreview,
} from "@/lib/services/draftFlowHelpers";
import { buildPreflight } from "@/lib/services/preflightHelpers";
import { loadPresetSizeCharts } from "@/lib/services/presetSizeCharts";

const MAX_SELECTED = 3;
const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

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

  if (designIds.length > MAX_SELECTED) {
    return NextResponse.json(
      { error: `Maximum ${MAX_SELECTED} design IDs allowed for preflight.` },
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

  const storeFolder = store.driveFolderName;
  if (!(await isStoreFolderEnabled(storeFolder))) {
    return NextResponse.json(
      { error: `Mini-batch is not enabled for ${storeFolder}.` },
      { status: 403 },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Load all needed DB data (read-only)
  // ---------------------------------------------------------------------------
  const [preset, storeEtsyIds, variationPreset, supplementalPreset] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
  ]);

  // ---------------------------------------------------------------------------
  // 4. Load manifest rows for this store
  // ---------------------------------------------------------------------------
  const folderName = findLatestManifestFolder();
  if (!folderName) {
    return NextResponse.json(
      { error: "No downloaded batch found in workspace/downloads/. Download a batch from Google Drive first." },
      { status: 404 },
    );
  }

  const csvPath = path.join(DOWNLOADS_DIR, folderName, "batch_manifest.csv");
  const manifest = parseManifest(csvPath);
  const storeRows = manifest.rows.filter((r) => r.store_folder === storeFolder);

  // Load creation history
  const existingRecords = await prisma.draftCreationRecord.findMany({
    where: { storeId, batchFolder: folderName },
    select: { designId: true, listingId: true, status: true },
  });
  const existingMap = new Map(existingRecords.map((r) => [r.designId, r]));

  // Build row previews — same logic as store-mini-batch-preview
  const rows = storeRows.map((row) => {
    const preview = buildRowPreview(row, folderName, preset, storeEtsyIds ?? null);
    const existing = existingMap.get(row.design_id);
    return {
      ...preview,
      alreadyCreated: !!existing,
      existingListingId: existing?.listingId ?? null,
    };
  });

  // ---------------------------------------------------------------------------
  // 5. Run preflight (no Etsy API calls, no writes)
  // ---------------------------------------------------------------------------
  const presetSizeCharts = loadPresetSizeCharts();

  const preflight = buildPreflight({
    store: { etsyShopId: store.etsyShopId, refreshToken: store.refreshToken },
    storeEtsyIds: storeEtsyIds ?? null,
    rows,
    selectedDesignIds: designIds,
    preset: preset ?? null,
    variationPreset: variationPreset ?? null,
    supplementalPreset: supplementalPreset ?? null,
    presetSizeCharts,
  });

  console.log(
    `[etsy/store-mini-batch-preflight] storeId=${storeId} storeFolder=${storeFolder} ` +
    `designIds=${designIds.join(",")} status=${preflight.status} canCreate=${preflight.canCreate}`,
  );

  return NextResponse.json({
    storeFolder,
    batchFolder: folderName,
    designIds,
    preflight,
  });
}
