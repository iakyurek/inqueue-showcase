import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const preset = await prisma.globalListingPreset.findFirst();
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

  const {
    whoMade,
    whenMade,
    listingType,
    renewalOption,
    isPersonalizable,
    defaultQuantity,
    defaultPrice,
    descriptionTemplate,
    materials,
    itemWeight,
    itemWeightUnit,
    itemLength,
    itemWidth,
    itemHeight,
    itemDimensionsUnit,
  } = body as Record<string, unknown>;

  const existing = await prisma.globalListingPreset.findFirst();

  const data = {
    ...(typeof whoMade === "string" && { whoMade }),
    ...(typeof whenMade === "string" && { whenMade }),
    ...(typeof listingType === "string" && { listingType }),
    ...(typeof renewalOption === "string" && { renewalOption }),
    ...(typeof isPersonalizable === "boolean" && { isPersonalizable }),
    ...(typeof defaultQuantity === "number" && { defaultQuantity }),
    ...(typeof defaultPrice === "string" && { defaultPrice }),
    ...(typeof descriptionTemplate === "string" && { descriptionTemplate }),
    ...(typeof materials === "string" && { materials }),
    ...(typeof itemWeight === "number" && { itemWeight }),
    ...(typeof itemWeightUnit === "string" && { itemWeightUnit }),
    ...(typeof itemLength === "number" && { itemLength }),
    ...(typeof itemWidth === "number" && { itemWidth }),
    ...(typeof itemHeight === "number" && { itemHeight }),
    ...(typeof itemDimensionsUnit === "string" && { itemDimensionsUnit }),
  };

  if (existing) {
    const updated = await prisma.globalListingPreset.update({ where: { id: existing.id }, data });
    return NextResponse.json(updated);
  }

  const created = await prisma.globalListingPreset.create({ data: { ...data } });
  return NextResponse.json(created);
}
