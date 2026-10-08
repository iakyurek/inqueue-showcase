// Unit tests for the canonical variation profiles.
// Run: node lib/variationProfiles/variation-profiles.test.mjs
import assert from "node:assert/strict";
import {
  getVariationProfile,
  isKnownProfileKey,
  isProfileComplete,
  listVariationProfiles,
  buildVariationProfilesPayload,
  DEFAULT_PROFILE_KEY,
  PROFILE_KEYS,
} from "./index.js";

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

console.log("variation profiles tests");

const front = getVariationProfile(PROFILE_KEYS.FRONT_SIDED);

function offer(styleLabel, colorLabel) {
  return front.offerings.find((o) => o.styleLabel === styleLabel && o.colorLabel === colorLabel) || null;
}
function isOffered(styleLabel, colorLabel) { return Boolean(offer(styleLabel, colorLabel)); }

test("front_sided has exactly 28 Style options, 14 colors, 392 combos, 188 offerings", () => {
  assert.equal(front.variation1.options.length, 28);
  assert.equal(front.variation2.options.length, 14);
  assert.equal(front.offerings.length, 188);
  assert.equal(front.offerings.length + front.disabledCombinations.length, 392);
  assert.equal(front.status, "complete");
});

test("front_sided offered counts per product family match the PDF", () => {
  const count = (prefix) => front.offerings.filter((o) => o.styleLabel.startsWith(prefix)).length;
  assert.equal(count("Unisex T-shirt-"), 60); // 10 colors x 6 sizes
  assert.equal(count("Sweatshirt-"), 36);     // 6 x 6
  assert.equal(count("Hoodie-"), 36);         // 6 x 6
  assert.equal(count("Youth T-shirt-"), 18);  // 6 x 3
  assert.equal(count("Toddler T-shirt-"), 18);// 6 x 3
  assert.equal(count("Baby Size"), 20);       // 5 x 4
});

test("front_sided price tiers by size are exact", () => {
  assert.equal(offer("Unisex T-shirt- S", "Black").price, "34.99");
  assert.equal(offer("Unisex T-shirt- L", "Black").price, "35.49");
  assert.equal(offer("Unisex T-shirt- XXXL", "Black").price, "37.99");
  assert.equal(offer("Sweatshirt- S", "Black").price, "53.99");
  assert.equal(offer("Sweatshirt- XXXL", "Black").price, "58.99");
  assert.equal(offer("Hoodie- S", "Black").price, "57.99");
  assert.equal(offer("Hoodie- M", "Black").price, "57.99");
  assert.equal(offer("Hoodie- XXXL", "Black").price, "61.99");
  assert.equal(offer("Youth T-shirt- L", "Black").price, "35.99");
  assert.equal(offer("Toddler T-shirt- 2T", "Black").price, "35.99");
});

test("front_sided every offered combination has quantity 999 (998 anomaly normalized)", () => {
  for (const o of front.offerings) assert.equal(o.quantity, 999, `${o.styleLabel}/${o.colorLabel}`);
  // The specific row that showed 998 in the PDF is present and normalized.
  assert.equal(offer("Unisex T-shirt- M", "Heather Mauve").quantity, 999);
});

test("front_sided Baby 3-6 Black price is normalized to 34.99 (18.99 anomaly)", () => {
  assert.equal(offer("Baby Size 3-6 Months", "Black").price, "34.99");
  assert.equal(offer("Baby Size 6-12 Months", "Black").price, "34.99");
});

test("front_sided the confirmed anomalies are recorded for audit", () => {
  const qty = front.anomalies.find((a) => a.field === "quantity");
  const price = front.anomalies.find((a) => a.field === "price");
  assert.equal(qty.rawValue, 998);
  assert.equal(qty.normalizedTo, 999);
  assert.equal(price.rawValue, "18.99");
  assert.equal(price.normalizedTo, "34.99");
});

test("front_sided disabled combinations stay disabled", () => {
  // Unisex offers 10 colors; these four are never offered.
  for (const color of ["Sport Grey", "Military Green", "Sand", "Light Blue"]) {
    assert.equal(isOffered("Unisex T-shirt- S", color), false, `Unisex S ${color}`);
  }
  // Sweatshirt offers Military Green but not Light Blue; Hoodie the reverse.
  assert.equal(isOffered("Sweatshirt- S", "Military Green"), true);
  assert.equal(isOffered("Sweatshirt- S", "Light Blue"), false);
  assert.equal(isOffered("Hoodie- S", "Light Blue"), true);
  assert.equal(isOffered("Hoodie- S", "Military Green"), false);
  // Baby offers only 5 colors.
  assert.equal(isOffered("Baby Size 3-6 Months", "Heather Navy"), false);
  assert.equal(isOffered("Baby Size 3-6 Months", "Athletic Heather"), true);
  // Youth offers Heather Navy; Toddler offers Dark Grey Heather instead.
  assert.equal(isOffered("Youth T-shirt- S", "Heather Navy"), true);
  assert.equal(isOffered("Youth T-shirt- S", "Dark Grey Heather"), false);
  assert.equal(isOffered("Toddler T-shirt- 2T", "Dark Grey Heather"), true);
  assert.equal(isOffered("Toddler T-shirt- 2T", "Heather Navy"), false);
});

test("registry: known keys, default, and completeness gates", () => {
  assert.equal(isKnownProfileKey("front_sided"), true);
  assert.equal(isKnownProfileKey("double_sided"), true);
  assert.equal(isKnownProfileKey("triple_sided"), false);
  assert.equal(DEFAULT_PROFILE_KEY, "front_sided");
  assert.equal(isProfileComplete("front_sided"), true);
  // Double-sided now has a verified matrix — it is complete and usable.
  assert.equal(isProfileComplete("double_sided"), true);
  assert.equal(isProfileComplete("nonexistent"), false);
});

// --- Double-sided canonical matrix (from Variations.docx) -------------------

const ds = getVariationProfile(PROFILE_KEYS.DOUBLE_SIDED);
function dsOffer(styleLabel, colorLabel) {
  return ds.offerings.find((o) => o.styleLabel === styleLabel && o.colorLabel === colorLabel) || null;
}
function dsOffered(styleLabel, colorLabel) { return Boolean(dsOffer(styleLabel, colorLabel)); }

test("double_sided has exactly 28 Style options, 14 colors, 392 combos, 188 offerings", () => {
  assert.equal(ds.status, "complete");
  assert.equal(ds.variation1.options.length, 28);
  assert.equal(ds.variation2.options.length, 14);
  assert.equal(ds.offerings.length, 188);
  assert.equal(ds.offerings.length + ds.disabledCombinations.length, 392);
});

test("double_sided offered counts per product family match the docx", () => {
  const count = (prefix) => ds.offerings.filter((o) => o.styleLabel.startsWith(prefix)).length;
  assert.equal(count("Unisex T-shirt-"), 60); // 10 colors x 6 sizes
  assert.equal(count("Sweatshirt-"), 36);     // 6 x 6
  assert.equal(count("Hoodie-"), 36);         // 6 x 6
  assert.equal(count("Youth T-shirt-"), 18);  // 6 x 3
  assert.equal(count("Toddler T-shirt-"), 18);// 6 x 3
  assert.equal(count("Baby Size"), 20);       // 5 x 4
});

test("double_sided availability grid is identical to front_sided", () => {
  // Every offered/disabled (style,color) pair must match front_sided exactly —
  // only pricing differs between the two profiles.
  const key = (o) => `${o.styleLabel}||${o.colorLabel}`;
  const frontOffered = new Set(front.offerings.map(key));
  const dsOfferedSet = new Set(ds.offerings.map(key));
  assert.equal(dsOfferedSet.size, frontOffered.size);
  for (const k of frontOffered) assert.ok(dsOfferedSet.has(k), `DS missing offered ${k}`);
});

test("double_sided price tiers by size are exact (higher than front_sided)", () => {
  assert.equal(dsOffer("Unisex T-shirt- S", "Black").price, "44.00");
  assert.equal(dsOffer("Unisex T-shirt- M", "Black").price, "44.00");
  assert.equal(dsOffer("Unisex T-shirt- L", "Black").price, "45.00");
  assert.equal(dsOffer("Unisex T-shirt- XL", "Black").price, "46.00");
  assert.equal(dsOffer("Unisex T-shirt- XXL", "Black").price, "47.00");
  assert.equal(dsOffer("Unisex T-shirt- XXXL", "Black").price, "48.00");
  assert.equal(dsOffer("Sweatshirt- S", "Black").price, "61.00");
  assert.equal(dsOffer("Sweatshirt- XXXL", "Black").price, "66.00");
  assert.equal(dsOffer("Hoodie- S", "Black").price, "65.00");
  assert.equal(dsOffer("Hoodie- M", "Black").price, "65.00");
  assert.equal(dsOffer("Hoodie- XXXL", "Black").price, "69.00");
  assert.equal(dsOffer("Youth T-shirt- S", "Black").price, "42.00");
  assert.equal(dsOffer("Youth T-shirt- L", "Black").price, "43.00");
  assert.equal(dsOffer("Toddler T-shirt- 2T", "Black").price, "43.00");
  assert.equal(dsOffer("Baby Size 6-12 Months", "Black").price, "42.00");
});

test("double_sided every offered combination has quantity 999 (997/998 anomalies normalized)", () => {
  for (const o of ds.offerings) assert.equal(o.quantity, 999, `${o.styleLabel}/${o.colorLabel}`);
  // Specific rows that showed 998/997 in the docx are present and normalized.
  assert.equal(dsOffer("Unisex T-shirt- XL", "Black").quantity, 999);       // was 997
  assert.equal(dsOffer("Sweatshirt- M", "Black").quantity, 999);            // was 997
  assert.equal(dsOffer("Hoodie- L", "Light Blue").quantity, 999);           // was 998
});

test("double_sided Baby 3-6 Heather Mauve price is normalized to 42.00 (26.99 anomaly)", () => {
  assert.equal(dsOffer("Baby Size 3-6 Months", "Heather Mauve").price, "42.00");
  assert.equal(dsOffer("Baby Size 3-6 Months", "Black").price, "42.00");
});

test("double_sided records all confirmed anomalies for audit (13 qty + 1 price)", () => {
  const qty = ds.anomalies.filter((a) => a.field === "quantity");
  const price = ds.anomalies.filter((a) => a.field === "price");
  assert.equal(qty.length, 13);
  assert.equal(price.length, 1);
  assert.ok(qty.every((a) => a.normalizedTo === 999 && (a.rawValue === 998 || a.rawValue === 997)));
  assert.equal(price[0].rawValue, "26.99");
  assert.equal(price[0].normalizedTo, "42.00");
});

test("double_sided disabled combinations stay disabled (same as front_sided)", () => {
  for (const color of ["Sport Grey", "Military Green", "Sand", "Light Blue"]) {
    assert.equal(dsOffered("Unisex T-shirt- S", color), false, `Unisex S ${color}`);
  }
  assert.equal(dsOffered("Sweatshirt- S", "Military Green"), true);
  assert.equal(dsOffered("Sweatshirt- S", "Light Blue"), false);
  assert.equal(dsOffered("Hoodie- S", "Light Blue"), true);
  assert.equal(dsOffered("Hoodie- S", "Military Green"), false);
  assert.equal(dsOffered("Baby Size 3-6 Months", "Heather Navy"), false);
  assert.equal(dsOffered("Baby Size 3-6 Months", "Athletic Heather"), true);
});

test("sync payload carries both profiles and the default", () => {
  const payload = buildVariationProfilesPayload();
  assert.equal(payload.defaultProfileKey, "front_sided");
  const keys = payload.profiles.map((p) => p.key).sort();
  assert.deepEqual(keys, ["double_sided", "front_sided"]);
  assert.deepEqual(listVariationProfiles().map((p) => p.key).sort(), ["double_sided", "front_sided"]);
});

console.log("");
if (failed) { console.error(`variation profiles tests: FAILED (${failed})`); process.exit(1); }
console.log("variation profiles tests: OK");
