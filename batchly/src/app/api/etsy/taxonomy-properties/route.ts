import { NextRequest, NextResponse } from "next/server";

const ETSY_API_BASE = "https://openapi.etsy.com/v3";

export interface EtsyTaxonomyProperty {
  property_id: number;
  name: string;
  display_name: string;
  scales: { scale_id: number; display_name: string; description: string }[] | null;
  is_required: boolean;
  supports_attributes: boolean;
  supports_variations: boolean;
  is_multivalued: boolean;
  max_values_allowed: number | null;
  possible_values: { value_id: number; name: string; scale_id: number | null; equal_to: number[] }[] | null;
}

export async function GET(req: NextRequest) {
  const taxonomyId = req.nextUrl.searchParams.get("taxonomyId")?.trim();

  if (!taxonomyId) {
    return NextResponse.json({ error: "MISSING_TAXONOMY_ID" }, { status: 400 });
  }

  const numericId = Number(taxonomyId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return NextResponse.json({ error: "INVALID_TAXONOMY_ID — must be a positive integer." }, { status: 400 });
  }

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) {
    return NextResponse.json({ error: "MISSING_CREDENTIALS" }, { status: 500 });
  }
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/seller-taxonomy/nodes/${numericId}/properties`;
  console.log(`[etsy/taxonomy-properties] GET taxonomyId=${numericId}`);

  try {
    const res = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
    });

    console.log(`[etsy/taxonomy-properties] HTTP ${res.status} for taxonomyId=${numericId}`);

    const body = await res.text().catch(() => "(unreadable)");

    if (!res.ok) {
      console.error(`[etsy/taxonomy-properties] failed — status ${res.status}`);
      return NextResponse.json(
        { error: `ETSY_API_ERROR: ${res.status}`, hint: "Check that taxonomyId is valid." },
        { status: res.status >= 400 && res.status < 500 ? 400 : 500 },
      );
    }

    let data: { results?: EtsyTaxonomyProperty[] };
    try {
      data = JSON.parse(body) as { results?: EtsyTaxonomyProperty[] };
    } catch {
      return NextResponse.json({ error: "ETSY_INVALID_JSON" }, { status: 500 });
    }

    const properties = (data.results ?? []).map((p) => ({
      property_id: p.property_id,
      name: p.name,
      display_name: p.display_name,
      supports_variations: p.supports_variations,
      is_required: p.is_required,
      is_multivalued: p.is_multivalued,
      scales: p.scales ?? null,
      possible_values: p.possible_values
        ? p.possible_values.slice(0, 30).map((v) => ({ value_id: v.value_id, name: v.name }))
        : null,
    }));

    const variationProps = properties.filter((p) => p.supports_variations);

    console.log(
      `[etsy/taxonomy-properties] taxonomyId=${numericId} total=${properties.length} variation-supporting=${variationProps.length}`,
    );

    return NextResponse.json({ taxonomyId: numericId, properties, variationProps });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    console.error(`[etsy/taxonomy-properties] threw: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
