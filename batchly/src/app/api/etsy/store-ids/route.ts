import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });

  const record = await prisma.storeEtsyIds.findUnique({ where: { storeId } });
  if (!record) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(record);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST_BODY" }, { status: 400 });
  }

  const { storeId, taxonomyId, shippingProfileId, readinessStateId, returnPolicyId, sectionId } =
    body as Record<string, unknown>;

  if (typeof storeId !== "string") {
    return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  const data = {
    taxonomyId: typeof taxonomyId === "string" && taxonomyId.trim() ? taxonomyId.trim() : null,
    shippingProfileId:
      typeof shippingProfileId === "string" && shippingProfileId.trim()
        ? shippingProfileId.trim()
        : null,
    readinessStateId:
      typeof readinessStateId === "string" && readinessStateId.trim()
        ? readinessStateId.trim()
        : null,
    returnPolicyId:
      typeof returnPolicyId === "string" && returnPolicyId.trim() ? returnPolicyId.trim() : null,
    sectionId: typeof sectionId === "string" && sectionId.trim() ? sectionId.trim() : null,
  };

  const result = await prisma.storeEtsyIds.upsert({
    where: { storeId },
    update: data,
    create: { storeId, ...data },
  });

  return NextResponse.json(result);
}
