import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

export async function GET() {
  const [stores, storeEtsyIdsList, latestRun, allTimeTotals] = await Promise.all([
    prisma.store.findMany({
      select: {
        id: true, name: true, driveFolderName: true,
        etsyShopId: true, refreshToken: true, etsyShopName: true,
      },
    }),
    prisma.storeEtsyIds.findMany(),
    prisma.batchRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true, status: true, batchFolder: true,
        created: true, failed: true, partial: true, skipped: true,
        totalRows: true, startedAt: true, completedAt: true,
      },
    }),
    prisma.batchRun.aggregate({
      _sum: { created: true, failed: true, skipped: true },
    }),
  ]);

  let localBatchesCount = 0;
  try {
    if (fs.existsSync(DOWNLOADS_DIR)) {
      localBatchesCount = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    }
  } catch { /* ignore */ }

  const etsyIdsMap = new Map(storeEtsyIdsList.map((e) => [e.storeId, e]));

  const storeReadiness = stores.map((s) => {
    const isConnected = !!(s.etsyShopId && s.refreshToken);
    const hasShop = !!s.etsyShopName;
    const ids = etsyIdsMap.get(s.id);
    const idsConfigured = [
      ids?.taxonomyId, ids?.shippingProfileId,
      ids?.readinessStateId, ids?.returnPolicyId,
    ].filter(Boolean).length;
    const allIdsReady = !!(ids?.taxonomyId && ids?.shippingProfileId && ids?.readinessStateId);
    return {
      id: s.id,
      name: s.name,
      folder: s.driveFolderName,
      isConnected,
      hasShop,
      shopName: s.etsyShopName,
      idsConfigured,
      totalIds: 4,
      fullyReady: isConnected && hasShop && allIdsReady,
    };
  });

  const connectedStores = storeReadiness.filter((s) => s.isConnected).length;
  const offlineStores   = storeReadiness.filter((s) => !s.isConnected).length;
  const readyStores     = storeReadiness.filter((s) => s.fullyReady).length;
  const storesMissingIds = storeReadiness.filter((s) => s.isConnected && !s.fullyReady).length;

  return NextResponse.json({
    totalStores: stores.length,
    connectedStores,
    offlineStores,
    readyStores,
    storesMissingIds,
    localBatchesCount,
    latestRun,
    allTimeDraftsCreated: allTimeTotals._sum.created ?? 0,
    allTimeFailedRows: allTimeTotals._sum.failed ?? 0,
    allTimeSkipped: allTimeTotals._sum.skipped ?? 0,
    storeReadiness,
  });
}
