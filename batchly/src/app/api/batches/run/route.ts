import { NextRequest, NextResponse } from "next/server";
import { createBatchRun } from "@/lib/services/batchRunService";

export async function POST(req: NextRequest) {
  let batchFolder: string | undefined;
  let maxListingsPerStore: number | undefined;
  let selectedStoreFolders: string[] | undefined;

  try {
    const body = await req.json() as { batchFolder?: unknown; maxListingsPerStore?: unknown; selectedStoreFolders?: unknown };
    batchFolder = typeof body.batchFolder === "string" ? body.batchFolder.trim() : undefined;
    if (typeof body.maxListingsPerStore === "number") {
      maxListingsPerStore = Math.min(Math.max(1, body.maxListingsPerStore), 30);
    }
    if (Array.isArray(body.selectedStoreFolders)) {
      selectedStoreFolders = (body.selectedStoreFolders as unknown[])
        .filter((f): f is string => typeof f === "string" && f.length > 0)
        .slice(0, 8); // max 8 stores
    }
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  if (!batchFolder) {
    return NextResponse.json({ error: "MISSING_BATCH_FOLDER" }, { status: 400 });
  }

  if (batchFolder.includes("..") || batchFolder.includes("/") || batchFolder.includes("\\")) {
    return NextResponse.json({ error: "INVALID_BATCH_FOLDER" }, { status: 400 });
  }

  try {
    const result = await createBatchRun(batchFolder, { maxListingsPerStore, selectedStoreFolders });
    console.log(
      `[batches/run] created BatchRun id=${result.runId} batchFolder=${batchFolder} ` +
      `stores=${result.totalStores} rows=${result.totalRows}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    if (message.startsWith("MANIFEST_ERRORS:")) {
      return NextResponse.json({ error: "MANIFEST_ERRORS", details: message.slice(16) }, { status: 400 });
    }
    if (message === "GLOBAL_PRESET_MISSING") {
      return NextResponse.json({ error: "GLOBAL_PRESET_MISSING", message: "GlobalListingPreset not found. Run npm run db:seed." }, { status: 400 });
    }
    console.error(`[batches/run] createBatchRun failed: ${message}`);
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
