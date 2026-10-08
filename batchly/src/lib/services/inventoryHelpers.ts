const MAX_COMBINATIONS = 100;
// The named-profile path (e.g. front_sided = 28 Style x 14 color = 392) needs a
// higher ceiling than the simple operator preset. Etsy requires a product for
// EVERY combination of the two variation values, so the whole grid is sent;
// whether the v3 API accepts this many in one call is confirmed by the live
// E2E run (it fails gracefully — the draft is created either way).
const PROFILE_MAX_COMBINATIONS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EtsyInventoryPropertyValue {
  property_id: number;
  value_ids: number[];
  values: string[];
  scale_id: number | null;
}

export interface EtsyInventoryOffering {
  price: number;
  quantity: number;
  is_enabled: boolean;
  readiness_state_id?: number;
}

export interface EtsyInventoryProduct {
  sku: string;
  property_values: EtsyInventoryPropertyValue[];
  offerings: EtsyInventoryOffering[];
}

export interface EtsyInventoryPayload {
  products: EtsyInventoryProduct[];
  price_on_property: number[];
  quantity_on_property: number[];
  sku_on_property: number[];
}

export interface BuildInventoryInput {
  baseSku: string;
  price: number;
  quantityPerVariation: number;
  variation1PropertyId: number;
  variation1Name: string;
  variation1Values: string[];
  variation2PropertyId: number;
  variation2Name: string;
  variation2Values: string[];
  readinessStateId?: number;
}

export type BuildInventoryResult =
  | { ok: true; payload: EtsyInventoryPayload; combinationCount: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseVariationOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildSkuForVariation(
  baseSku: string,
  option1: string,
  option2: string,
): string {
  // Sanitize options: replace spaces with hyphens, remove unsafe chars
  const safe1 = option1.replace(/\s+/g, "-").replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
  const safe2 = option2.replace(/\s+/g, "-").replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
  return `${baseSku}-${safe1}-${safe2}`;
}

export function buildDraftInventoryProducts(input: BuildInventoryInput): BuildInventoryResult {
  const { baseSku, price, quantityPerVariation, variation1PropertyId, variation1Values, variation2PropertyId, variation2Values, readinessStateId } = input;

  if (variation1Values.length === 0) {
    return { ok: false, error: "Variation 1 (Size) options are empty." };
  }
  if (variation2Values.length === 0) {
    return { ok: false, error: "Variation 2 (Color) options are empty." };
  }

  const combinationCount = variation1Values.length * variation2Values.length;
  if (combinationCount > MAX_COMBINATIONS) {
    return {
      ok: false,
      error: `Too many variation combinations (${combinationCount}). Max ${MAX_COMBINATIONS}. Reduce the number of Size or Color options.`,
    };
  }

  const normalizedPrice = Number(price.toFixed(2));
  const products: EtsyInventoryProduct[] = [];

  for (const v1 of variation1Values) {
    for (const v2 of variation2Values) {
      const sku = buildSkuForVariation(baseSku, v1, v2);
      products.push({
        sku,
        property_values: [
          {
            property_id: variation1PropertyId,
            value_ids: [],
            values: [v1],
            scale_id: null,
          },
          {
            property_id: variation2PropertyId,
            value_ids: [],
            values: [v2],
            scale_id: null,
          },
        ],
        offerings: [
          {
            price: normalizedPrice,
            quantity: quantityPerVariation,
            is_enabled: true,
            ...(readinessStateId ? { readiness_state_id: readinessStateId } : {}),
          },
        ],
      });
    }
  }

  return {
    ok: true,
    payload: {
      products,
      price_on_property: [],
      quantity_on_property: [],
      sku_on_property: [variation1PropertyId, variation2PropertyId],
    },
    combinationCount,
  };
}

// ---------------------------------------------------------------------------
// Named variation profile -> Etsy inventory payload
// ---------------------------------------------------------------------------

interface ProfileOffering {
  styleKey: string; styleLabel: string;
  colorKey: string; colorLabel: string;
  price: string; quantity: number; enabled: boolean;
}
interface ProfileCombo {
  styleKey: string; styleLabel: string;
  colorKey: string; colorLabel: string;
}
export interface ProfileForInventory {
  key: string;
  offerings: ProfileOffering[];
  disabledCombinations?: ProfileCombo[];
}

export interface BuildProfileInventoryInput {
  baseSku: string;
  stylePropertyId: number;   // variation 1 (reuses the Hub Variations property IDs)
  colorPropertyId: number;   // variation 2
  readinessStateId?: number;
}

// Build the FULL variation grid from a profile: one product per (style, color)
// combination — offered combos enabled with their tier price, unavailable combos
// present with is_enabled=false so Etsy renders the exact availability matrix.
// Quantity is uniform (so quantity_on_property stays []) and is_enabled carries
// availability; price varies by Style tier (price_on_property=[style]).
export function buildProfileInventoryProducts(
  profile: ProfileForInventory,
  input: BuildProfileInventoryInput,
): BuildInventoryResult {
  const { baseSku, stylePropertyId, colorPropertyId, readinessStateId } = input;

  if (!profile.offerings || profile.offerings.length === 0) {
    return { ok: false, error: `Variation profile "${profile.key}" has no offerings to apply.` };
  }
  if (!stylePropertyId || !colorPropertyId) {
    return { ok: false, error: "Variation property IDs are not configured (set them in the Hub Variations panel)." };
  }

  // Per-Style tier price + a uniform quantity, derived from the offered combos.
  const priceByStyle = new Map<string, string>();
  let uniformQuantity = 0;
  for (const o of profile.offerings) {
    if (!priceByStyle.has(o.styleKey)) priceByStyle.set(o.styleKey, o.price);
    uniformQuantity = Math.max(uniformQuantity, o.quantity);
  }
  if (uniformQuantity <= 0) uniformQuantity = 1;

  const disabled = profile.disabledCombinations ?? [];
  const combinationCount = profile.offerings.length + disabled.length;
  if (combinationCount > PROFILE_MAX_COMBINATIONS) {
    return { ok: false, error: `Profile "${profile.key}" has ${combinationCount} combinations (max ${PROFILE_MAX_COMBINATIONS}).` };
  }

  const products: EtsyInventoryProduct[] = [];
  const seenSku = new Set<string>();

  const push = (c: ProfileCombo, enabled: boolean) => {
    // Disabled combos have no price of their own; reuse the Style tier price so
    // Etsy accepts the offering (is_enabled=false makes it unpurchasable anyway).
    const price = priceByStyle.get(c.styleKey);
    if (!price) return; // a Style with no offered color — cannot price it; skip.
    const sku = buildSkuForVariation(baseSku, c.styleLabel, c.colorLabel);
    // buildSkuForVariation can collide if two labels sanitize equal; keep unique.
    let uniqueSku = sku;
    let n = 2;
    while (seenSku.has(uniqueSku)) uniqueSku = `${sku}-${n++}`;
    seenSku.add(uniqueSku);
    products.push({
      sku: uniqueSku,
      property_values: [
        { property_id: stylePropertyId, value_ids: [], values: [c.styleLabel], scale_id: null },
        { property_id: colorPropertyId, value_ids: [], values: [c.colorLabel], scale_id: null },
      ],
      offerings: [{
        price: Number(Number(price).toFixed(2)),
        quantity: uniformQuantity,
        is_enabled: enabled,
        ...(readinessStateId ? { readiness_state_id: readinessStateId } : {}),
      }],
    });
  };

  for (const o of profile.offerings) push(o, true);
  for (const c of disabled) push(c, false);

  return {
    ok: true,
    payload: {
      products,
      price_on_property: [stylePropertyId], // price varies by Style tier
      quantity_on_property: [],             // uniform quantity
      sku_on_property: [stylePropertyId, colorPropertyId],
    },
    combinationCount,
  };
}
