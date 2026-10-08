import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import {
  TEST_STORE_FOLDER,
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

  if (store.driveFolderName !== TEST_STORE_FOLDER) {
    return NextResponse.json({ error: "STORE_A_ONLY" }, { status: 403 });
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // Read-only DB loads — no writes
  const [preset, storeEtsyIds] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
  ]);

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

  const storeARows = manifest.rows.filter(
    (r) => r.store_folder === TEST_STORE_FOLDER,
  );

  // Load existing creation records for this store + batch in one query
  const existingRecords = await prisma.draftCreationRecord.findMany({
    where: { storeId, batchFolder: folderName },
    select: { designId: true, listingId: true, status: true, createdAt: true },
  });
  const existingMap = new Map(existingRecords.map((r) => [r.designId, r]));

  const rows = storeARows.map((row) => {
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

  console.log(
    `[etsy/store-a-mini-batch-preview] storeId=${storeId} folder=${folderName} ` +
    `storeARows=${rows.length} eligible=${eligibleCount} alreadyCreated=${alreadyCreatedCount}`,
  );

  return NextResponse.json({
    batchFolder: folderName,
    totalRows: rows.length,
    eligibleCount,
    warningCount,
    errorCount,
    alreadyCreatedCount,
    rows,
  });
}
