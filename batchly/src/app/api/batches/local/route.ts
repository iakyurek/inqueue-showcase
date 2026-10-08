import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import {
  DOWNLOADS_DIR,
  readBatchWorkflowMetadata,
  type WorkflowStage,
} from "@/lib/services/batchWorkflowMetadata";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

const STORE_FOLDER_PATTERN = /^Store_[A-H]$/;
const VALID_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

export interface LocalBatch {
  folderName: string;
  sourceDriveFolderId: string | null;
  sourceDriveFolderName: string | null;
  importedAt: string | null;
  confirmedCompletedAt: string | null;
  hasManifest: boolean;
  manifestRowCount: number | null;
  storeFoldersFound: string[];
  detectedAt: string;
  lastUpdatedAt: string;
  queueSection: "inqueue" | "completed";
  batchStatus: "detected" | "scanned" | "validated" | "ready" | "ready_to_upload" | "retryable" | "failed" | "completed";
  validationStatus: "not_validated" | "ok" | "warnings" | "errors" | "completed";
  listingCount: number;
  completedListingCount: number;
  totalImageCount: number;
  rowsWithImages: number;
  missingImageCount: number;
  imageSummary: string;
  skuRangeSummary: string;
  currentStage: WorkflowStage;
  canConfirmComplete: boolean;
  uploadReady: boolean;
  readyStoreFolders: string[];
  uploadDisabledReason: string | null;
  warnings: string[];
  errors: string[];
  completedAt: string | null;
  etsyDraftResult: string | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
}

function sortSkus(a: string, b: string): number {
  const re = /^([A-Za-z]+)(\d+)$/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function summarizeSkus(skus: string[]): string {
  const unique = Array.from(new Set(skus.filter(Boolean))).sort(sortSkus);
  if (unique.length === 0) return "No SKUs";
  if (unique.length === 1) return unique[0];
  return `${unique[0]} to ${unique[unique.length - 1]}`;
}

function listDesignImageCount(batchPath: string, storeFolder: string, designId: string): number {
  const designPath = path.join(batchPath, storeFolder, designId);
  try {
    if (!fs.existsSync(designPath)) return 0;
    return fs
      .readdirSync(designPath)
      .filter((name) => VALID_IMAGE_EXTS.has(path.extname(name).toLowerCase()))
      .length;
  } catch {
    return 0;
  }
}

export async function GET() {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    return NextResponse.json({ batches: [] });
  }

  const entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
  const batchDirs = entries
    // Dot-dirs are infrastructure (.auto-validation markers, .tmp-download-*
    // staging), never batches.
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .reverse(); // newest first

  const [stores, storeEtsyIdsList, runs, draftRecords] = await Promise.all([
    prisma.store.findMany({
      select: { id: true, driveFolderName: true, etsyShopName: true, etsyShopId: true, refreshToken: true },
    }),
    prisma.storeEtsyIds.findMany({
      select: { storeId: true, taxonomyId: true, shippingProfileId: true, readinessStateId: true },
    }),
    prisma.batchRun.findMany({
      where: { batchFolder: { in: batchDirs } },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        batchFolder: true,
        status: true,
        created: true,
        partial: true,
        failed: true,
        totalRows: true,
        startedAt: true,
        completedAt: true,
      },
    }),
    prisma.draftCreationRecord.findMany({
      where: { batchFolder: { in: batchDirs } },
      select: {
        batchFolder: true,
        storeFolder: true,
        designId: true,
        listingId: true,
        status: true,
        updatedAt: true,
      },
    }),
  ]);

  const storeByFolder = new Map(stores.map((store) => [store.driveFolderName, store]));
  const idsByStoreId = new Map(storeEtsyIdsList.map((ids) => [ids.storeId, ids]));
  const latestRunByBatch = new Map<string, typeof runs[number]>();
  for (const run of runs) {
    if (!latestRunByBatch.has(run.batchFolder)) latestRunByBatch.set(run.batchFolder, run);
  }
  const recordsByBatch = new Map<string, typeof draftRecords>();
  for (const record of draftRecords) {
    const list = recordsByBatch.get(record.batchFolder) ?? [];
    list.push(record);
    recordsByBatch.set(record.batchFolder, list);
  }

  const batches: LocalBatch[] = [];

  for (const folderName of batchDirs) {
    const folderPath = path.join(DOWNLOADS_DIR, folderName);
    const metadata = readBatchWorkflowMetadata(folderName);
    const csvPath = path.join(folderPath, "batch_manifest.csv");
    const hasManifest = fs.existsSync(csvPath);

    let manifestRowCount: number | null = null;
    let manifestErrors: string[] = [];
    let manifestWarnings: string[] = [];
    let rows: ReturnType<typeof parseManifest>["rows"] = [];
    if (hasManifest) {
      try {
        const parsed = parseManifest(csvPath);
        manifestRowCount = parsed.rows.length;
        rows = parsed.rows;
        manifestErrors = parsed.errors.map((e) => e.message);
        manifestWarnings = parsed.warnings.map((e) => e.message);
      } catch {
        manifestRowCount = null;
        manifestErrors = ["Could not read batch_manifest.csv"];
      }
    }

    // Find store folders under this batch
    const storeFoldersFound: string[] = [];
    try {
      const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isDirectory() && STORE_FOLDER_PATTERN.test(sub.name)) {
          storeFoldersFound.push(sub.name);
        }
      }
    } catch {
      // non-fatal
    }
    const manifestStoreFolders = rows.map((row) => row.store_folder).filter(Boolean);
    for (const storeFolder of manifestStoreFolders) {
      if (STORE_FOLDER_PATTERN.test(storeFolder) && !storeFoldersFound.includes(storeFolder)) {
        storeFoldersFound.push(storeFolder);
      }
    }
    storeFoldersFound.sort();

    // Use folder mtime as detected time
    let detectedAt = new Date().toISOString();
    try {
      const stat = fs.statSync(folderPath);
      detectedAt = stat.mtime.toISOString();
    } catch {
      // keep default
    }

    const records = recordsByBatch.get(folderName) ?? [];
    const latestRun = latestRunByBatch.get(folderName) ?? null;
    const createdRecords = records.filter((record) => !!record.listingId);
    const createdKeys = new Set(createdRecords.map((record) => `${record.storeFolder}/${record.designId}`));

    let totalImageCount = 0;
    let rowsWithImages = 0;
    let missingImageCount = 0;
    const readyStoreFolders = new Set<string>();
    const storeErrors: string[] = [];

    for (const row of rows) {
      const imageCount = listDesignImageCount(folderPath, row.store_folder, row.design_id);
      totalImageCount += imageCount;
      if (imageCount > 0) rowsWithImages++;
      else missingImageCount++;

      if (createdKeys.has(`${row.store_folder}/${row.design_id}`)) continue;

      const store = storeByFolder.get(row.store_folder);
      if (!store) {
        storeErrors.push(`${row.store_folder} is not configured in Batchly`);
        continue;
      }
      const ids = idsByStoreId.get(store.id);
      if (!store.etsyShopId || !store.refreshToken) {
        storeErrors.push(`${row.store_folder} is not connected to Etsy`);
        continue;
      }
      if (!ids?.taxonomyId || !ids.shippingProfileId || !ids.readinessStateId) {
        storeErrors.push(`${row.store_folder} is missing Etsy IDs`);
        continue;
      }
      if (imageCount === 0) continue;
      readyStoreFolders.add(row.store_folder);
    }

    const listingCount = rows.length;
    const completedListingCount = rows.filter((row) => createdKeys.has(`${row.store_folder}/${row.design_id}`)).length;
    const allRowsCreated = listingCount > 0 && completedListingCount >= listingCount;
    const runSucceeded =
      !!latestRun &&
      latestRun.status === "completed" &&
      latestRun.failed === 0 &&
      latestRun.partial === 0;
    const runHasUnresolvedFailures =
      !!latestRun &&
      (latestRun.status === "failed" || latestRun.failed > 0 || latestRun.partial > 0);
    const confirmedCompleted = !!metadata?.confirmedCompletedAt || metadata?.stage === "completed";
    const isWorkflowManaged = !!metadata?.importedAt || !!metadata?.selectedAt || !!metadata?.sourceDriveFolderId;
    const canConfirmComplete =
      isWorkflowManaged &&
      !confirmedCompleted &&
      (runSucceeded || allRowsCreated) &&
      !runHasUnresolvedFailures;
    const errors = [...manifestErrors, ...Array.from(new Set(storeErrors))];
    const warnings = [...manifestWarnings];
    if (missingImageCount > 0) warnings.push(`${missingImageCount} manifest row${missingImageCount !== 1 ? "s" : ""} missing image files`);
    if (latestRun?.status === "partial") warnings.push("Latest upload run completed with partial rows");
    if (latestRun?.status === "failed") warnings.push("Latest upload run failed and may be retryable after fixes");

    let uploadDisabledReason: string | null = null;
    if (!hasManifest) uploadDisabledReason = "Missing batch_manifest.csv";
    else if (errors.length > 0) uploadDisabledReason = errors[0];
    else if (listingCount === 0) uploadDisabledReason = "Manifest has no rows";
    else if (allRowsCreated) uploadDisabledReason = "All manifest rows already have draft records";
    else if (readyStoreFolders.size === 0) uploadDisabledReason = missingImageCount > 0 ? "Missing image files" : "No connected ready stores";

    const uploadReady = !uploadDisabledReason;
    const queueSection: LocalBatch["queueSection"] =
      confirmedCompleted || (!isWorkflowManaged && allRowsCreated) ? "completed" : "inqueue";
    const currentStage: WorkflowStage =
      queueSection === "completed" ? "completed"
      : runHasUnresolvedFailures ? "failed_needs_attention"
      : canConfirmComplete ? "run_complete_awaiting_confirmation"
      : latestRun?.status === "running" || latestRun?.status === "queued" ? "running"
      : uploadReady ? "ready_to_run"
      : hasManifest ? "validating"
      : metadata?.stage ?? "added_to_inqueue";
    const batchStatus: LocalBatch["batchStatus"] =
      queueSection === "completed" ? "completed"
      : canConfirmComplete ? "ready"
      : uploadReady && latestRun?.status === "failed" ? "retryable"
      : uploadReady ? "ready_to_upload"
      : errors.length > 0 ? "failed"
      : hasManifest ? "validated"
      : "detected";
    const validationStatus: LocalBatch["validationStatus"] =
      queueSection === "completed" ? "completed"
      : canConfirmComplete ? "ok"
      : errors.length > 0 ? "errors"
      : warnings.length > 0 ? "warnings"
      : hasManifest ? "ok"
      : "not_validated";

    const recordUpdatedAt = records
      .map((record) => record.updatedAt.getTime())
      .sort((a, b) => b - a)[0];
    const latestRunTime = latestRun?.completedAt?.getTime() ?? latestRun?.startedAt.getTime();
    const lastUpdatedAt = new Date(Math.max(
      new Date(detectedAt).getTime(),
      recordUpdatedAt ?? 0,
      latestRunTime ?? 0,
    )).toISOString();

    batches.push({
      folderName,
      sourceDriveFolderId: metadata?.sourceDriveFolderId ?? null,
      sourceDriveFolderName: metadata?.sourceDriveFolderName ?? metadata?.sourceDriveFolderId ?? null,
      importedAt: metadata?.importedAt ?? metadata?.selectedAt ?? null,
      confirmedCompletedAt: metadata?.confirmedCompletedAt ?? null,
      hasManifest,
      manifestRowCount,
      storeFoldersFound,
      detectedAt,
      lastUpdatedAt,
      queueSection,
      batchStatus,
      validationStatus,
      listingCount,
      completedListingCount,
      totalImageCount,
      rowsWithImages,
      missingImageCount,
      imageSummary: listingCount > 0
        ? `${totalImageCount} images across ${rowsWithImages}/${listingCount} rows`
        : "No manifest rows",
      skuRangeSummary: summarizeSkus(rows.map((row) => row.sku)),
      currentStage,
      canConfirmComplete,
      uploadReady,
      readyStoreFolders: Array.from(readyStoreFolders).sort(),
      uploadDisabledReason,
      warnings,
      errors,
      completedAt: queueSection === "completed"
        ? (metadata?.confirmedCompletedAt ?? latestRun?.completedAt?.toISOString() ?? lastUpdatedAt)
        : null,
      etsyDraftResult: allRowsCreated
        ? `${completedListingCount}/${listingCount} Etsy draft${listingCount !== 1 ? "s" : ""} created`
        : null,
      latestRunId: latestRun?.id ?? null,
      latestRunStatus: latestRun?.status ?? null,
    });
  }

  return NextResponse.json({ batches });
}
