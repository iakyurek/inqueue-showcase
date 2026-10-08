// ---------------------------------------------------------------------------
// Front-sided variation profile — CANONICAL SOURCE (derived from Variations.pdf)
//
// This is the compact, auditable source table for the Front-sided profile. The
// builder in ./index.js expands it into the full 188-offering matrix (28 Style
// options x 14 Primary colors = 392 combinations, 188 offered). Keeping the
// source as tiers + offered-color-sets — instead of 392 literal rows — is what
// makes it reviewable against the PDF and maintainable.
//
// Extraction was verified page-by-page against the rendered PDF. The rule the
// PDF encodes: a combination that shows a price + quantity is OFFERED (enabled);
// a combination that shows only its label with no price/quantity is a DISABLED
// (unavailable) combination. That availability genuinely differs per garment.
//
// Two single-cell anomalies in the source listing were confirmed as
// live-listing artifacts and NORMALIZED for this new-listing template (the raw
// values are preserved in SOURCE_ANOMALIES below for traceability):
//   * Unisex Tee / M / Heather Mauve quantity 998 -> 999 (all offered = 999).
//   * Baby 3-6 Months / Black price $18.99 -> $34.99 (matches the Baby tier).
//
// Human-facing option labels are preserved. The axis DISPLAY names ("Style",
// "Primary color") are not spelled out in the PDF; "Primary color" is the term
// used for variation 2, and "Style" is our label for the combined product/size
// axis (variation 1). Only the axis names are our choice — every option value
// and the offered/price/quantity matrix come straight from the PDF.
// ---------------------------------------------------------------------------

export const PROFILE_KEY = "front_sided";
export const PROFILE_LABEL = "Front-sided design";
// Bump when the matrix meaning changes so downstream consumers can detect drift.
export const PROFILE_VERSION = 1;

export const VARIATION_1_NAME = "Style";
export const VARIATION_2_NAME = "Primary color";

export const DEFAULT_QUANTITY = 999;

// Variation 2 — the 14 Primary colors, in the PDF's row order. `key` is the
// stable internal identifier; `label` is the human-facing Etsy option value.
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
// price per size, and the SET of colors offered for that family (by color key).
// The full variation-1 option label is "<product>- <size>" (Baby is labeled
// "Baby Size <range>"), matching how the PDF/Etsy names the combined axis.
export const PRODUCT_FAMILIES = [
  {
    key: "unisex_tee",
    product: "Unisex T-shirt",
    // label pattern: "Unisex T-shirt- S"
    sizes: [
      { key: "s", label: "S", price: "34.99" },
      { key: "m", label: "M", price: "34.99" },
      { key: "l", label: "L", price: "35.49" },
      { key: "xl", label: "XL", price: "35.99" },
      { key: "xxl", label: "XXL", price: "36.99" },
      { key: "xxxl", label: "XXXL", price: "37.99" },
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
      { key: "s", label: "S", price: "53.99" },
      { key: "m", label: "M", price: "54.99" },
      { key: "l", label: "L", price: "55.99" },
      { key: "xl", label: "XL", price: "56.99" },
      { key: "xxl", label: "XXL", price: "57.99" },
      { key: "xxxl", label: "XXXL", price: "58.99" },
    ],
    offeredColors: ["black", "white", "red", "sport_grey", "military_green", "sand"],
  },
  {
    key: "hoodie",
    product: "Hoodie",
    sizes: [
      { key: "s", label: "S", price: "57.99" },
      { key: "m", label: "M", price: "57.99" },
      { key: "l", label: "L", price: "58.99" },
      { key: "xl", label: "XL", price: "59.99" },
      { key: "xxl", label: "XXL", price: "60.99" },
      { key: "xxxl", label: "XXXL", price: "61.99" },
    ],
    offeredColors: ["black", "white", "red", "sport_grey", "sand", "light_blue"],
  },
  {
    key: "youth_tee",
    product: "Youth T-shirt",
    sizes: [
      { key: "s", label: "S", price: "34.99" },
      { key: "m", label: "M", price: "34.99" },
      { key: "l", label: "L", price: "35.99" },
    ],
    offeredColors: [
      "black", "white", "athletic_heather", "heather_navy", "heather_mauve", "heather_columbia_blue",
    ],
  },
  {
    key: "toddler_tee",
    product: "Toddler T-shirt",
    sizes: [
      { key: "2t", label: "2T", price: "35.99" },
      { key: "3t", label: "3T", price: "35.99" },
      { key: "4t", label: "4T", price: "35.99" },
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
      { key: "3_6m", label: "3-6 Months", price: "34.99" },
      { key: "6_12m", label: "6-12 Months", price: "34.99" },
      { key: "12_18m", label: "12-18 Months", price: "34.99" },
      { key: "18_24m", label: "18-24 Months", price: "34.99" },
    ],
    offeredColors: ["black", "white", "athletic_heather", "heather_mauve", "heather_columbia_blue"],
  },
];

// Raw values from the source listing that were normalized above. Kept for audit
// only — the builder does NOT read these; it uses the (already-normalized)
// tables above. This documents exactly what was changed and why.
export const SOURCE_ANOMALIES = [
  {
    row: 21,
    combo: "Unisex T-shirt- M / Heather Mauve",
    field: "quantity",
    rawValue: 998,
    normalizedTo: 999,
    reason: "Every other offered combination shows 999; 998 is a live-listing sale artifact. Confirmed: normalize.",
  },
  {
    row: 337,
    combo: "Baby Size 3-6 Months / Black",
    field: "price",
    rawValue: "18.99",
    normalizedTo: "34.99",
    reason: "Every other Baby combination (incl. 6-12 Months Black) is $34.99; $18.99 is an accidental/leftover price. Confirmed: normalize.",
  },
];

// Sanity constants the tests and builder assert against, so a careless edit to
// the tables above fails loudly instead of silently changing production prices.
export const EXPECTED = {
  totalCombinations: 392, // 28 Style options x 14 colors
  offeredCombinations: 188,
  styleOptions: 28,
  colors: 14,
};
