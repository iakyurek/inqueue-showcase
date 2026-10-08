/**
 * buildProfileInventoryProducts — Etsy inventory payload for the front_sided
 * matrix. Uses the REAL hub profile (imported from lib/variationProfiles) so the
 * payload is pinned against the canonical 392-combination matrix. No DB, no Etsy.
 * Run: npx tsx scripts/test-profile-inventory.ts
 */
import assert from "node:assert/strict";
import { buildProfileInventoryProducts } from "../src/lib/services/inventoryHelpers";
// The hub is the source of the matrix; import its built profile directly.
import { getVariationProfile } from "../../lib/variationProfiles/index.js";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).message}`); }
}

const STYLE_PROP = 100;
const COLOR_PROP = 200;
const front = getVariationProfile("front_sided") as {
  key: string;
  offerings: { styleLabel: string; colorLabel: string; price: string; quantity: number; enabled: boolean }[];
  disabledCombinations: unknown[];
};

const result = buildProfileInventoryProducts(
  { key: front.key, offerings: front.offerings as never, disabledCombinations: front.disabledCombinations as never },
  { baseSku: "CU17", stylePropertyId: STYLE_PROP, colorPropertyId: COLOR_PROP, readinessStateId: 123 },
);
if (!result.ok) { console.error("build failed:", result.error); process.exit(1); }
const payload = result.payload;
const products = payload.products;
type P = (typeof products)[number];
const find = (style: string, color: string): P | undefined =>
  products.find((p) => p.property_values[0].values[0] === style && p.property_values[1].values[0] === color);

console.log("profile inventory payload tests");

test("full grid: 392 products (188 enabled + 204 disabled)", () => {
  assert.equal(products.length, 392);
  assert.equal(result.combinationCount, 392);
  assert.equal(products.filter((p) => p.offerings[0].is_enabled).length, 188);
  assert.equal(products.filter((p) => !p.offerings[0].is_enabled).length, 204);
});

test("Etsy requires every combination present — offered + disabled both included", () => {
  assert.ok(find("Unisex T-shirt- S", "Black")?.offerings[0].is_enabled, "offered enabled");
  const off = find("Unisex T-shirt- S", "Sport Grey"); // disabled for unisex
  assert.ok(off, "disabled combo must still be a product");
  assert.equal(off!.offerings[0].is_enabled, false);
});

test("price varies by Style tier; price_on_property=[style]", () => {
  assert.deepEqual(payload.price_on_property, [STYLE_PROP]);
  assert.equal(find("Unisex T-shirt- S", "Black")!.offerings[0].price, 34.99);
  assert.equal(find("Unisex T-shirt- L", "Black")!.offerings[0].price, 35.49);
  assert.equal(find("Unisex T-shirt- XXXL", "Black")!.offerings[0].price, 37.99);
  assert.equal(find("Hoodie- XXXL", "Black")!.offerings[0].price, 61.99);
});

test("disabled combos carry their Style tier price so Etsy accepts the offering", () => {
  const disabled = find("Unisex T-shirt- S", "Sand")!; // disabled, unisex S tier 34.99
  assert.equal(disabled.offerings[0].is_enabled, false);
  assert.equal(disabled.offerings[0].price, 34.99);
  assert.ok(disabled.offerings[0].price > 0);
});

test("quantity is uniform 999 everywhere; quantity_on_property=[]", () => {
  assert.deepEqual(payload.quantity_on_property, []);
  for (const p of products) assert.equal(p.offerings[0].quantity, 999);
});

test("every product carries the readiness_state_id and both property axes", () => {
  for (const p of products) {
    assert.equal(p.offerings[0].readiness_state_id, 123);
    assert.equal(p.property_values[0].property_id, STYLE_PROP);
    assert.equal(p.property_values[1].property_id, COLOR_PROP);
  }
});

test("SKUs are unique per combination and derived from the base SKU", () => {
  const skus = products.map((p) => p.sku);
  assert.equal(new Set(skus).size, skus.length, "all SKUs unique");
  assert.ok(skus.every((s) => s.startsWith("CU17-")), "SKUs derive from base");
  assert.deepEqual(payload.sku_on_property, [STYLE_PROP, COLOR_PROP]);
});

test("missing property IDs is a clean error, not a bad payload", () => {
  const bad = buildProfileInventoryProducts(
    { key: front.key, offerings: front.offerings as never, disabledCombinations: front.disabledCombinations as never },
    { baseSku: "CU17", stylePropertyId: 0, colorPropertyId: 0 },
  );
  assert.equal(bad.ok, false);
});

// --- Double-sided matrix maps to a valid payload with its OWN (higher) prices --
const dsProfile = getVariationProfile("double_sided") as typeof front;
const dsResult = buildProfileInventoryProducts(
  { key: dsProfile.key, offerings: dsProfile.offerings as never, disabledCombinations: dsProfile.disabledCombinations as never },
  { baseSku: "CU42", stylePropertyId: STYLE_PROP, colorPropertyId: COLOR_PROP, readinessStateId: 123 },
);
if (!dsResult.ok) { console.error("DS build failed:", dsResult.error); process.exit(1); }
const dsProducts = dsResult.payload.products;
const dsFind = (style: string, color: string) =>
  dsProducts.find((p) => p.property_values[0].values[0] === style && p.property_values[1].values[0] === color);

test("double_sided: 392 products (188 enabled + 204 disabled), DS price tiers", () => {
  assert.equal(dsProducts.length, 392);
  assert.equal(dsProducts.filter((p) => p.offerings[0].is_enabled).length, 188);
  assert.equal(dsFind("Unisex T-shirt- S", "Black")!.offerings[0].price, 44.0);
  assert.equal(dsFind("Hoodie- XXXL", "Black")!.offerings[0].price, 69.0);
  assert.equal(dsFind("Baby Size 3-6 Months", "Heather Mauve")!.offerings[0].price, 42.0);
  for (const p of dsProducts) assert.equal(p.offerings[0].quantity, 999);
});

test("double_sided SKUs unique and derived from its own base SKU", () => {
  const skus = dsProducts.map((p) => p.sku);
  assert.equal(new Set(skus).size, skus.length);
  assert.ok(skus.every((s) => s.startsWith("CU42-")));
});

console.log("");
if (failed) { console.error(`profile inventory payload tests: FAILED (${failed})`); process.exit(1); }
console.log("profile inventory payload tests: OK");
