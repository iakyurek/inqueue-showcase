import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import {
  DOWNLOADS_DIR,
  resolveBatchFolderPath,
  writeBatchWorkflowMetadata,
} from "@/lib/services/batchWorkflowMetadata";

function jsonError(error: string, status = 400) {
  return NextResponse.json({ completed: false, error }, { status });
}

export async function POST(_req: NextRequest, { params }: { params: { batchId: string } }) {
  const batchId = decodeURIComponent(params.batchId).trim();
  const resolved = resolveBatchFolderPath(batchId);
  if (resolved.error) return jsonError(resolved.error);

  if (!fs.existsSync(resolved.batchPath)) {
    return jsonError(`Batch workspace folder not found: ${batchId}`, 404);
  }

  const latestRun = await prisma.batchRun.findFirst({
    where: { batchFolder: batchId },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      totalRows: true,
      created: true,
      skipped: true,
      partial: true,
      failed: true,
      completedAt: true,
    },
  });

  const manifest = parseManifest(path.join(DOWNLOADS_DIR, batchId, "batch_manifest.csv"));
  const manifestKeys = manifest.rows.map((row) => `${row.store_folder}/${row.design_id}`);
  const createdRecords = await prisma.draftCreationRecord.findMany({
    where: { batchFolder: batchId, listingId: { not: null } },
    select: { storeFolder: true, designId: true },
  });
  const createdKeys = new Set(createdRecords.map((record) => `${record.storeFolder}/${record.designId}`));
  const allManifestRowsCreated =
    manifestKeys.length > 0 && manifestKeys.every((key) => createdKeys.has(key));

  const latestRunSucceeded =
    !!latestRun &&
    latestRun.status === "completed" &&
    latestRun.failed === 0 &&
    latestRun.partial === 0;

  if (!latestRunSucceeded && !allManifestRowsCreated) {
    return jsonError("Batch still has unresolved rows. Complete or safely skip all rows before moving it to Completed Batches.", 409);
  }

  const completedAt = new Date().toISOString();
  const metadata = writeBatchWorkflowMetadata(batchId, {
    stage: "completed",
    lastRunId: latestRun?.id,
    confirmedCompletedAt: completedAt,
    completedAt,
  });

  return NextResponse.json({
    completed: true,
    batchId,
    completedAt,
    latestRunId: latestRun?.id ?? null,
    preservedRecords: {
      draftCreationRecords: createdRecords.length,
      batchRun: latestRun ? 1 : 0,
    },
    metadata,
  });
}
