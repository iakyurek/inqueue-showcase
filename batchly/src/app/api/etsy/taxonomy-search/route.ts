import { NextRequest, NextResponse } from "next/server";
import { searchSellerTaxonomy } from "@/lib/services/etsy";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "MISSING_QUERY" }, { status: 400 });
  }

  if (!process.env.ETSY_CLIENT_ID) {
    return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 500 });
  }

  try {
    const results = await searchSellerTaxonomy(q);
    return NextResponse.json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/taxonomy-search] failed: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
