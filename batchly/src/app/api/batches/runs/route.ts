import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await prisma.batchRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      stores: {
        select: { id: true, storeFolder: true, storeName: true, status: true, skipReason: true, created: true, failed: true, attempted: true },
        orderBy: { storeFolder: "asc" },
      },
    },
  });

  return NextResponse.json({ runs });
}
