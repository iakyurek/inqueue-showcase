import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isConnected as isDriveConnected } from "@/lib/services/drive";
import path from "path";
import fs from "fs";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

export async function GET() {
  const driveConnected = await isDriveConnected().catch(() => false);
  const [stores, storeEtsyIdsList, latestRun] = await Promise.all([
    prisma.store.findMany({
      select: { id: true, name: true, driveFolderName: true, etsyShopName: true, etsyShopId: true, refreshToken: true },
    }),
    prisma.storeEtsyIds.findMany({
      select: { storeId: true, taxonomyId: true, shippingProfileId: true, readinessStateId: true },
    }),
    prisma.batchRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        batchFolder: true,
        created: true,
        failed: true,
        partial: true,
        totalRows: true,
        startedAt: true,
        completedAt: true,
      },
    }),
  ]);

  // Count local batch folders
  let localBatchCount = 0;
  try {
    if (fs.existsSync(DOWNLOADS_DIR)) {
      localBatchCount = fs
        .readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    }
  } catch { /* non-fatal */ }

  // Connected = has etsyShopId + refreshToken
  const connectedStoreCount = stores.filter(
    (s) => s.etsyShopId && s.refreshToken,
  ).length;

  // Ready = connected + has all 3 required IDs
  const storeIdsMap = new Map(storeEtsyIdsList.map((e) => [e.storeId, e]));
  const readyStoreCount = stores.filter((s) => {
    if (!s.etsyShopId || !s.refreshToken) return false;
    const ids = storeIdsMap.get(s.id);
    return !!(ids?.taxonomyId && ids.shippingProfileId && ids.readinessStateId);
  }).length;

  return NextResponse.json({
    driveConnected,
    driveStatusLabel: driveConnected ? "Connected" : "Not connected",
    localBatchCount,
    connectedStoreCount,
    readyStoreCount,
    connectedStores: stores
      .filter((s) => s.etsyShopId && s.refreshToken)
      .map((s) => ({
        id: s.id,
        name: s.name,
        driveFolderName: s.driveFolderName,
        etsyShopName: s.etsyShopName,
      })),
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          batchFolder: latestRun.batchFolder,
          created: latestRun.created,
          failed: latestRun.failed,
          partial: latestRun.partial,
          totalRows: latestRun.totalRows,
          startedAt: latestRun.startedAt,
          completedAt: latestRun.completedAt,
        }
      : null,
  });
}
