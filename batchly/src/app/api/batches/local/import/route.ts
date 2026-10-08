import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { downloadBatchFolder, isConnected } from "@/lib/services/drive";
import { prisma } from "@/lib/prisma";
import {
  DOWNLOADS_DIR,
  isSafeBatchFolderName,
  readBatchWorkflowMetadata,
  writeBatchWorkflowMetadata,
} from "@/lib/services/batchWorkflowMetadata";

function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ imported: false, error, ...(extra ?? {}) }, { status });
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await isConnected())) {
    return jsonError("NOT_CONNECTED", 401);
  }

  let body: { folderId?: unknown; folderName?: unknown };
  try {
    body = await req.json() as { folderId?: unknown; folderName?: unknown };
  } catch {
    return jsonError("INVALID_BODY");
  }

  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
  const folderName = typeof body.folderName === "string" ? body.folderName.trim() : "";

  if (!folderId) return jsonError("INVALID_FOLDER_ID");
  if (!isSafeBatchFolderName(folderName)) return jsonError("INVALID_FOLDER_NAME");

  const localPath = path.join(DOWNLOADS_DIR, folderName);
  const metadata = readBatchWorkflowMetadata(folderName);
  const createdDraftRecords = await prisma.draftCreationRecord.count({
    where: { batchFolder: folderName, listingId: { not: null } },
  });

  if (fs.existsSync(localPath)) {
    if (metadata?.stage === "completed" || metadata?.confirmedCompletedAt || (createdDraftRecords > 0 && !metadata)) {
      return jsonError("This batch was already completed.", 409, { duplicateStatus: "completed" });
    }
    return jsonError("This batch is already inQueue.", 409, { duplicateStatus: "inqueue" });
  }

  writeBatchWorkflowMetadata(folderName, {
    sourceDriveFolderId: folderId,
    sourceDriveFolderName: folderName,
    importedAt: new Date().toISOString(),
    selectedAt: new Date().toISOString(),
    stage: "importing",
  });

  try {
    const downloadResult = await downloadBatchFolder(folderId, folderName);
    const metadataAfterImport = writeBatchWorkflowMetadata(folderName, {
      sourceDriveFolderId: folderId,
      sourceDriveFolderName: folderName,
      stage: "added_to_inqueue",
    });

    return NextResponse.json({
      imported: true,
      batchFolder: folderName,
      downloadResult,
      metadata: metadataAfterImport,
    });
  } catch (e) {
    writeBatchWorkflowMetadata(folderName, { stage: "failed_needs_attention" });
    const message = e instanceof Error ? e.message : "DOWNLOAD_ERROR";
    if (message === "NOT_CONNECTED") {
      return jsonError("NOT_CONNECTED", 401);
    }
    return jsonError("DOWNLOAD_ERROR", 500, { detail: message });
  }
}
