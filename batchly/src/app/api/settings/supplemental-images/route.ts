import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateSupplementalImagePreset } from "@/lib/services/supplementalImageHelpers";

const SUPPLEMENTAL_ROOT_PREFIX = "workspace/supplemental-images";

function isSafeFolderPath(folderPath: string): boolean {
  if (!folderPath.startsWith(SUPPLEMENTAL_ROOT_PREFIX)) return false;
  // Reject path traversal
  const normalized = folderPath.replace(/\\/g, "/");
  if (normalized.includes("../") || normalized.includes("..\\")) return false;
  return true;
}

export async function GET() {
  const preset = await prisma.globalSupplementalImagePreset.findFirst();
  if (!preset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(preset);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  // Validate types
  if (typeof b.enabled !== "undefined" && typeof b.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
  }

  const maxSup = typeof b.maxSupplementalImages === "number" ? b.maxSupplementalImages : undefined;
  if (maxSup !== undefined && (maxSup < 0 || maxSup > 10 || !Number.isInteger(maxSup))) {
    return NextResponse.json(
      { error: "maxSupplementalImages must be an integer between 0 and 10." },
      { status: 400 },
    );
  }

  // Validate folder paths — must stay under workspace/supplemental-images
  if (typeof b.sizeChartFolder === "string" && !isSafeFolderPath(b.sizeChartFolder)) {
    return NextResponse.json(
      { error: "sizeChartFolder must be under workspace/supplemental-images and must not contain path traversal." },
      { status: 400 },
    );
  }

  if (typeof b.promoFolder === "string" && !isSafeFolderPath(b.promoFolder)) {
    return NextResponse.json(
      { error: "promoFolder must be under workspace/supplemental-images and must not contain path traversal." },
      { status: 400 },
    );
  }

  const sizeChartRequiredCount =
    typeof b.sizeChartRequiredCount === "number" ? b.sizeChartRequiredCount : undefined;
  if (sizeChartRequiredCount !== undefined && (sizeChartRequiredCount < 0 || sizeChartRequiredCount > 10)) {
    return NextResponse.json({ error: "sizeChartRequiredCount must be 0–10." }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof b.enabled === "boolean") data.enabled = b.enabled;
  if (typeof b.includeSizeCharts === "boolean") data.includeSizeCharts = b.includeSizeCharts;
  if (sizeChartRequiredCount !== undefined) data.sizeChartRequiredCount = sizeChartRequiredCount;
  if (typeof b.includePromoImages === "boolean") data.includePromoImages = b.includePromoImages;
  if (typeof b.sizeChartFolder === "string") data.sizeChartFolder = b.sizeChartFolder.trim();
  if (typeof b.promoFolder === "string") data.promoFolder = b.promoFolder.trim();
  if (maxSup !== undefined) data.maxSupplementalImages = maxSup;

  const existing = await prisma.globalSupplementalImagePreset.findFirst();

  let saved;
  if (existing) {
    saved = await prisma.globalSupplementalImagePreset.update({ where: { id: existing.id }, data });
  } else {
    saved = await prisma.globalSupplementalImagePreset.create({ data });
  }

  // Run validation to surface warnings (non-blocking)
  const { warnings, errors } = validateSupplementalImagePreset({
    enabled: saved.enabled,
    includeSizeCharts: saved.includeSizeCharts,
    includePromoImages: saved.includePromoImages,
    sizeChartFolder: saved.sizeChartFolder,
    promoFolder: saved.promoFolder,
    maxSupplementalImages: saved.maxSupplementalImages,
  });

  return NextResponse.json({ ...saved, warnings, errors });
}
