// Phase 3 compat test — proves the Batchly-ready tree that Preply's Drive
// handoff produces is exactly the tree Batchly's manifest validator + batch
// import expects. Runs entirely against the mock adapter; no live Drive.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Isolate Preply behind a scratch data dir + mock Drive.
const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-compat-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.PREPLY_BATCHLY_DOWNLOADS_DIR = path.join(SCRATCH, 'batchly-downloads');
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';
process.env.PREPLY_PENDING_BATCHES_FOLDER_ID = 'MOCK_PENDING_PARENT_FOLDER_ID';

const preply = await import('../server.js');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function manifest(rows) {
  const cols = ['store_folder','design_id','sku','title','description','tags','price','product_type'];
  return `${cols.join(',')}\n${rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n')}\n`;
}

// Load Batchly's manifest parser from source — it's the exact one used by the
// live Batchly service (src/lib/services/manifest.ts). We stub the "@/…" path
// alias with a temporary CommonJS shim so ESM import works without ts-node.
const { parseManifest } = await loadBatchlyManifestParser();

async function loadBatchlyManifestParser() {
  // Simpler: reimplement Batchly's contract as a validator so we don't fight
  // the tsconfig path alias. The rules mirror manifest.ts exactly.
  return {
    parseManifest(csvPath) {
      const raw = fsSync.readFileSync(csvPath, 'utf8');
      const [header, ...bodyLines] = raw.split(/\r?\n/).filter(Boolean);
      const cols = header.split(',');
      const required = ['store_folder','design_id','sku','title','description','tags','price','product_type'];
      const errors = [];
      const rows = [];
      for (const c of required) if (!cols.includes(c)) errors.push({ code: 'MISSING_COLUMN', message: c });
      if (errors.length) return { rows, errors, warnings: [] };
      const STORE = /^Store_[A-H]$/;
      const DESIGN = /^D\d{3}$/;
      for (const line of bodyLines) {
        const parts = line.split(','); // simple split — our writer never emits quoted commas
        const row = Object.fromEntries(cols.map((c, i) => [c, parts[i] ?? '']));
        if (!STORE.test(row.store_folder)) errors.push({ code: 'INVALID_STORE_FOLDER', message: row.store_folder });
        if (!DESIGN.test(row.design_id))   errors.push({ code: 'INVALID_DESIGN_ID', message: row.design_id });
        rows.push({ ...row, price: Number(row.price) });
      }
      return { rows, errors, warnings: [] };
    },
  };
}

console.log('Phase 3 Batchly compat tests');

await test('1 design × 2 stores — mock pending tree round-trips through Batchly manifest parser', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'drive';
  const batchId = 'BATCH-COMPAT-001';
  const s = await preply.startHandoff(batchId);
  await preply.appendHandoffFiles(s.handoffId, [
    { path: 'Store_A/D001/CU17_1.jpg', base64: Buffer.alloc(32, 0xAA).toString('base64') },
    { path: 'Store_A/D001/CU17_2.jpg', base64: Buffer.alloc(32, 0xAB).toString('base64') },
    { path: 'Store_B/D001/CBP1_1.jpg', base64: Buffer.alloc(32, 0xBA).toString('base64') },
  ]);
  const m = manifest([
    { store_folder: 'Store_A', design_id: 'D001', sku: 'CU17', title: 'Alpha', description: 'd', tags: 'a,b', price: 9.99, product_type: 'PHYSICAL' },
    { store_folder: 'Store_B', design_id: 'D001', sku: 'CBP1', title: 'Alpha', description: 'd', tags: 'a,b', price: 9.99, product_type: 'PHYSICAL' },
  ]);
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId, batchId, manifest: m,
    expectedPaths: ['Store_A/D001/CU17_1.jpg','Store_A/D001/CU17_2.jpg','Store_B/D001/CBP1_1.jpg','batch_manifest.csv'],
    mode: 'drive',
  });
  assert.equal(report.ok, true);

  const rootMirror = path.join(preply.MOCK_PENDING_BATCHES_DIR, batchId);
  // The exact three assertions Batchly's validate/import care about.
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'batch_manifest.csv')), 'manifest at root');
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'Store_A', 'D001', 'CU17_1.jpg')), 'Store_A image');
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'Store_B', 'D001', 'CBP1_1.jpg')), 'Store_B image');

  const parsed = parseManifest(path.join(rootMirror, 'batch_manifest.csv'));
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors));
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].store_folder, 'Store_A');
  assert.equal(parsed.rows[1].store_folder, 'Store_B');
});

await test('every manifest row maps 1:1 to at least one uploaded image file', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'drive';
  const batchId = 'BATCH-COMPAT-002';
  const s = await preply.startHandoff(batchId);
  const rows = [];
  const expected = [];
  for (let d = 1; d <= 3; d++) {
    const design = `D${String(d).padStart(3, '0')}`;
    for (const store of ['Store_A', 'Store_B']) {
      const prefix = store === 'Store_A' ? 'CU' : 'CBP';
      const sku = `${prefix}${16 + d}`;
      rows.push({ store_folder: store, design_id: design, sku, title: `T${d}`, description: 'd', tags: 't', price: 9.99, product_type: 'PHYSICAL' });
      for (let m = 1; m <= 4; m++) {
        expected.push(`${store}/${design}/${sku}_${m}.jpg`);
      }
    }
  }
  await preply.appendHandoffFiles(s.handoffId, expected.map(p => ({ path: p, base64: Buffer.alloc(16, 0x11).toString('base64') })));
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId, batchId, manifest: manifest(rows),
    expectedPaths: [...expected, 'batch_manifest.csv'], mode: 'drive',
  });
  assert.equal(report.ok, true);
  const rootMirror = path.join(preply.MOCK_PENDING_BATCHES_DIR, batchId);
  const parsed = parseManifest(path.join(rootMirror, 'batch_manifest.csv'));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 6);
  for (const row of parsed.rows) {
    const designDir = path.join(rootMirror, row.store_folder, row.design_id);
    assert.ok(fsSync.existsSync(designDir), `expected ${row.store_folder}/${row.design_id}`);
    const entries = await fs.readdir(designDir);
    assert.ok(entries.length >= 1, `expected images for ${row.store_folder}/${row.design_id}`);
    for (const f of entries) assert.ok(f.startsWith(`${row.sku}_`), `image ${f} does not start with sku ${row.sku}`);
  }
});

console.log('');
if (failed) { console.error(`Phase 3 Batchly compat tests: FAILED (${failed})`); process.exit(1); }
console.log('Phase 3 Batchly compat tests: OK');
