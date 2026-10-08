import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  listSupplementalImagesForPreset,
  validateSupplementalImagePreset,
} from "@/lib/services/supplementalImageHelpers";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

export async function GET() {
  const preset = await prisma.globalSupplementalImagePreset.findFirst();
  if (!preset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const { warnings, errors } = validateSupplementalImagePreset(preset);
  const files = listSupplementalImagesForPreset(preset);

  const sizeChartFiles = files.filter((f) => f.category === "size-chart").map((f) => f.basename);
  const promoFiles = files.filter((f) => f.category === "promo").map((f) => f.basename);

  return NextResponse.json({
    enabled: preset.enabled,
    includeSizeCharts: preset.includeSizeCharts,
    includePromoImages: preset.includePromoImages,
    sizeChartFolder: preset.sizeChartFolder,
    promoFolder: preset.promoFolder,
    maxSupplementalImages: preset.maxSupplementalImages,
    totalFiles: files.length,
    sizeChartFiles,
    promoFiles,
    allFiles: files.map((f) => ({ basename: f.basename, category: f.category })),
    warnings,
    errors,
  });
}
