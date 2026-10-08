import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  scanPendingBatches,
  readAutoValidationMarker,
  writeAutoValidationMarker,
  isStaleValidatingMarker,
} from "@/lib/services/scanPendingBatches";
import { DOWNLOADS_DIR } from "@/lib/services/batchWorkflowMetadata";
import { downloadBatchFolder } from "@/lib/services/drive";
import { POST as validateRoute } from "@/app/api/batches/validate/route";
import type { BatchValidationResult } from "@/app/api/batches/validate/route";

export const maxDuration = 300;

// Batches currently being downloaded/validated by this process — prevents a
// polling Preply from kicking off the same import twice.
const importsInFlight = new Set<string>();

// Runs the full validate route logic in-process (no HTTP hop, no cookies) —
// the route handler is just an exported function taking a Request.
async function runFullValidation(batchFolder: string): Promise<BatchValidationResult> {
  const request = new NextRequest("http://internal/api/batches/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ batchFolder }),
  });
  const response = await validateRoute(request);
  const body = (await response.json()) as BatchValidationResult & { error?: string };
  if (!response.ok) throw new Error(body.error || "VALIDATION_ERROR");
  return body;
}

async function autoImportBatch(target: { id: string; name: string }): Promise<void> {
  importsInFlight.add(target.name);
  writeAutoValidationMarker(target.name, { status: "validating", startedAt: new Date().toISOString() });
  try {
    await downloadBatchFolder(target.id, target.name);
    const validation = await runFullValidation(target.name);
    writeAutoValidationMarker(target.name, {
      status: validation.overallStatus === "failed" ? "failed" : validation.overallStatus === "warnings" ? "warnings" : "ready",
      overallStatus: validation.overallStatus,
      finishedAt: new Date().toISOString(),
    });
    console.log(`[auto-import] batch "${target.name}" downloaded + validated: ${validation.overallStatus}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AUTO_IMPORT_FAILED";
    writeAutoValidationMarker(target.name, { status: "failed", error: message, finishedAt: new Date().toISOString() });
    console.error(`[auto-import] batch "${target.name}" failed:`, message);
  } finally {
    importsInFlight.delete(target.name);
  }
}

// Service-to-service endpoint: Preply pings this right after uploading an
// exported batch to the Drive pending-batches folder. With autoImport, the
// named batch is downloaded and fully validated in the background — it lands
// in the inQueue pool with zero operator steps; Preply polls this same
// endpoint to render "Validating batch…" progress. Auth is the short-lived
// HMAC Bearer token (aud=batchly) enforced by middleware for /api/internal/*.
export async function POST(req: NextRequest) {
  let batchFolderName: string | null = null;
  let autoImport = false;
  try {
    const body = (await req.json()) as { batchFolderName?: unknown; autoImport?: unknown };
    batchFolderName = typeof body.batchFolderName === "string" ? body.batchFolderName.trim() : null;
    autoImport = body.autoImport === true;
  } catch {
    // empty body = plain scan
  }

  try {
    const batches = await scanPendingBatches();

    if (autoImport && batchFolderName) {
      const target = batches.find((b) => b.name === batchFolderName);
      if (target && !target.alreadyCompleted) {
        const inFlight = importsInFlight.has(target.name);
        const marker = target.autoValidation;

        // Heal ghost folders: the legacy marker bug (and any interrupted
        // pre-temp-dir download) could leave a batch folder with no manifest
        // and no store folders — locally "present" but unusable, permanently
        // blocking re-import. Remove it and import fresh.
        const ghost =
          target.localExists && target.hasManifest === false && target.storeFoldersDetected.length === 0;
        if (ghost && !inFlight) {
          fs.rmSync(path.join(DOWNLOADS_DIR, target.name), { recursive: true, force: true });
          target.localExists = false;
        }

        // Import when the batch isn't local yet AND nothing live is working
        // on it: first sight, a failed previous attempt, or a "validating"
        // marker orphaned by a restart (in-flight set is in-memory).
        const importable =
          !target.localExists &&
          !inFlight &&
          (!marker || marker.status === "failed" || isStaleValidatingMarker(marker, inFlight));
        if (importable) {
          // Fire-and-forget: download + validation can take minutes; the
          // caller polls for the marker instead of holding this request open.
          void autoImportBatch(target);
          target.autoValidation = { status: "validating", startedAt: new Date().toISOString() };
        } else if (inFlight && !target.autoValidation) {
          target.autoValidation = { status: "validating" };
        }
      }
    }

    const requested = batchFolderName
      ? batches.find((b) => b.name === batchFolderName) ?? null
      : null;
    if (requested && importsInFlight.has(requested.name) && requested.autoValidation?.status !== "validating") {
      requested.autoValidation = readAutoValidationMarker(requested.name) ?? { status: "validating" };
    }

    return NextResponse.json({ ok: true, batches, batch: requested });
  } catch (e) {
    const message = e instanceof Error ? e.message : "DRIVE_ERROR";
    if (message === "NOT_CONNECTED") {
      return NextResponse.json({ ok: false, error: "NOT_CONNECTED" }, { status: 409 });
    }
    if (message === "PENDING_FOLDER_NOT_CONFIGURED") {
      return NextResponse.json({ ok: false, error: "PENDING_FOLDER_NOT_CONFIGURED" }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "DRIVE_ERROR", detail: message }, { status: 500 });
  }
}
