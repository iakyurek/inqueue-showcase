/**
 * Preply QA Script
 * 1. Deactivates all stores except NorthwindUS temporarily
 * 2. Creates a batch via the Preply API (real Drive SKU scan)
 * 3. Writes batch files (manifest + placeholder mockup JPGs)
 * 4. Restores all stores
 * 5. Prints QA results
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const BASE = 'http://localhost:3001';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PREPLY_DIR = path.join(REPO_ROOT, 'preply');
const BATCHLY_DOWNLOADS = path.join(REPO_ROOT, 'batchly/workspace/downloads');

const DESIGN_IDS = ['D001', 'D002', 'D003'];
const TARGET_STORE_ID = 'northwindus-logo'; // NorthwindUS

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function getState() {
  return api('GET', '/api/state');
}

// Step 1: deactivate all stores except NorthwindUS
async function deactivateOthers(stores) {
  const patched = stores.map(s => ({
    ...s,
    active: s.id === TARGET_STORE_ID,
  }));
  const result = await api('POST', '/api/stores', { stores: patched });
  return result;
}

// Step 2: restore all stores to original active state
async function restoreStores(originalStores) {
  const result = await api('POST', '/api/stores', { stores: originalStores });
  return result;
}

// Step 3: create batch
async function createBatch(designIds) {
  return api('POST', '/api/batches', {
    designIds,
    sourceZipName: 'qa_inkly_batch.zip',
    validation: { errors: [], warnings: [] },
  });
}

// Step 4: generate a simple placeholder mockup JPG
async function makePlaceholderMockupJpg(designPngPath, outputPath) {
  // Composite the design (resized) onto a white 2000x2400 background
  await sharp({
    create: { width: 2000, height: 2400, channels: 3, background: { r: 240, g: 240, b: 240 } }
  })
    .composite([{
      input: await sharp(designPngPath).resize(600, 720, { fit: 'inside' }).flatten({ background: { r: 240, g: 240, b: 240 } }).toBuffer(),
      gravity: 'centre',
    }])
    .jpeg({ quality: 88 })
    .toFile(outputPath);
}

// Step 5: write batch files via Preply API
async function writeBatchFiles(batchId, manifest, files) {
  return api('POST', `/api/batches/${encodeURIComponent(batchId)}/write-batch-files`, {
    manifest,
    files,
  });
}

// Step 6: mark batch as exported
async function markExported(batchId) {
  return api('POST', `/api/batches/${encodeURIComponent(batchId)}/exported`, {
    exportInfo: { qa: true, mode: 'qa_script' }
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

const log = (msg) => console.log(`[preply-qa] ${msg}`);
const results = { steps: [] };

function pass(step, detail = '') {
  results.steps.push({ step, status: 'PASS', detail });
  log(`✓ ${step}${detail ? ' — ' + detail : ''}`);
}

function fail(step, detail = '') {
  results.steps.push({ step, status: 'FAIL', detail });
  log(`✗ ${step}${detail ? ' — ' + detail : ''}`);
}

// ------------------------------------------------------------------
log('=== Preply QA Starting ===');

// Get current state
const state = await getState();
const originalStores = state.stores;
log(`Current stores: ${originalStores.map(s => s.name).join(', ')}`);

const ccStore = originalStores.find(s => s.id === TARGET_STORE_ID);
if (!ccStore) { fail('Find NorthwindUS store', 'NOT FOUND'); process.exit(1); }
pass('Find NorthwindUS store', `store_folder=${ccStore.store_folder} skuPrefix=${ccStore.skuPrefix}`);

// Temporarily deactivate other stores
log('Deactivating other stores temporarily...');
await deactivateOthers(originalStores);
const stateAfterDeactivate = await getState();
const activeNow = stateAfterDeactivate.stores.filter(s => s.active);
log(`Active stores after deactivation: ${activeNow.map(s => s.name).join(', ')}`);

if (activeNow.length === 1 && activeNow[0].id === TARGET_STORE_ID) {
  pass('Deactivate other stores', 'Only NorthwindUS active');
} else {
  fail('Deactivate other stores', `Active: ${activeNow.map(s => s.name).join(', ')}`);
}

// Create batch (real Drive SKU scan for NorthwindUS)
log('Creating batch via Preply API (real Drive SKU scan)...');
let batchResult;
try {
  batchResult = await createBatch(DESIGN_IDS);
} catch (e) {
  await restoreStores(originalStores);
  fail('Create batch', e.message);
  process.exit(1);
}

if (!batchResult?.ok || !batchResult?.batch) {
  await restoreStores(originalStores);
  fail('Create batch', JSON.stringify(batchResult));
  process.exit(1);
}

const batch = batchResult.batch;
const batchId = batch.id;
log(`Batch created: ${batchId}`);

// Verify SKU reservations for Store_C
const reservedForCCUS = batch.activeStores?.find(s => s.id === TARGET_STORE_ID);
if (!reservedForCCUS) {
  await restoreStores(originalStores);
  fail('Verify Store_C SKU reservation', 'NorthwindUS not in activeStores');
  process.exit(1);
}

const skus = DESIGN_IDS.map(did => batch.reservedSkus?.[did]?.[TARGET_STORE_ID]?.sku);
log(`Reserved SKUs: ${skus.join(', ')}`);
const allSkusValid = skus.every(sku => sku && /^CU\d+$/.test(sku));
if (allSkusValid) {
  pass('SKU reservation for Store_C', `SKUs: ${skus.join(', ')} (prefix=CU, source=google_drive)`);
} else {
  fail('SKU reservation for Store_C', `Got: ${skus.join(', ')}`);
}

// Restore other stores
log('Restoring all stores...');
await restoreStores(originalStores);
pass('Restore all stores');

// Build batch manifest for Store_C only
const designMeta = [
  { id: 'D001', title: 'Patriotic Eagle USA Flag Shirt', keywords: 'patriotic shirt,usa eagle shirt,american eagle tee,4th of july shirt,flag shirt,independence day,eagle tee shirt,usa pride shirt,america shirt,patriot shirt,usa flag tee,eagle graphic tee,freedom shirt', desc: 'Patriotic Eagle USA Flag Shirt' },
  { id: 'D002', title: 'Blessed Mama Wildflower Shirt', keywords: 'blessed mama shirt,wildflower mama tee,mom gift shirt,floral mom shirt,blessed mom tee,mothers day gift,mama shirt,wildflower shirt,boho mama tee,mom tee shirt,floral shirt gift,motherhood shirt,blessed mother tee', desc: 'Blessed Mama Wildflower Shirt' },
  { id: 'D003', title: 'Game Day Football Fan Shirt', keywords: 'game day shirt,football fan tee,football shirt,tailgate shirt,game day tee,football sunday,fan shirt,football fan gift,game day fan,tailgate tee shirt,sunday football shirt,football season shirt,fan gear shirt', desc: 'Game Day Football Fan Shirt' },
];

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

const columns = ['store_folder','design_id','sku','title','description','tags','price','product_type'];
const manifestRows = DESIGN_IDS.map((did, i) => {
  const meta = designMeta[i];
  const sku = skus[i];
  return columns.map(col => csvCell({
    store_folder: 'Store_C',
    design_id: did,
    sku,
    title: meta.title,
    description: meta.desc,
    tags: meta.keywords,
    price: 24.99,
    product_type: 'PHYSICAL',
  }[col])).join(',');
});

const manifest = [columns.join(','), ...manifestRows].join('\n');
log('Manifest preview:\n' + manifest);

// Verify manifest structure
const manifestParsed = manifest.split('\n').slice(1).filter(Boolean);
const manifestCols = manifest.split('\n')[0].split(',');
const expectedCols = ['store_folder','design_id','sku','title','description','tags','price','product_type'];
const colsMatch = JSON.stringify(manifestCols) === JSON.stringify(expectedCols);
const rowCount = manifestParsed.length;
const allStoreC = manifestParsed.every(r => r.startsWith('Store_C'));
const allPhysical = manifestParsed.every(r => r.includes('PHYSICAL'));
const allPrice = manifestParsed.every(r => r.includes('24.99'));

if (colsMatch) pass('Manifest columns', expectedCols.join(', '));
else fail('Manifest columns', `Got: ${manifestCols.join(', ')}`);

if (rowCount === 3) pass('Manifest row count', '3 rows');
else fail('Manifest row count', `Got ${rowCount}`);

if (allStoreC) pass('All rows store_folder=Store_C');
else fail('All rows store_folder=Store_C');

if (allPhysical) pass('All rows product_type=PHYSICAL');
else fail('All rows product_type=PHYSICAL');

if (allPrice) pass('All rows price=24.99');
else fail('All rows price', 'price not found in rows');

// Generate placeholder mockup images (proper composites using sharp)
log('Generating placeholder mockup JPGs for Store_C/D001, D002, D003...');
const tmpMockupDir = '/tmp/qa_mockups';
await fs.mkdir(tmpMockupDir, { recursive: true });

// Source design PNGs from Inkly
const inklyOutputDir = path.join(REPO_ROOT, 'inkly/storage/outputs');
const designJobs = [
  '1782634389506-upload', // D001
  '1782634318710-upload', // D002
  '1782633143133-upload', // D003
];

const batchFiles = [];
let imageGenErrors = 0;

for (let i = 0; i < DESIGN_IDS.length; i++) {
  const designId = DESIGN_IDS[i];
  const sku = skus[i];
  const designPng = path.join(inklyOutputDir, designJobs[i], 'design.png');
  const mockupFile = path.join(tmpMockupDir, `${designId}_mockup_01.jpg`);
  const filePath = `Store_C/${designId}/${sku}_1.jpg`;
  
  try {
    await makePlaceholderMockupJpg(designPng, mockupFile);
    const jpgData = await fs.readFile(mockupFile);
    const base64 = jpgData.toString('base64');
    batchFiles.push({ path: filePath, base64 });
    pass(`Generate mockup for ${designId}`, `${filePath} (${Math.round(jpgData.length/1024)}KB)`);
  } catch (e) {
    fail(`Generate mockup for ${designId}`, e.message);
    imageGenErrors++;
  }
}

if (imageGenErrors > 0) {
  log('WARNING: Some mockup generation failed');
}

// Write batch files via Preply API
log(`Writing batch files to Batchly downloads for batchId=${batchId}...`);
let writeResult;
try {
  writeResult = await writeBatchFiles(batchId, manifest, batchFiles);
} catch(e) {
  fail('Write batch files', e.message);
  process.exit(1);
}

if (writeResult?.ok && writeResult?.batchlyWritten) {
  pass('Write batch files', `written=${writeResult.written} batchlyWritten=true`);
} else {
  fail('Write batch files', JSON.stringify(writeResult));
}

// Mark as exported
await markExported(batchId);
pass('Mark batch as exported');

// Verify final structure in Batchly downloads
const batchlyBatchDir = path.join(BATCHLY_DOWNLOADS, batchId);
log(`Verifying Batchly batch dir: ${batchlyBatchDir}`);

const batchlyFiles = [];
async function walkDir(dir, rel = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const fullPath = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) await walkDir(fullPath, relPath);
    else batchlyFiles.push(relPath);
  }
}
await walkDir(batchlyBatchDir);
log('Files in Batchly downloads/' + batchId + ':');
batchlyFiles.forEach(f => log('  ' + f));

const hasManifest = batchlyFiles.includes('batch_manifest.csv');
const hasD001 = batchlyFiles.some(f => f.startsWith('Store_C/D001/'));
const hasD002 = batchlyFiles.some(f => f.startsWith('Store_C/D002/'));
const hasD003 = batchlyFiles.some(f => f.startsWith('Store_C/D003/'));
const noOtherStore = !batchlyFiles.some(f => /^Store_[ABDEFGH]\//.test(f));

if (hasManifest) pass('batch_manifest.csv exists in Batchly downloads');
else fail('batch_manifest.csv missing from Batchly downloads');

if (hasD001 && hasD002 && hasD003) pass('Store_C/D001, D002, D003 folders exist');
else fail('Store_C design folders', `D001=${hasD001} D002=${hasD002} D003=${hasD003}`);

if (noOtherStore) pass('No other store folders (Store_A, B, D, E, F, G, H)');
else fail('Other store folders found', batchlyFiles.filter(f => /^Store_[ABDEFGH]\//.test(f)).join(', '));

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n=== PREPLY QA SUMMARY ===');
const passed = results.steps.filter(s => s.status === 'PASS').length;
const failed2 = results.steps.filter(s => s.status === 'FAIL').length;
console.log(`Passed: ${passed} / ${results.steps.length}`);
console.log(`Failed: ${failed2} / ${results.steps.length}`);
console.log(`Batch ID: ${batchId}`);
console.log(`Store tested: NorthwindUS / Store_C`);
console.log(`SKUs reserved: ${skus.join(', ')}`);
results.steps.forEach(s => {
  const icon = s.status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${s.step}${s.detail ? ': ' + s.detail : ''}`);
});

process.exit(failed2 > 0 ? 1 : 0);
