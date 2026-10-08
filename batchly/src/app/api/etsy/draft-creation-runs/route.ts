import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId") ?? undefined;

  if (!storeId) {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true },
  });

  if (!store) {
    return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });
  }

  const runs = await prisma.draftCreationRun.findMany({
    where: { storeId },
    orderBy: { startedAt: "desc" },
    take: 5,
    select: {
      id: true,
      storeFolder: true,
      batchFolder: true,
      requestedDesignIds: true,
      status: true,
      createdCount: true,
      skippedCount: true,
      failedCount: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return NextResponse.json({ runs });
}
