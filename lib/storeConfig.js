// Store Configuration — pure domain logic shared by both storage adapters
// (lib/db.js) and the hub API routes (server.js). No I/O in this module.
//
// Slots are fixed: Store_A..Store_F. The slot string doubles as the join key
// across the whole suite (Preply `store_folder`, Batchly `driveFolderName`).

import { buildVariationProfilesPayload } from './variationProfiles/index.js';

export const SLOTS = ['Store_A', 'Store_B', 'Store_C', 'Store_D', 'Store_E', 'Store_F'];
export const SLOT_RE = /^Store_[A-F]$/;
export const SKU_PREFIX_RE = /^[A-Z]{1,6}$/;
export const DRIVE_FOLDER_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

export const SKU_PREFIX_SOURCES = ['unset', 'manual', 'inferred_confirmed'];
export const DRIVE_TEST_STATUSES = ['untested', 'ok', 'failed'];

// Etsy enums the draft path actually consumes (mirrors Batchly's validation).
export const WHO_MADE_VALUES = ['i_did', 'someone_else', 'collective'];
export const WHEN_MADE_VALUES = [
  'made_to_order', '2020_2026', '2010_2019', '2007_2009', 'before_2007',
  '2000_2006', '1990s', '1980s', '1970s', '1960s', '1950s', '1940s',
  '1930s', '1920s', '1910s', '1900s', '1800s', '1700s', 'before_1700',
];
export const LISTING_TYPES = ['physical', 'download', 'both'];
export const RENEWAL_OPTIONS = ['automatic', 'manual'];

// Canonical description body for every Etsy draft. The draft builder prepends
// the listing's actual design title + a blank line (Batchly's
// buildListingDescription: `${title}\n\n${template}`), so this constant is
// everything AFTER the `<Design Title>` line in the shop's approved template —
// the design title itself stays per-listing and is never baked in here.
// Editable per shop in the hub Configure → Draft presets panel; this is only
// the out-of-the-box baseline used when the stored template is blank.
export const DEFAULT_DESCRIPTION_TEMPLATE = `ORDERING:
1. Review all photos
2. Choose Size and Color from drop-down menu
3. If personalization box is available, add your text color
4. Add each shirt to cart one at a time
5. Click "Add to Cart" - you can go back to add more products
6. Click "Proceed to Checkout"
7. Add note to seller for any requests

BULK DISCOUNTS AND SPECIAL REQUESTS:
We offer bulk discounts and are open to special requests. Please feel free to direct message us with any inquiries.
CARE INSTRUCTIONS:
Wash inside out, gentle cycle, cold water, tumble dry low, medium iron.
PRODUCTION AND SHIPPING:
Processing time is next day. First Class Shipping is 2-5 business days (after processing time).
If you need an item sooner, upgrade shipping at checkout.
Shipping will automatically combine for multiple orders. Please check color and quantity before checking out.
RETURN POLICY:
We do not accept returns for shirts unless there is a product quality issue. Due to our print-on-demand business model, we cannot accept returns for any other reason. Thank you for understanding.
Thank you for choosing our shop. Our top priority is your satisfaction.`;

export function isValidSlot(slot) {
  return typeof slot === 'string' && SLOT_RE.test(slot);
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultStore(slot) {
  return {
    slot,
    displayName: '',
    enabled: false,
    skuPrefix: '',
    skuPrefixSource: 'unset',
    driveFolderId: '',
    driveTestStatus: 'untested',
    driveTestDetail: null,
    driveTestedAt: null,
    etsyShopId: null,
    etsyShopName: null,
    etsyConnected: false,
    etsyStatusCheckedAt: null,
    etsyIds: {
      taxonomyId: null,
      shippingProfileId: null,
      readinessStateId: null,
      returnPolicyId: null,
      sectionId: null,
    },
    notes: '',
    rowVersion: 1,
    createdAt: null,
    updatedAt: null,
  };
}

// Defaults mirror Batchly's Global*Preset model defaults so a fresh hub and a
// fresh Batchly agree before the first sync.
export function defaultPresets() {
  return {
    listing: {
      whoMade: 'i_did',
      whenMade: 'made_to_order',
      listingType: 'physical',
      renewalOption: 'automatic',
      isPersonalizable: false,
      defaultQuantity: 1,
      defaultPrice: '9.99',
      descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
      materials: 'Cotton,bella canvas,gildan',
      itemWeight: 4,
      itemWeightUnit: 'oz',
      itemLength: 13,
      itemWidth: 10,
      itemHeight: 1,
      itemDimensionsUnit: 'in',
    },
    variation: {
      enabled: false,
      variation1Name: 'Size',
      variation1PropertyId: '',
      variation1Options: 'S,M,L,XL,2XL,3XL',
      variation2Name: 'Color',
      variation2PropertyId: '',
      variation2Options: 'Black,White,Ash,Sport Grey,Navy',
      quantityPerVariation: 999,
      priceMode: 'manifest',
      skuMode: 'base-option-combo',
    },
    supplemental: {
      enabled: false,
      includeSizeCharts: false,
      sizeChartRequiredCount: 3,
      includePromoImages: false,
      sizeChartFolder: '',
      promoFolder: '',
      maxSupplementalImages: 4,
    },
  };
}

// Applied when presets are READ from storage (both storage adapters, so the
// Configure UI and the Batchly sync payload see the same values). Fills any
// keys a stored row is missing from the defaults (forward-compatible if the
// preset shape grows) and — critically — substitutes the canonical
// description template when the stored one is blank, so the shop's approved
// baseline reaches every draft even for rows seeded before the template
// existed. A non-blank stored template always wins (hub stays authoritative).
export function withPresetDefaults(stored) {
  const d = defaultPresets();
  if (!stored || typeof stored !== 'object') return d;
  const listing = { ...d.listing, ...(stored.listing || {}) };
  if (typeof listing.descriptionTemplate !== 'string' || listing.descriptionTemplate.trim() === '') {
    listing.descriptionTemplate = DEFAULT_DESCRIPTION_TEMPLATE;
  }
  return {
    listing,
    variation: { ...d.variation, ...(stored.variation || {}) },
    supplemental: { ...d.supplemental, ...(stored.supplemental || {}) },
  };
}

// ---------------------------------------------------------------------------
// Validation. Each validator returns { ok:true, value } with a normalized
// value, or { ok:false, errors:[{field, message}] }. Unknown fields rejected.
// ---------------------------------------------------------------------------

const ETSY_ID_FIELDS = ['taxonomyId', 'shippingProfileId', 'readinessStateId', 'returnPolicyId', 'sectionId'];

function err(field, message) { return { field, message }; }

function normalizeEtsyId(value, field, errors) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) {
    errors.push(err(field, 'must be a positive integer or empty'));
    return null;
  }
  return n;
}

// Validate a partial update to a store row. Only the fields the hub UI edits
// are accepted; Etsy mirror fields and test results are server-managed.
export function validateStorePatch(patch) {
  const errors = [];
  const value = {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, errors: [err('body', 'expected a JSON object')] };
  }
  const ALLOWED = new Set(['displayName', 'enabled', 'skuPrefix', 'skuPrefixSource', 'driveFolderId', 'notes', 'etsyIds']);
  for (const key of Object.keys(patch)) {
    if (!ALLOWED.has(key)) errors.push(err(key, 'unknown field'));
  }
  if ('displayName' in patch) {
    if (typeof patch.displayName !== 'string' || patch.displayName.length > 80) {
      errors.push(err('displayName', 'must be a string of at most 80 chars'));
    } else value.displayName = patch.displayName.trim();
  }
  if ('enabled' in patch) {
    if (typeof patch.enabled !== 'boolean') errors.push(err('enabled', 'must be a boolean'));
    else value.enabled = patch.enabled;
  }
  if ('skuPrefix' in patch) {
    const raw = typeof patch.skuPrefix === 'string' ? patch.skuPrefix.trim().toUpperCase() : patch.skuPrefix;
    if (raw === '') value.skuPrefix = '';
    else if (typeof raw !== 'string' || !SKU_PREFIX_RE.test(raw)) {
      errors.push(err('skuPrefix', 'must be 1-6 uppercase letters (A-Z) or empty'));
    } else value.skuPrefix = raw;
  }
  if ('skuPrefixSource' in patch) {
    if (!SKU_PREFIX_SOURCES.includes(patch.skuPrefixSource)) {
      errors.push(err('skuPrefixSource', `must be one of ${SKU_PREFIX_SOURCES.join(', ')}`));
    } else value.skuPrefixSource = patch.skuPrefixSource;
  }
  if ('driveFolderId' in patch) {
    const raw = typeof patch.driveFolderId === 'string' ? patch.driveFolderId.trim() : patch.driveFolderId;
    if (raw === '') value.driveFolderId = '';
    else if (typeof raw !== 'string' || !DRIVE_FOLDER_ID_RE.test(raw)) {
      errors.push(err('driveFolderId', 'must be a Google Drive folder ID (10-100 chars of A-Za-z0-9_-) or empty'));
    } else value.driveFolderId = raw;
  }
  if ('notes' in patch) {
    if (typeof patch.notes !== 'string' || patch.notes.length > 2000) {
      errors.push(err('notes', 'must be a string of at most 2000 chars'));
    } else value.notes = patch.notes;
  }
  if ('etsyIds' in patch) {
    if (!patch.etsyIds || typeof patch.etsyIds !== 'object' || Array.isArray(patch.etsyIds)) {
      errors.push(err('etsyIds', 'must be an object'));
    } else {
      const ids = {};
      for (const key of Object.keys(patch.etsyIds)) {
        if (!ETSY_ID_FIELDS.includes(key)) { errors.push(err(`etsyIds.${key}`, 'unknown field')); continue; }
        ids[key] = normalizeEtsyId(patch.etsyIds[key], `etsyIds.${key}`, errors);
      }
      value.etsyIds = ids;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}

function validateNumber(value, field, { min, max, integer = false }, errors) {
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    errors.push(err(field, `must be a ${integer ? 'whole ' : ''}number between ${min} and ${max}`));
    return null;
  }
  return n;
}

function validateShortString(value, field, maxLen, errors, { required = false } = {}) {
  if (typeof value !== 'string' || value.length > maxLen || (required && !value.trim())) {
    errors.push(err(field, `must be a ${required ? 'non-empty ' : ''}string of at most ${maxLen} chars`));
    return null;
  }
  return value;
}

// Validate the full shared presets object (all three sections required).
export function validatePresets(presets) {
  const errors = [];
  if (!presets || typeof presets !== 'object') {
    return { ok: false, errors: [err('body', 'expected {listing, variation, supplemental}')] };
  }
  const { listing = {}, variation = {}, supplemental = {} } = presets;
  const value = { listing: {}, variation: {}, supplemental: {} };

  // --- listing ---
  if (!WHO_MADE_VALUES.includes(listing.whoMade)) errors.push(err('listing.whoMade', `must be one of ${WHO_MADE_VALUES.join(', ')}`));
  else value.listing.whoMade = listing.whoMade;
  if (!WHEN_MADE_VALUES.includes(listing.whenMade)) errors.push(err('listing.whenMade', 'must be a valid Etsy when_made value'));
  else value.listing.whenMade = listing.whenMade;
  if (!LISTING_TYPES.includes(listing.listingType)) errors.push(err('listing.listingType', `must be one of ${LISTING_TYPES.join(', ')}`));
  else value.listing.listingType = listing.listingType;
  if (!RENEWAL_OPTIONS.includes(listing.renewalOption)) errors.push(err('listing.renewalOption', `must be one of ${RENEWAL_OPTIONS.join(', ')}`));
  else value.listing.renewalOption = listing.renewalOption;
  if (typeof listing.isPersonalizable !== 'boolean') errors.push(err('listing.isPersonalizable', 'must be a boolean'));
  else value.listing.isPersonalizable = listing.isPersonalizable;
  const qty = validateNumber(listing.defaultQuantity, 'listing.defaultQuantity', { min: 1, max: 999, integer: true }, errors);
  if (qty !== null) value.listing.defaultQuantity = qty;
  const price = Number(listing.defaultPrice);
  if (!Number.isFinite(price) || price <= 0 || price > 50000) errors.push(err('listing.defaultPrice', 'must be a price greater than 0'));
  else value.listing.defaultPrice = String(listing.defaultPrice);
  const tmpl = validateShortString(listing.descriptionTemplate ?? '', 'listing.descriptionTemplate', 20000, errors);
  if (tmpl !== null) value.listing.descriptionTemplate = tmpl;
  const mats = validateShortString(listing.materials ?? '', 'listing.materials', 500, errors);
  if (mats !== null) value.listing.materials = mats;
  const weight = validateNumber(listing.itemWeight, 'listing.itemWeight', { min: 0, max: 10000 }, errors);
  if (weight !== null) value.listing.itemWeight = weight;
  if (!['oz', 'lb', 'g', 'kg'].includes(listing.itemWeightUnit)) errors.push(err('listing.itemWeightUnit', 'must be oz, lb, g, or kg'));
  else value.listing.itemWeightUnit = listing.itemWeightUnit;
  for (const dim of ['itemLength', 'itemWidth', 'itemHeight']) {
    const v = validateNumber(listing[dim], `listing.${dim}`, { min: 0, max: 10000 }, errors);
    if (v !== null) value.listing[dim] = v;
  }
  if (!['in', 'ft', 'mm', 'cm', 'm'].includes(listing.itemDimensionsUnit)) errors.push(err('listing.itemDimensionsUnit', 'must be in, ft, mm, cm, or m'));
  else value.listing.itemDimensionsUnit = listing.itemDimensionsUnit;

  // --- variation ---
  if (typeof variation.enabled !== 'boolean') errors.push(err('variation.enabled', 'must be a boolean'));
  else value.variation.enabled = variation.enabled;
  for (const [nameField, propField, optField] of [
    ['variation1Name', 'variation1PropertyId', 'variation1Options'],
    ['variation2Name', 'variation2PropertyId', 'variation2Options'],
  ]) {
    const name = validateShortString(variation[nameField] ?? '', `variation.${nameField}`, 50, errors);
    if (name !== null) value.variation[nameField] = name;
    const prop = String(variation[propField] ?? '').trim();
    if (prop && !/^\d{1,15}$/.test(prop)) errors.push(err(`variation.${propField}`, 'must be a numeric Etsy property ID or empty'));
    else value.variation[propField] = prop;
    const opts = validateShortString(variation[optField] ?? '', `variation.${optField}`, 500, errors);
    if (opts !== null) value.variation[optField] = opts;
  }
  // Batchly's rule: variations enabled requires BOTH property IDs.
  if (variation.enabled === true) {
    if (!String(variation.variation1PropertyId ?? '').trim()) errors.push(err('variation.variation1PropertyId', 'required when variations are enabled'));
    if (!String(variation.variation2PropertyId ?? '').trim()) errors.push(err('variation.variation2PropertyId', 'required when variations are enabled'));
  }
  const qpv = validateNumber(variation.quantityPerVariation, 'variation.quantityPerVariation', { min: 1, max: 999, integer: true }, errors);
  if (qpv !== null) value.variation.quantityPerVariation = qpv;
  if (!['manifest', 'fixed'].includes(variation.priceMode)) errors.push(err('variation.priceMode', 'must be manifest or fixed'));
  else value.variation.priceMode = variation.priceMode;
  if (!['base-option-combo', 'base'].includes(variation.skuMode)) errors.push(err('variation.skuMode', 'must be base-option-combo or base'));
  else value.variation.skuMode = variation.skuMode;

  // --- supplemental ---
  for (const boolField of ['enabled', 'includeSizeCharts', 'includePromoImages']) {
    if (typeof supplemental[boolField] !== 'boolean') errors.push(err(`supplemental.${boolField}`, 'must be a boolean'));
    else value.supplemental[boolField] = supplemental[boolField];
  }
  const scc = validateNumber(supplemental.sizeChartRequiredCount, 'supplemental.sizeChartRequiredCount', { min: 0, max: 10, integer: true }, errors);
  if (scc !== null) value.supplemental.sizeChartRequiredCount = scc;
  const msi = validateNumber(supplemental.maxSupplementalImages, 'supplemental.maxSupplementalImages', { min: 0, max: 10, integer: true }, errors);
  if (msi !== null) value.supplemental.maxSupplementalImages = msi;
  for (const strField of ['sizeChartFolder', 'promoFolder']) {
    const v = validateShortString(supplemental[strField] ?? '', `supplemental.${strField}`, 300, errors);
    if (v !== null) value.supplemental[strField] = v;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Readiness — configuration completeness for a store. Deliberately does NOT
// include `enabled`: the enable toggle *requires* readiness (a store must be
// fully configured before it may be enabled), and "usable by tools" is
// enabled && ready.
// ---------------------------------------------------------------------------
export function computeReadiness(store, presets) {
  const missing = [];
  if (!store.etsyConnected) missing.push('etsy_connected');
  if (!store.etsyShopId || !store.etsyShopName) missing.push('etsy_shop_identity');
  if (!store.etsyIds?.taxonomyId) missing.push('etsy_taxonomy_id');
  if (!store.etsyIds?.shippingProfileId) missing.push('etsy_shipping_profile_id');
  if (!store.etsyIds?.readinessStateId) missing.push('etsy_readiness_state_id');
  if (!store.driveFolderId) missing.push('drive_folder_id');
  else if (store.driveTestStatus !== 'ok') missing.push('drive_folder_test');
  if (!SKU_PREFIX_RE.test(store.skuPrefix || '')) missing.push('sku_prefix');
  const presetsCheck = validatePresets(presets);
  if (!presetsCheck.ok) missing.push('presets_valid');
  return { ready: missing.length === 0, missing };
}

// Human labels for the readiness checklist (UI + docs share one vocabulary).
export const READINESS_LABELS = {
  etsy_connected: 'Etsy account connected',
  etsy_shop_identity: 'Etsy shop identity confirmed',
  etsy_taxonomy_id: 'Etsy taxonomy (category) ID set',
  etsy_shipping_profile_id: 'Etsy shipping profile ID set',
  etsy_readiness_state_id: 'Etsy processing/readiness profile ID set',
  drive_folder_id: 'Google Drive SKU folder ID set',
  drive_folder_test: 'Drive folder access test passed',
  sku_prefix: 'SKU prefix configured',
  presets_valid: 'Draft presets valid',
};

// ---------------------------------------------------------------------------
// Sync payload — the full-state document pushed to Preply and Batchly.
// ---------------------------------------------------------------------------
export function buildSyncPayload(state, generatedAt) {
  return {
    configVersion: state.configVersion,
    generatedAt,
    stores: SLOTS.map((slot) => {
      const s = state.stores[slot] || defaultStore(slot);
      return {
        slot,
        displayName: s.displayName,
        enabled: s.enabled,
        skuPrefix: s.skuPrefix,
        driveFolderId: s.driveFolderId,
        notes: s.notes,
        etsyIds: { ...s.etsyIds },
      };
    }),
    presets: state.presets,
    // Canonical variation profiles (front_sided complete, double_sided pending).
    // These are code-defined and shared by all stores; Batchly consumes them
    // verbatim and never re-derives the matrix. See lib/variationProfiles.
    variationProfiles: buildVariationProfilesPayload(),
  };
}
