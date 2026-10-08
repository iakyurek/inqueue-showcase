import { prisma } from "@/lib/prisma";
import type {
  Batch,
  BatchDetail,
  BatchLog,
  ValidationResult,
  DashboardStats,
  Design,
  Listing,
  Store,
} from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toListingShape(l: {
  id: string;
  batchId: string;
  storeId: string;
  designId: string;
  sku: string;
  title: string;
  description: string;
  tags: string;
  price: number;
  productType: string;
  status: string;
  etsyListingId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  batch: { name: string };
  store: { name: string };
  design: { designCode: string };
  images: unknown[];
}): Listing {
  return {
    id: l.id,
    batchId: l.batchId,
    batchName: l.batch.name,
    storeId: l.storeId,
    storeName: l.store.name,
    designId: l.designId,
    designCode: l.design.designCode,
    sku: l.sku,
    title: l.title,
    description: l.description,
    tags: l.tags,
    price: l.price,
    productType: l.productType,
    status: l.status as Listing["status"],
    etsyListingId: l.etsyListingId ?? undefined,
    errorMessage: l.errorMessage ?? undefined,
    imageCount: l.images.length,
    createdAt: l.createdAt.toISOString().split("T")[0],
    updatedAt: l.updatedAt.toISOString().split("T")[0],
  };
}

const listingInclude = {
  batch: { select: { name: true } },
  store: { select: { name: true } },
  design: { select: { designCode: true } },
  images: { select: { id: true } },
} as const;

// ---------------------------------------------------------------------------
// getDashboardStats
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<DashboardStats> {
  const [
    activeBatches,
    storeCount,
    errorCount,
    listingsCreatedToday,
    totalDraftsAllTime,
  ] = await Promise.all([
    prisma.batch.count({ where: { status: { in: ["PROCESSING", "READY"] } } }),
    prisma.store.count(),
    prisma.listing.count({ where: { status: { in: ["ERROR", "NEEDS_REVIEW"] } } }),
    prisma.listing.count({
      where: {
        status: "DRAFT_CREATED",
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
    prisma.listing.count({ where: { status: "DRAFT_CREATED" } }),
  ]);

  return { activeBatches, listingsCreatedToday, errorCount, storeCount, totalDraftsAllTime };
}

// ---------------------------------------------------------------------------
// getBatches
// ---------------------------------------------------------------------------

export async function getBatches(): Promise<Batch[]> {
  const batches = await prisma.batch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { stores: true, designs: true, listings: true } },
      listings: {
        select: { status: true },
      },
    },
  });

  return batches.map((b) => {
    const completed = b.listings.filter((l) => l.status === "DRAFT_CREATED").length;
    const errors    = b.listings.filter((l) => l.status === "ERROR" || l.status === "NEEDS_REVIEW").length;
    return {
      id: b.id,
      name: b.name,
      driveFolder: b.driveFolder ?? undefined,
      status: b.status as Batch["status"],
      storeCount: b._count.stores,
      designCount: b._count.designs,
      totalListings: b._count.listings,
      completedListings: completed,
      errorListings: errors,
      createdAt: b.createdAt.toISOString().split("T")[0],
    };
  });
}

// ---------------------------------------------------------------------------
// getBatchById
// ---------------------------------------------------------------------------

export async function getBatchById(id: string): Promise<BatchDetail | null> {
  const b = await prisma.batch.findUnique({
    where: { id },
    include: {
      _count: { select: { stores: true, designs: true, listings: true } },
      stores:  { include: { store: true } },
      designs: true,
      listings: {
        include: listingInclude,
        orderBy: [{ storeId: "asc" }, { designId: "asc" }],
      },
    },
  });
  if (!b) return null;

  const completed = b.listings.filter((l) => l.status === "DRAFT_CREATED").length;
  const errors    = b.listings.filter((l) => l.status === "ERROR" || l.status === "NEEDS_REVIEW").length;

  const stores: Store[] = b.stores.map((bs) => ({
    id: bs.store.id,
    name: bs.store.name,
    etsyShopName: bs.store.etsyShopName ?? undefined,
    driveFolderName: bs.store.driveFolderName,
    skuPrefix: bs.store.skuPrefix,
    connected: !!(bs.store.accessToken),
    listingCount: b.listings.filter((l) => l.storeId === bs.store.id).length,
    createdAt: bs.store.createdAt.toISOString().split("T")[0],
  }));

  const designs: Design[] = b.designs.map((d) => ({
    id: d.id,
    designCode: d.designCode,
    batchId: d.batchId,
  }));

  return {
    id: b.id,
    name: b.name,
    driveFolder: b.driveFolder ?? undefined,
    status: b.status as Batch["status"],
    storeCount: b._count.stores,
    designCount: b._count.designs,
    totalListings: b._count.listings,
    completedListings: completed,
    errorListings: errors,
    createdAt: b.createdAt.toISOString().split("T")[0],
    stores,
    designs,
    listings: b.listings.map(toListingShape),
  };
}

// ---------------------------------------------------------------------------
// getStores
// ---------------------------------------------------------------------------

export async function getStores(): Promise<Store[]> {
  const stores = await prisma.store.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { listings: true } } },
  });

  return stores.map((s) => ({
    id: s.id,
    name: s.name,
    etsyShopName: s.etsyShopName ?? undefined,
    driveFolderName: s.driveFolderName,
    skuPrefix: s.skuPrefix,
    connected: !!(s.accessToken),
    listingCount: s._count.listings,
    createdAt: s.createdAt.toISOString().split("T")[0],
  }));
}

// ---------------------------------------------------------------------------
// getQueueListings — listings from the active PROCESSING batch
// ---------------------------------------------------------------------------

export async function getQueueListings(): Promise<Listing[]> {
  const processingBatch = await prisma.batch.findFirst({
    where: { status: "PROCESSING" },
    orderBy: { createdAt: "desc" },
  });
  if (!processingBatch) return [];

  const listings = await prisma.listing.findMany({
    where: { batchId: processingBatch.id },
    include: listingInclude,
    orderBy: [{ storeId: "asc" }, { designId: "asc" }],
    take: 80,
  });

  return listings.map(toListingShape);
}

// ---------------------------------------------------------------------------
// getErrorListings
// ---------------------------------------------------------------------------

export async function getErrorListings(): Promise<Listing[]> {
  const listings = await prisma.listing.findMany({
    where: { status: { in: ["ERROR", "NEEDS_REVIEW"] } },
    include: listingInclude,
    orderBy: { updatedAt: "desc" },
  });

  return listings.map(toListingShape);
}

// ---------------------------------------------------------------------------
// getBatchLogs
// ---------------------------------------------------------------------------

export async function getBatchLogs(batchId?: string): Promise<BatchLog[]> {
  const logs = await prisma.batchLog.findMany({
    where: batchId ? { batchId } : undefined,
    orderBy: { createdAt: "asc" },
  });

  return logs.map((l) => ({
    id: l.id,
    batchId: l.batchId,
    level: l.level as BatchLog["level"],
    message: l.message,
    createdAt: l.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// getReportData
// ---------------------------------------------------------------------------

export async function getReportData(): Promise<{
  doneBatches: Batch[];
  totalDrafts: number;
  totalErrors: number;
  storeCount: number;
  perStoreCounts: { store: Store; count: number }[];
}> {
  const [rawBatches, stores, totalDrafts, totalErrors] = await Promise.all([
    prisma.batch.findMany({
      where: { status: "DONE" },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { stores: true, designs: true, listings: true } },
        listings: { select: { status: true } },
      },
    }),
    getStores(),
    prisma.listing.count({ where: { status: "DRAFT_CREATED" } }),
    prisma.listing.count({ where: { status: { in: ["ERROR", "NEEDS_REVIEW"] } } }),
  ]);

  const doneBatches: Batch[] = rawBatches.map((b) => {
    const completed = b.listings.filter((l) => l.status === "DRAFT_CREATED").length;
    const errors    = b.listings.filter((l) => l.status === "ERROR" || l.status === "NEEDS_REVIEW").length;
    return {
      id: b.id,
      name: b.name,
      driveFolder: b.driveFolder ?? undefined,
      status: b.status as Batch["status"],
      storeCount: b._count.stores,
      designCount: b._count.designs,
      totalListings: b._count.listings,
      completedListings: completed,
      errorListings: errors,
      createdAt: b.createdAt.toISOString().split("T")[0],
    };
  });

  const perStoreCounts = await Promise.all(
    stores.map(async (store) => ({
      store,
      count: await prisma.listing.count({
        where: { storeId: store.id, status: "DRAFT_CREATED" },
      }),
    })),
  );

  return { doneBatches, totalDrafts, totalErrors, storeCount: stores.length, perStoreCounts };
}

// ---------------------------------------------------------------------------
// saveValidationLog — Phase 3
// ---------------------------------------------------------------------------

export async function saveValidationLog(batchId: string, result: ValidationResult): Promise<void> {
  const level = result.valid ? "INFO" : "ERROR";
  const message = `Validation ${result.valid ? "passed" : "failed"} — ${result.errors.length} errors, ${result.warnings.length} warnings, ${result.totalImagesFound} images, ${result.manifestRowCount} manifest rows`;
  await prisma.batchLog.create({ data: { batchId, level, message } });
}
