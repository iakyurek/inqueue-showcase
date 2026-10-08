import fs from "fs";
import path from "path";
import { listBatchFolders, isConnected } from "@/lib/services/drive";
import { getPendingFolderId, setLastDriveScan } from "@/lib/services/appSettings";
import { prisma } from "@/lib/prisma";
import {
  DOWNLOADS_DIR,
  readBatchWorkflowMetadata,
} from "@/lib/services/batchWorkflowMetadata";
import { parseManifest } from "@/lib/services/manifest";

// Scan the Drive pending-batches folder and annotate each batch with local /
// draft-history state. Shared by the session-authed scan-drive route and the
// service-token /api/internal/batches/scan-pending endpoint (Preply's
// automatic post-export notification). Throws coded errors:
// NOT_CONNECTED | PENDING_FOLDER_NOT_CONFIGURED | anything else = Drive error.

export interface AutoValidationMarker {
  status: "validating" | "ready" | "warnings" | "failed";
  overallStatus?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ScannedBatch {
  id: string;
  name: string;
  modifiedTime: string | null;
  createdTime: string | null;
  localExists: boolean;
  alreadyImported: boolean;
  alreadyCompleted: boolean;
  duplicateMessage: string | null;
  storeFoldersDetected: string[];
  hasManifest: boolean | null;
  manifestRowCount: number | null;
  warnings: string[];
  autoValidation: AutoValidationMarker | null;
}

// Auto-import progress markers live in a SIDECAR directory, not inside the
// batch folder: the old in-folder marker mkdir'd the batch folder at
// "validating" time, which made a not-yet-downloaded batch look imported
// (localExists) and blocked its own retry. Legacy in-folder markers are still
// read as a fallback.
const MARKER_DIR = path.join(DOWNLOADS_DIR, ".auto-validation");
const LEGACY_MARKER = ".inqueue-auto-validation.json";

export function readAutoValidationMarker(batchFolderName: string): AutoValidationMarker | null {
  for (const markerPath of [
    path.join(MARKER_DIR, `${batchFolderName}.json`),
    path.join(DOWNLOADS_DIR, batchFolderName, LEGACY_MARKER),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(markerPath, "utf8")) as AutoValidationMarker;
    } catch {
      // try next location
    }
  }
  return null;
}

export function writeAutoValidationMarker(batchFolderName: string, marker: AutoValidationMarker): void {
  try {
    fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(path.join(MARKER_DIR, `${batchFolderName}.json`), JSON.stringify(marker, null, 2));
  } catch {
    // Best-effort: a missing marker only degrades status display.
  }
}

// A marker can say "validating" forever if the process died mid-import (the
// in-flight set is in-memory). Callers treat such markers as stale and retry.
export function isStaleValidatingMarker(marker: AutoValidationMarker | null, inFlight: boolean): boolean {
  if (!marker || marker.status !== "validating" || inFlight) return false;
  const startedAt = marker.startedAt ? Date.parse(marker.startedAt) : NaN;
  return Number.isNaN(startedAt) || Date.now() - startedAt > 3 * 60 * 1000;
}

function listStoreFolders(batchPath: string): string[] {
  try {
    return fs
      .readdirSync(batchPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Store_[A-H]$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function scanPendingBatches(): Promise<ScannedBatch[]> {
  if (!(await isConnected())) {
    throw new Error("NOT_CONNECTED");
  }
  const pendingFolder = await getPendingFolderId();
  if (!pendingFolder.value) {
    throw new Error("PENDING_FOLDER_NOT_CONFIGURED");
  }

  try {
    const folders = await listBatchFolders();
    await setLastDriveScan({
      at: new Date().toISOString(),
      folderCount: folders.length,
      error: null,
    }).catch(() => {});
    const folderNames = folders.map((folder) => folder.name);
    const draftRecordCounts = await prisma.draftCreationRecord.groupBy({
      by: ["batchFolder"],
      where: {
        batchFolder: { in: folderNames },
        listingId: { not: null },
      },
      _count: { _all: true },
    });
    const countByBatch = new Map(draftRecordCounts.map((row) => [row.batchFolder, row._count._all]));

    return folders.map((folder) => {
      const localPath = path.join(DOWNLOADS_DIR, folder.name);
      const localExists = fs.existsSync(localPath);
      const metadata = readBatchWorkflowMetadata(folder.name);
      const manifestPath = path.join(localPath, "batch_manifest.csv");
      const hasManifest = fs.existsSync(manifestPath);
      let manifestRowCount: number | null = null;
      let manifestWarnings: string[] = [];

      if (hasManifest) {
        const parsed = parseManifest(manifestPath);
        manifestRowCount = parsed.rows.length;
        manifestWarnings = [
          ...parsed.errors.map((error) => error.message),
          ...parsed.warnings.map((warning) => warning.message),
        ];
      }

      const completed =
        metadata?.stage === "completed" ||
        !!metadata?.confirmedCompletedAt ||
        ((countByBatch.get(folder.name) ?? 0) > 0 && !metadata);
      const inQueue = localExists && !completed;

      return {
        id: folder.id,
        name: folder.name,
        modifiedTime: folder.modifiedTime ?? null,
        createdTime: folder.createdTime ?? null,
        localExists,
        alreadyImported: inQueue,
        alreadyCompleted: completed,
        duplicateMessage: inQueue
          ? "This batch is already inQueue"
          : completed
            ? "This batch was already completed"
            : null,
        storeFoldersDetected: localExists ? listStoreFolders(localPath) : [],
        hasManifest: localExists ? hasManifest : null,
        manifestRowCount,
        warnings: manifestWarnings,
        autoValidation: readAutoValidationMarker(folder.name),
      };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "DRIVE_ERROR";
    await setLastDriveScan({
      at: new Date().toISOString(),
      folderCount: 0,
      error: message,
    }).catch(() => {});
    throw e instanceof Error ? e : new Error(message);
  }
}
