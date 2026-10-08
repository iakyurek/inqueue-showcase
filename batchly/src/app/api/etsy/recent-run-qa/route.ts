// GET /api/etsy/recent-run-qa?storeId=<storeId>&runId=<runId>
// READ-ONLY. QA checks for all created/partial listings in a run. Max 3 listings.
// Does not create, edit, publish, activate, upload images, or update inventory.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";
import { runListingQA, type ListingQAResult } from "@/lib/services/listingQa";

const MAX_QA_PER_RUN = 3;

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId")?.trim() ?? "";
  const runId = req.nextUrl.searchParams.get("runId")?.trim() ?? "";

  if (!storeId) return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  if (!runId) return NextResponse.json({ error: "MISSING_RUN_ID" }, { status: 400 });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { driveFolderName: true, etsyShopId: true, refreshToken: true },
  });

  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  if (!(await isStoreFolderEnabled(store.driveFolderName))) {
    return NextResponse.json(
      { error: `QA not enabled for ${store.driveFolderName}.` },
      { status: 403 },
    );
  }

  if (!store.etsyShopId || !store.refreshToken) {
    return NextResponse.json({ error: "STORE_NOT_CONNECTED" }, { status: 400 });
  }

  // Load the run and its records
  const run = await prisma.draftCreationRun.findUnique({
    where: { id: runId },
    include: {
      records: {
        where: {
          storeId,
          // Only QA rows that actually got a listingId (created or partial)
          listingId: { not: null },
        },
        orderBy: { createdAt: "asc" },
        take: MAX_QA_PER_RUN,
      },
    },
  });

  if (!run) return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });

  // Verify the run belongs to this store
  if (run.storeId !== storeId) {
    return NextResponse.json({ error: "RUN_STORE_MISMATCH" }, { status: 403 });
  }

  const recordsWithListings = run.records.filter((r) => r.listingId);

  if (recordsWithListings.length === 0) {
    return NextResponse.json({
      success: true,
      storeId,
      runId,
      runStatus: run.status,
      batchFolder: run.batchFolder,
      message: "No created listings found in this run to QA.",
      results: [],
    });
  }

  console.log(
    `[etsy/recent-run-qa] storeId=${storeId} runId=${runId} ` +
    `listings=${recordsWithListings.length}`,
  );

  const results: (ListingQAResult | { listingId: string; designId: string; error: string })[] = [];

  for (const record of recordsWithListings) {
    if (!record.listingId) continue;
    try {
      const qa = await runListingQA(storeId, record.listingId);
      results.push(qa);
    } catch (e) {
      const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
      console.error(
        `[etsy/recent-run-qa] QA failed for listingId=${record.listingId}: ${message}`,
      );
      results.push({ listingId: record.listingId, designId: record.designId, error: message });
    }
  }

  const qaStatuses = results
    .filter((r): r is ListingQAResult => "qaStatus" in r)
    .map((r) => r.qaStatus);

  const overallStatus =
    qaStatuses.includes("fail") ? "fail"
    : qaStatuses.includes("warning") ? "warning"
    : qaStatuses.length > 0 ? "pass"
    : "unknown";

  return NextResponse.json({
    success: true,
    storeId,
    runId,
    runStatus: run.status,
    batchFolder: run.batchFolder,
    overallQaStatus: overallStatus,
    listingsChecked: results.length,
    results,
  });
}
