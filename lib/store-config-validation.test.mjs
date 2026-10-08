// Unit tests for lib/storeConfig.js (validation + readiness + payload).
// Run: node lib/store-config-validation.test.mjs
import assert from 'node:assert/strict';
import {
  SLOTS,
  isValidSlot,
  defaultStore,
  defaultPresets,
  validateStorePatch,
  validatePresets,
  computeReadiness,
  buildSyncPayload,
  withPresetDefaults,
  DEFAULT_DESCRIPTION_TEMPLATE,
} from './storeConfig.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

console.log('lib/storeConfig.js tests');

test('slots are the six fixed Store_A..Store_F', () => {
  assert.deepEqual(SLOTS, ['Store_A', 'Store_B', 'Store_C', 'Store_D', 'Store_E', 'Store_F']);
  for (const s of SLOTS) assert.ok(isValidSlot(s));
  for (const bad of ['Store_G', 'Store_H', 'store_a', 'Store_', 'Store_AB', '', null]) {
    assert.equal(isValidSlot(bad), false, `expected invalid: ${bad}`);
  }
});

test('validateStorePatch accepts a full valid patch and normalizes', () => {
  const r = validateStorePatch({
    displayName: '  NorthwindUS  ',
    enabled: false,
    skuPrefix: 'cu',
    skuPrefixSource: 'manual',
    driveFolderId: '1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV',
    notes: 'primary store',
    etsyIds: { taxonomyId: 123, shippingProfileId: '456', returnPolicyId: null },
  });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.value.displayName, 'NorthwindUS');
  assert.equal(r.value.skuPrefix, 'CU'); // uppercased
  assert.equal(r.value.etsyIds.shippingProfileId, 456); // numeric coercion
  assert.equal(r.value.etsyIds.returnPolicyId, null);
});

test('validateStorePatch rejects bad values', () => {
  for (const patch of [
    { skuPrefix: 'TOOLONGG' },
    { skuPrefix: 'C1' },
    { driveFolderId: 'short' },
    { driveFolderId: 'has spaces in it xxxxx' },
    { displayName: 'x'.repeat(81) },
    { enabled: 'yes' },
    { skuPrefixSource: 'guessed' },
    { etsyIds: { taxonomyId: -5 } },
    { etsyIds: { bogusField: 1 } },
    { unknownField: true },
  ]) {
    const r = validateStorePatch(patch);
    assert.equal(r.ok, false, `expected rejection: ${JSON.stringify(patch)}`);
  }
});

test('empty prefix and folder are allowed (clearing values)', () => {
  const r = validateStorePatch({ skuPrefix: '', driveFolderId: '' });
  assert.ok(r.ok);
  assert.equal(r.value.skuPrefix, '');
  assert.equal(r.value.driveFolderId, '');
});

test('default presets validate cleanly', () => {
  const r = validatePresets(defaultPresets());
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test('default listing preset carries the canonical description baseline', () => {
  const listing = defaultPresets().listing;
  // Screenshot-baseline values that must ship out of the box.
  assert.equal(listing.whoMade, 'i_did');
  assert.equal(listing.whenMade, 'made_to_order');
  assert.equal(listing.listingType, 'physical');
  assert.equal(listing.renewalOption, 'automatic');
  assert.equal(listing.materials, 'Cotton,bella canvas,gildan');
  assert.equal(listing.itemWeight, 4);
  assert.equal(listing.itemWeightUnit, 'oz');
  assert.deepEqual([listing.itemLength, listing.itemWidth, listing.itemHeight], [13, 10, 1]);
  // The template is the body only — the design title is prepended per-listing.
  assert.ok(listing.descriptionTemplate.startsWith('ORDERING:'));
  for (const marker of ['BULK DISCOUNTS', 'CARE INSTRUCTIONS:', 'PRODUCTION AND SHIPPING:', 'RETURN POLICY:']) {
    assert.ok(listing.descriptionTemplate.includes(marker), `template missing "${marker}"`);
  }
  assert.ok(!listing.descriptionTemplate.includes('<Design Title>'), 'template must not bake in the title placeholder');
});

test('withPresetDefaults fills a blank stored template with the baseline', () => {
  const stored = { listing: { ...defaultPresets().listing, descriptionTemplate: '' }, variation: {}, supplemental: {} };
  const out = withPresetDefaults(stored);
  assert.equal(out.listing.descriptionTemplate, DEFAULT_DESCRIPTION_TEMPLATE);
});

test('withPresetDefaults keeps a non-blank custom template (hub stays authoritative)', () => {
  const custom = 'ORDERING:\nCustom shop copy.';
  const out = withPresetDefaults({ listing: { descriptionTemplate: custom }, variation: {}, supplemental: {} });
  assert.equal(out.listing.descriptionTemplate, custom);
});

test('withPresetDefaults on null/empty yields full valid defaults', () => {
  for (const input of [null, undefined, {}]) {
    const out = withPresetDefaults(input);
    assert.ok(validatePresets(out).ok);
    assert.ok(out.listing.descriptionTemplate.startsWith('ORDERING:'));
  }
});

test('presets: variation enabled requires both property IDs (Batchly rule)', () => {
  const p = defaultPresets();
  p.variation.enabled = true;
  const r = validatePresets(p);
  assert.equal(r.ok, false);
  const fields = r.errors.map((e) => e.field);
  assert.ok(fields.includes('variation.variation1PropertyId'));
  assert.ok(fields.includes('variation.variation2PropertyId'));
  p.variation.variation1PropertyId = '513';
  p.variation.variation2PropertyId = '514';
  assert.ok(validatePresets(p).ok);
});

test('presets: bad enum / range values rejected', () => {
  const p = defaultPresets();
  p.listing.whoMade = 'a_robot';
  p.listing.defaultQuantity = 0;
  p.listing.defaultPrice = '-1';
  const r = validatePresets(p);
  assert.equal(r.ok, false);
  const fields = r.errors.map((e) => e.field);
  assert.ok(fields.includes('listing.whoMade'));
  assert.ok(fields.includes('listing.defaultQuantity'));
  assert.ok(fields.includes('listing.defaultPrice'));
});

test('readiness: default store is not ready, with the full missing list', () => {
  const { ready, missing } = computeReadiness(defaultStore('Store_B'), defaultPresets());
  assert.equal(ready, false);
  for (const item of ['etsy_connected', 'etsy_shop_identity', 'etsy_taxonomy_id', 'drive_folder_id', 'sku_prefix']) {
    assert.ok(missing.includes(item), `missing should include ${item}`);
  }
});

test('readiness: fully configured store is ready; enabled is NOT part of readiness', () => {
  const store = {
    ...defaultStore('Store_A'),
    enabled: false, // readiness must not depend on this
    skuPrefix: 'CU',
    driveFolderId: '1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV',
    driveTestStatus: 'ok',
    etsyConnected: true,
    etsyShopId: '123',
    etsyShopName: 'NorthWindUS',
    etsyIds: { taxonomyId: 1, shippingProfileId: 2, readinessStateId: 3, returnPolicyId: null, sectionId: null },
  };
  const { ready, missing } = computeReadiness(store, defaultPresets());
  assert.equal(ready, true, `unexpected missing: ${missing.join(',')}`);
  // Drive folder set but untested → not ready
  const untested = { ...store, driveTestStatus: 'untested' };
  assert.equal(computeReadiness(untested, defaultPresets()).ready, false);
  // returnPolicyId/sectionId are NOT required (matches Batchly fullyReady)
});

test('buildSyncPayload contains all six slots and only synced fields', () => {
  const state = {
    configVersion: 7,
    stores: Object.fromEntries(SLOTS.map((s) => [s, defaultStore(s)])),
    presets: defaultPresets(),
  };
  state.stores.Store_A.skuPrefix = 'CU';
  state.stores.Store_A.etsyShopName = 'should-not-sync';
  const payload = buildSyncPayload(state, '2026-07-10T00:00:00Z');
  assert.equal(payload.configVersion, 7);
  assert.equal(payload.stores.length, 6);
  const a = payload.stores.find((s) => s.slot === 'Store_A');
  assert.equal(a.skuPrefix, 'CU');
  assert.ok(!('etsyShopName' in a), 'etsy mirror fields must not sync');
  assert.ok(!('driveTestStatus' in a), 'test results must not sync');
  assert.ok(payload.presets.listing);
});

if (failed) { console.error(`\nstoreConfig tests: FAILED (${failed})`); process.exit(1); }
console.log('\nstoreConfig tests: OK');
