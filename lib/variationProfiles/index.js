// ---------------------------------------------------------------------------
// Variation profiles registry (Hub-owned, canonical).
//
// Two named profiles describe a design's variation/fulfillment configuration:
//   * front_sided  — fully defined from Variations.pdf  (frontSidedSource.js)
//   * double_sided — fully defined from Variations.docx (doubleSidedSource.js)
//
// Both are built by the SAME expansion (buildProfileFromSource) so they cannot
// drift structurally; only their compact source tables (prices, offered colors)
// differ. A design tagged double_sided must NOT fall back to front_sided
// pricing — Batchly resolves each profile independently and fails validation
// before any Etsy write if a profile is missing/incomplete.
//
// All stores share these profiles — they describe the artwork/fulfillment of a
// design, not a per-store price book. Preply tags each design with a profile
// key; Batchly resolves the key here (via the Hub sync) and applies the matrix.
//
// The build output is a plain, JSON-serializable object so it travels unchanged
// through the Hub config-sync payload and Batchly's consumer.
// ---------------------------------------------------------------------------

import * as frontSided from "./frontSidedSource.js";
import * as doubleSided from "./doubleSidedSource.js";

export const PROFILE_KEYS = Object.freeze({
  FRONT_SIDED: "front_sided",
  DOUBLE_SIDED: "double_sided",
});

// The stable default for any design/preset/manifest that does not specify a
// profile — every listing produced before this feature was front-only.
export const DEFAULT_PROFILE_KEY = PROFILE_KEYS.FRONT_SIDED;

function styleOptionLabel(family, size) {
  // Baby uses "Baby Size <range>"; all others use "<product>- <size>".
  return family.labelPattern === "baby"
    ? `Baby Size ${size.label}`
    : `${family.product}- ${size.label}`;
}

function styleOptionKey(family, size) {
  return `${family.key}__${size.key}`;
}

// Expand a compact source module into the full profile: every Style option,
// every color, and one offering per OFFERED (style, color) pair with its price +
// quantity. Disabled combinations are represented by their absence from
// `offerings` (and captured in `disabledCombinations` for explicit assertions).
// Both front_sided and double_sided share this — same structure, different
// source tables — so the two matrices cannot drift apart structurally.
function buildProfileFromSource(source) {
  const key = source.PROFILE_KEY;
  const colorByKey = new Map(source.COLORS.map((c) => [c.key, c]));

  const styleOptions = [];
  const offerings = [];
  const disabledCombinations = [];

  for (const family of source.PRODUCT_FAMILIES) {
    const offered = new Set(family.offeredColors);
    for (const colorKey of offered) {
      if (!colorByKey.has(colorKey)) {
        throw new Error(`${key}: family ${family.key} offers unknown color "${colorKey}"`);
      }
    }
    for (const size of family.sizes) {
      const styleKey = styleOptionKey(family, size);
      const styleLabel = styleOptionLabel(family, size);
      styleOptions.push({ key: styleKey, label: styleLabel, family: family.key, size: size.key });

      for (const color of source.COLORS) {
        const combo = { styleKey, styleLabel, colorKey: color.key, colorLabel: color.label };
        if (offered.has(color.key)) {
          offerings.push({
            ...combo,
            price: size.price,
            quantity: source.DEFAULT_QUANTITY,
            enabled: true,
          });
        } else {
          disabledCombinations.push(combo);
        }
      }
    }
  }

  const profile = {
    key,
    label: source.PROFILE_LABEL,
    version: source.PROFILE_VERSION,
    status: "complete",
    variation1: { name: source.VARIATION_1_NAME, options: styleOptions },
    variation2: { name: source.VARIATION_2_NAME, options: source.COLORS },
    offerings,
    disabledCombinations,
    anomalies: source.SOURCE_ANOMALIES,
  };

  assertProfileShape(profile, source.EXPECTED);
  return profile;
}

function assertProfileShape(profile, EXPECTED) {
  const key = profile.key;
  const styleCount = profile.variation1.options.length;
  const colorCount = profile.variation2.options.length;
  const total = styleCount * colorCount;
  const offered = profile.offerings.length;
  if (styleCount !== EXPECTED.styleOptions) {
    throw new Error(`${key}: expected ${EXPECTED.styleOptions} style options, built ${styleCount}`);
  }
  if (colorCount !== EXPECTED.colors) {
    throw new Error(`${key}: expected ${EXPECTED.colors} colors, built ${colorCount}`);
  }
  if (total !== EXPECTED.totalCombinations) {
    throw new Error(`${key}: expected ${EXPECTED.totalCombinations} combinations, built ${total}`);
  }
  if (offered !== EXPECTED.offeredCombinations) {
    throw new Error(`${key}: expected ${EXPECTED.offeredCombinations} offerings, built ${offered}`);
  }
  if (offered + profile.disabledCombinations.length !== total) {
    throw new Error(`${key}: offered + disabled must equal total combinations`);
  }
  for (const o of profile.offerings) {
    if (!/^\d+\.\d{2}$/.test(o.price)) throw new Error(`${key}: bad price ${o.price} for ${o.styleLabel}/${o.colorLabel}`);
    if (!Number.isInteger(o.quantity) || o.quantity <= 0) throw new Error(`${key}: bad quantity for ${o.styleLabel}/${o.colorLabel}`);
  }
}

let _cache = null;
function registry() {
  if (!_cache) {
    _cache = {
      [PROFILE_KEYS.FRONT_SIDED]: buildProfileFromSource(frontSided),
      [PROFILE_KEYS.DOUBLE_SIDED]: buildProfileFromSource(doubleSided),
    };
  }
  return _cache;
}

// Public API ----------------------------------------------------------------

export function listVariationProfiles() {
  const r = registry();
  return Object.values(r).map((p) => ({ key: p.key, label: p.label, version: p.version, status: p.status }));
}

export function getVariationProfile(key) {
  return registry()[key] || null;
}

export function isKnownProfileKey(key) {
  return Object.prototype.hasOwnProperty.call(registry(), key);
}

// A profile is usable for draft creation only when it is complete AND actually
// has offerings. Double-sided (pending, no offerings) fails this on purpose.
export function isProfileComplete(key) {
  const p = getVariationProfile(key);
  return Boolean(p && p.status === "complete" && p.offerings.length > 0);
}

// Everything the Hub needs to embed in the config-sync payload. Batchly consumes
// this verbatim — it never re-derives the matrix.
export function buildVariationProfilesPayload() {
  const r = registry();
  return {
    defaultProfileKey: DEFAULT_PROFILE_KEY,
    profiles: Object.values(r),
  };
}
