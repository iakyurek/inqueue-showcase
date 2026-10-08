import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DOWNLOADS_DIR = path.resolve(process.cwd(), "workspace", "downloads");
const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;

function reject(message: string, status = 400) {
  return NextResponse.json({ removed: false, error: message }, { status });
}

function resolveBatchPath(batchId: string) {
  const trimmed = batchId.trim();
  if (!trimmed) return { error: "Batch name is required." };
  if (trimmed === "." || trimmed === "..") return { error: "Invalid batch name." };
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return { error: "Invalid batch name." };
  }

  const workspaceRoot = DOWNLOADS_DIR;
  const targetPath = path.resolve(workspaceRoot, trimmed);
  const relative = path.relative(workspaceRoot, targetPath);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Refusing to delete outside the Batchly downloads workspace." };
  }

  return { batchId: trimmed, workspaceRoot, targetPath };
}

async function readDeleteOptions(req: NextRequest) {
  try {
    const body = await req.json() as { confirmDraftRecords?: unknown };
    return { confirmDraftRecords: body.confirmDraftRecords === true };
  } catch {
    return { confirmDraftRecords: false };
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { batchId: string } }) {
  const resolved = resolveBatchPath(params.batchId);
  if ("error" in resolved) return reject(resolved.error ?? "Invalid batch name.");

  const { batchId, targetPath } = resolved;
  let stat;
  try {
    stat = await fs.lstat(targetPath);
  } catch {
    return reject(`Batch workspace folder not found: ${batchId}`, 404);
  }

  if (!stat.isDirectory()) {
    return reject("Batch workspace target is not a directory.");
  }
  if (stat.isSymbolicLink()) {
    return reject("Refusing to delete a symbolic link.");
  }

  const [activeRun, draftRecordCount, createdDraftRecordCount, batchRunCount] = await Promise.all([
    prisma.batchRun.findFirst({
      where: { batchFolder: batchId, status: { in: [...ACTIVE_RUN_STATUSES] } },
      orderBy: { startedAt: "desc" },
      select: { id: true, status: true },
    }),
    prisma.draftCreationRecord.count({ where: { batchFolder: batchId } }),
    prisma.draftCreationRecord.count({ where: { batchFolder: batchId, listingId: { not: null } } }),
    prisma.batchRun.count({ where: { batchFolder: batchId } }),
  ]);

  if (activeRun) {
    return reject("This batch is currently uploading. Wait for it to finish before removing it.", 409);
  }

  const { confirmDraftRecords } = await readDeleteOptions(req);
  if (createdDraftRecordCount > 0 && !confirmDraftRecords) {
    return NextResponse.json(
      {
        removed: false,
        error: "This batch has Etsy draft records. Removing it will only delete local workspace files and will not delete Etsy drafts.",
        requiresDraftRecordConfirmation: true,
        preservedRecords: {
          draftCreationRecords: draftRecordCount,
          createdDraftRecords: createdDraftRecordCount,
          batchRuns: batchRunCount,
        },
      },
      { status: 409 },
    );
  }

  await fs.rm(targetPath, { recursive: true, force: false });

  const warnings = createdDraftRecordCount > 0
    ? ["This batch has Etsy draft records. Removing it only deleted local workspace files and did not delete Etsy drafts."]
    : [];

  return NextResponse.json({
    removed: true,
    batchId,
    deletedPath: targetPath,
    preservedRecords: {
      draftCreationRecords: draftRecordCount,
      createdDraftRecords: createdDraftRecordCount,
      batchRuns: batchRunCount,
    },
    warnings,
  });
}
