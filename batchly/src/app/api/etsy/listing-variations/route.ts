import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getListingVariationProperties } from "@/lib/services/etsy";

// Read-only helper endpoint: given a store + an existing listing ID, return the
// listing's variation properties (id + name + sample values). Used to discover
// the Style / Primary-color property IDs the variation-profile matrix needs,
// straight from a real listing (the only place a custom "Style" property ID
// appears). GET only — performs no Etsy writes, creates no drafts.
export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId");
  const listingId = req.nextUrl.searchParams.get("listingId");
  if (!storeId) return NextResponse.json({ error: "MISSING_STORE_ID" }, { status: 400 });
  if (!listingId || !/^\d+$/.test(listingId.trim())) {
    return NextResponse.json({ error: "MISSING_OR_INVALID_LISTING_ID", fix: "Pass listingId= a numeric Etsy listing ID." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store) return NextResponse.json({ error: "STORE_NOT_FOUND" }, { status: 404 });

  try {
    const properties = await getListingVariationProperties(storeId, listingId.trim());
    if (properties.length === 0) {
      return NextResponse.json({
        storeId,
        listingId: listingId.trim(),
        properties: [],
        note: "This listing has no variations — pick a listing that actually uses the Style + Primary-color variations.",
      });
    }
    return NextResponse.json({
      storeId,
      listingId: listingId.trim(),
      properties, // ordered: variation 1 (Style) then variation 2 (Primary color)
      hint: "variation1PropertyId = the property whose values look like garment/size; variation2PropertyId = the color property.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
