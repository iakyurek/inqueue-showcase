import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const preset = await prisma.globalVariationPreset.findFirst();
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

  const {
    enabled,
    variation1Name,
    variation1PropertyId,
    variation1Options,
    variation2Name,
    variation2PropertyId,
    variation2Options,
    quantityPerVariation,
    priceMode,
    skuMode,
  } = b;

  // Validate — enabled requires property IDs to be set
  if (enabled === true) {
    if (!variation1PropertyId || String(variation1PropertyId).trim() === "") {
      return NextResponse.json(
        { error: "variation1PropertyId is required when enabled. Look up the Size property ID via the taxonomy properties helper." },
        { status: 400 },
      );
    }
    if (!variation2PropertyId || String(variation2PropertyId).trim() === "") {
      return NextResponse.json(
        { error: "variation2PropertyId is required when enabled. Look up the Color property ID via the taxonomy properties helper." },
        { status: 400 },
      );
    }
    if (!variation1Options || String(variation1Options).trim() === "") {
      return NextResponse.json({ error: "variation1Options must not be empty when enabled." }, { status: 400 });
    }
    if (!variation2Options || String(variation2Options).trim() === "") {
      return NextResponse.json({ error: "variation2Options must not be empty when enabled." }, { status: 400 });
    }
    // Warn if combination count is too large
    const v1Count = String(variation1Options).split(",").map((s) => s.trim()).filter(Boolean).length;
    const v2Count = String(variation2Options).split(",").map((s) => s.trim()).filter(Boolean).length;
    if (v1Count * v2Count > 100) {
      return NextResponse.json(
        { error: `Too many variation combinations (${v1Count * v2Count}). Max 100. Reduce options.` },
        { status: 400 },
      );
    }
  }

  const data = {
    ...(typeof enabled === "boolean" && { enabled }),
    ...(typeof variation1Name === "string" && { variation1Name }),
    ...(typeof variation1PropertyId === "string"
      ? { variation1PropertyId: variation1PropertyId.trim() || null }
      : variation1PropertyId === null
        ? { variation1PropertyId: null }
        : {}),
    ...(typeof variation1Options === "string" && { variation1Options }),
    ...(typeof variation2Name === "string" && { variation2Name }),
    ...(typeof variation2PropertyId === "string"
      ? { variation2PropertyId: variation2PropertyId.trim() || null }
      : variation2PropertyId === null
        ? { variation2PropertyId: null }
        : {}),
    ...(typeof variation2Options === "string" && { variation2Options }),
    ...(typeof quantityPerVariation === "number" && quantityPerVariation > 0 && { quantityPerVariation }),
    ...(typeof priceMode === "string" && { priceMode }),
    ...(typeof skuMode === "string" && { skuMode }),
  };

  const existing = await prisma.globalVariationPreset.findFirst();

  if (existing) {
    const updated = await prisma.globalVariationPreset.update({ where: { id: existing.id }, data });
    return NextResponse.json(updated);
  }

  const created = await prisma.globalVariationPreset.create({ data });
  return NextResponse.json(created);
}
