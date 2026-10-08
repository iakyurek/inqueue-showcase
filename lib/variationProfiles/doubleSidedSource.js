// ---------------------------------------------------------------------------
// Double-sided variation profile — CANONICAL SOURCE (derived from Variations.docx)
//
// This is the compact, auditable source table for the Double-sided profile. The
// shared builder in ./index.js expands it into the full 188-offering matrix
// (28 Style options x 14 Primary colors = 392 combinations, 188 offered) using
// the exact same expansion as Front-sided. Keeping the source as tiers +
// offered-color-sets — instead of 392 literal rows — is what makes it reviewable
// against the docx and maintainable.
//
// Extraction was verified row-by-row against the .docx (all 392 rows parsed).
// The rule the document encodes: a combination that shows a price + quantity is
// OFFERED (enabled); a combination that shows only its label with no
// price/quantity is a DISABLED (unavailable) combination.
//
// AVAILABILITY vs FRONT-SIDED: the offered/disabled grid is IDENTICAL to
// Front-sided — same offered color set per garment family, consistent across
// every size in the family. This was verified from the docx, not assumed. What
// differs is PRICING: the Double-sided tiers are materially higher (e.g. Unisex
// starts at $44.00 vs $34.99 front-sided), because double-sided printing costs
// more. Prices below come straight from the docx.
//
// Fourteen single-cell anomalies in the source listing were confirmed as
// live-listing artifacts and NORMALIZED for this new-listing template (the raw
// values are preserved in SOURCE_ANOMALIES below for traceability):
//   * 13 offered combinations showed quantity 998 or 997 -> 999 (all offered =
//     999). These are live-listing sale artifacts, same pattern as Front-sided.
//   * Baby 3-6 Months / Heather Mauve price $26.99 -> $42.00 (matches the Baby
//     double-sided tier; every other enabled Baby combo is $42.00).
//
// Human-facing option labels match the Front-sided canonical labels exactly, so
// the Style axis option values are character-identical between the two profiles
// (the docx had cosmetic hyphen-spacing drift like "Unisex T-shirt - S" vs
// "Unisex T-shirt- L"; only whitespace was normalized, never meaning).
// ---------------------------------------------------------------------------

export const PROFILE_KEY = "double_sided";
export const PROFILE_LABEL = "Double-sided design";
// Bump when the matrix meaning changes so downstream consumers can detect drift.
export const PROFILE_VERSION = 1;

export const VARIATION_1_NAME = "Style";
export const VARIATION_2_NAME = "Primary color";

export const DEFAULT_QUANTITY = 999;

// Variation 2 — the 14 Primary colors, in the docx's row order. `key` is the
// stable internal identifier; `label` is the human-facing Etsy option value.
// Same 14 colors and same order as Front-sided (verified against the docx).
export const COLORS = [
  { key: "black", label: "Black" },
  { key: "white", label: "White" },
  { key: "athletic_heather", label: "Athletic Heather" },
  { key: "dark_grey_heather", label: "Dark Grey Heather" },
  { key: "heather_maroon", label: "Heather Maroon" },
  { key: "heather_navy", label: "Heather Navy" },
  { key: "heather_mauve", label: "Heather Mauve" },
  { key: "heather_peach", label: "Heather Peach" },
  { key: "red", label: "Red" },
  { key: "heather_columbia_blue", label: "Heather Columbia Blue" },
  { key: "sport_grey", label: "Sport Grey" },
  { key: "military_green", label: "Military Green" },
  { key: "sand", label: "Sand" },
  { key: "light_blue", label: "Light Blue" },
];

// Variation 1 — product families. Each family lists its sizes with the offered
// DOUBLE-SIDED price per size, and the SET of colors offered for that family (by
// color key). The full variation-1 option label is "<product>- <size>" (Baby is
// labeled "Baby Size <range>"), matching Front-sided and how the docx/Etsy names
// the combined axis.
export const PRODUCT_FAMILIES = [
  {
    key: "unisex_tee",
    product: "Unisex T-shirt",
    sizes: [
      { key: "s", label: "S", price: "44.00" },
      { key: "m", label: "M", price: "44.00" },
      { key: "l", label: "L", price: "45.00" },
      { key: "xl", label: "XL", price: "46.00" },
      { key: "xxl", label: "XXL", price: "47.00" },
      { key: "xxxl", label: "XXXL", price: "48.00" },
    ],
    offeredColors: [
      "black", "white", "athletic_heather", "dark_grey_heather", "heather_maroon",
      "heather_navy", "heather_mauve", "heather_peach", "red", "heather_columbia_blue",
    ],
  },
  {
    key: "sweatshirt",
    product: "Sweatshirt",
    sizes: [
      { key: "s", label: "S", price: "61.00" },
      { key: "m", label: "M", price: "62.00" },
      { key: "l", label: "L", price: "63.00" },
      { key: "xl", label: "XL", price: "64.00" },
      { key: "xxl", label: "XXL", price: "65.00" },
      { key: "xxxl", label: "XXXL", price: "66.00" },
    ],
    offeredColors: ["black", "white", "red", "sport_grey", "military_green", "sand"],
  },
  {
    key: "hoodie",
    product: "Hoodie",
    sizes: [
      { key: "s", label: "S", price: "65.00" },
      { key: "m", label: "M", price: "65.00" },
      { key: "l", label: "L", price: "66.00" },
      { key: "xl", label: "XL", price: "67.00" },
      { key: "xxl", label: "XXL", price: "68.00" },
      { key: "xxxl", label: "XXXL", price: "69.00" },
    ],
    offeredColors: ["black", "white", "red", "sport_grey", "sand", "light_blue"],
  },
  {
    key: "youth_tee",
    product: "Youth T-shirt",
    sizes: [
      { key: "s", label: "S", price: "42.00" },
      { key: "m", label: "M", price: "42.00" },
      { key: "l", label: "L", price: "43.00" },
    ],
    offeredColors: [
      "black", "white", "athletic_heather", "heather_navy", "heather_mauve", "heather_columbia_blue",
    ],
  },
  {
    key: "toddler_tee",
    product: "Toddler T-shirt",
    sizes: [
      { key: "2t", label: "2T", price: "43.00" },
      { key: "3t", label: "3T", price: "43.00" },
      { key: "4t", label: "4T", price: "43.00" },
    ],
    offeredColors: [
      "black", "white", "athletic_heather", "dark_grey_heather", "heather_mauve", "heather_columbia_blue",
    ],
  },
  {
    key: "baby",
    product: "Baby",
    // Baby's variation-1 label is "Baby Size <range>" (no size letter).
    labelPattern: "baby",
    sizes: [
      { key: "3_6m", label: "3-6 Months", price: "42.00" },
      { key: "6_12m", label: "6-12 Months", price: "42.00" },
      { key: "12_18m", label: "12-18 Months", price: "42.00" },
      { key: "18_24m", label: "18-24 Months", price: "42.00" },
    ],
    offeredColors: ["black", "white", "athletic_heather", "heather_mauve", "heather_columbia_blue"],
  },
];

// Raw values from the source listing that were normalized above. Kept for audit
// only — the builder does NOT read these; it uses the (already-normalized)
// tables above. This documents exactly what was changed and why. Each `row` is
// the "Variation row number" from the docx.
export const SOURCE_ANOMALIES = [
  // --- Quantity artifacts: 998/997 -> 999 (confirmed: normalize) --------------
  { row: 2,   combo: "Unisex T-shirt- S / White",                  field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 15,  combo: "Unisex T-shirt- M / Black",                  field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 29,  combo: "Unisex T-shirt- L / Black",                  field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 43,  combo: "Unisex T-shirt- XL / Black",                 field: "quantity", rawValue: 997, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 44,  combo: "Unisex T-shirt- XL / White",                 field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 48,  combo: "Unisex T-shirt- XL / Heather Navy",          field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 52,  combo: "Unisex T-shirt- XL / Heather Columbia Blue", field: "quantity", rawValue: 997, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 95,  combo: "Sweatshirt- S / Sport Grey",                 field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 99,  combo: "Sweatshirt- M / Black",                      field: "quantity", rawValue: 997, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 111, combo: "Sweatshirt- M / Sand",                       field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 124, combo: "Sweatshirt- L / Military Green",             field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 141, combo: "Sweatshirt- XXL / Black",                    field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  { row: 210, combo: "Hoodie- L / Light Blue",                     field: "quantity", rawValue: 998, normalizedTo: 999, reason: "Live-listing sale artifact; all offered quantities are 999." },
  // --- Isolated price outlier: $26.99 -> $42.00 (confirmed: normalize) --------
  { row: 343, combo: "Baby Size 3-6 Months / Heather Mauve",       field: "price", rawValue: "26.99", normalizedTo: "42.00", reason: "Every other enabled Baby combination is $42.00; $26.99 is an accidental/leftover price. Confirmed: normalize to the Baby double-sided tier." },
];

// Sanity constants the tests and builder assert against, so a careless edit to
// the tables above fails loudly instead of silently changing production prices.
export const EXPECTED = {
  totalCombinations: 392, // 28 Style options x 14 colors
  offeredCombinations: 188,
  styleOptions: 28,
  colors: 14,
};
