// Seed the hub's store-config storage from the live Preply stores.json so
// Store_A starts with its real values (NorthWindUS, prefix CU, real Drive
// folder) and the flip runbook's "empty diff" check can pass.
//
//   node scripts/seed-store-config.mjs [--dry-run]
//
// Notes:
// - Writes through the storage adapter directly (not the HTTP API), so it can
//   set enabled=true for Store_A even though its Etsy mirror hasn't been
//   populated yet — this mirrors current live behavior, where Store_A is the
//   active store. The API's enable gate applies to all future UI changes.
// - Idempotent: re-running overwrites with the same values.
// - The Etsy mirror (connected/shop/IDs) is populated later via the Configure
//   tab's "Test Connection" / "Refresh IDs from Batchly" actions.
// - Placeholder mock-drive-* folder ids are NOT copied (they aren't real Drive
//   folders); those slots start with an empty driveFolderId.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Same env loading order as server.js.
for (const filename of ['.env', '.env.local']) {
  const envPath = path.join(ROOT, filename);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const { createConfigStore } = await import(path.join(ROOT, 'lib', 'db.js'));
const { SLOTS, SKU_PREFIX_RE, DRIVE_FOLDER_ID_RE } = await import(path.join(ROOT, 'lib', 'storeConfig.js'));

const DRY_RUN = process.argv.includes('--dry-run');
const STORES_FILE = path.join(ROOT, 'preply', 'data', 'stores.json');

function readPreplyStores() {
  try {
    return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8'));
  } catch (error) {
    console.error(`Cannot read ${STORES_FILE}: ${error.message}`);
    process.exit(1);
  }
}

const preplyStores = readPreplyStores();
const bySlot = new Map();
for (const store of preplyStores) {
  const slot = store.store_folder || store.storeFolder;
  if (SLOTS.includes(slot)) bySlot.set(slot, store);
}

const store = createConfigStore();
await store.init();
console.log(`Seeding store config (${store.kind} adapter)${DRY_RUN ? ' — DRY RUN' : ''}\n`);

for (const slot of SLOTS) {
  const src = bySlot.get(slot);
  if (!src) {
    console.log(`  ${slot}: no Preply record — left at defaults`);
    continue;
  }
  const rawPrefix = String(src.skuPrefix || src.sku_prefix || src.code || '').toUpperCase();
  const rawFolder = String(src.skuRootFolderId || src.sku_root_folder_id || '');
  const patch = {
    displayName: String(src.name || src.storeName || '').slice(0, 80),
    enabled: src.active === true,
    skuPrefix: SKU_PREFIX_RE.test(rawPrefix) ? rawPrefix : '',
    skuPrefixSource: SKU_PREFIX_RE.test(rawPrefix) ? 'manual' : 'unset',
    // mock-drive-* placeholders are not real Drive folders — skip them.
    driveFolderId: DRIVE_FOLDER_ID_RE.test(rawFolder) && !rawFolder.startsWith('mock-drive-') ? rawFolder : '',
    notes: String(src.notes || '').slice(0, 2000),
  };
  console.log(`  ${slot}: name="${patch.displayName}" prefix=${patch.skuPrefix || '(none)'} enabled=${patch.enabled} drive=${patch.driveFolderId ? patch.driveFolderId.slice(0, 8) + '…' : '(none)'}`);
  if (!DRY_RUN) {
    const state = await store.getState();
    await store.updateStore(slot, patch, state.stores[slot].rowVersion);
  }
}

const state = await store.getState();
console.log(`\nDone. configVersion=${state.configVersion}`);
console.log('Next: populate the Etsy mirror via the Configure tab (Test Connection / Refresh IDs).');
await store.close();
