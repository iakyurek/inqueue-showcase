// Phase 3 handoff tests — exercises the chunked handoff pipeline directly
// against the Preply module (no HTTP). No live Drive writes: the mock adapter
// mirrors the staging tree into MOCK_PENDING_BATCHES_DIR, and the real Drive
// uploader is stubbed via __setDrivePendingUploaderForTests when we want to
// simulate a network failure or Drive-mode success.
//
// Run: node preply/tests/handoff.test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Isolate: point Preply at a scratch data dir so we don't touch dev state.
const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-phase3-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.PREPLY_BATCHLY_DOWNLOADS_DIR = path.join(SCRATCH, 'batchly-downloads');
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';
process.env.PREPLY_PENDING_BATCHES_FOLDER_ID = 'MOCK_PENDING_PARENT_FOLDER_ID';

// Import AFTER env is prepared so module-level constants pick it up.
const preply = await import('../server.js');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

// helpers ---------------------------------------------------------------------

function jpg(pathStr, byte = 0xFF) {
  const buf = Buffer.alloc(64, byte);
  return { path: pathStr, base64: buf.toString('base64') };
}

function makeManifest(rows) {
  const columns = ['store_folder','design_id','sku','title','description','tags','price','product_type'];
  const csvRow = r => columns.map(c => JSON.stringify(r[c] ?? '')).join(',').replace(/^"|"$/g, '');
  return `${columns.join(',')}\n${rows.map(csvRow).join('\n')}\n`;
}

// tests -----------------------------------------------------------------------

console.log('Phase 3 handoff tests');

await test('start creates a staging dir and returns the current mode', async () => {
  const s = await preply.startHandoff('BATCH-TEST-001');
  assert.equal(s.mode, 'local');
  assert.ok(s.handoffId.startsWith('BATCH-TEST-001-'));
  const stat = await fs.stat(s.stagingDir);
  assert.ok(stat.isDirectory());
});

await test('unsafe batch ids are rejected', async () => {
  await assert.rejects(preply.startHandoff('../etc/passwd'), /Unsafe batch id/);
  await assert.rejects(preply.startHandoff('bad/id'), /Unsafe batch id/);
});

await test('chunked file uploads write to staging and reject path traversal', async () => {
  const s = await preply.startHandoff('BATCH-TEST-002');
  const chunk1 = [jpg('Store_A/D001/CU17_1.jpg'), jpg('Store_A/D001/CU17_2.jpg')];
  const chunk2 = [jpg('Store_B/D001/CBP1_1.jpg')];
  await preply.appendHandoffFiles(s.handoffId, chunk1);
  await preply.appendHandoffFiles(s.handoffId, chunk2);
  const staged = await preply.collectStagedRelativePaths(s.stagingDir);
  assert.deepEqual(staged.sort(), [
    'Store_A/D001/CU17_1.jpg',
    'Store_A/D001/CU17_2.jpg',
    'Store_B/D001/CBP1_1.jpg',
  ]);
  await assert.rejects(
    preply.appendHandoffFiles(s.handoffId, [{ path: '../escape.jpg', base64: 'AA==' }]),
    /Rejected unsafe path/,
  );
});

await test('finalize local: verifies expected paths and commits to BATCHLY_DOWNLOADS_DIR', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'local';
  const batchId = 'BATCH-TEST-LOCAL-003';
  const s = await preply.startHandoff(batchId);
  const manifest = makeManifest([
    { store_folder: 'Store_A', design_id: 'D001', sku: 'CU17', title: 't', description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL' },
  ]);
  await preply.appendHandoffFiles(s.handoffId, [
    jpg('Store_A/D001/CU17_1.jpg'),
    jpg('Store_A/D001/CU17_2.jpg'),
  ]);
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId,
    batchId,
    manifest,
    expectedPaths: ['Store_A/D001/CU17_1.jpg', 'Store_A/D001/CU17_2.jpg', 'batch_manifest.csv'],
    mode: 'local',
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.local.ok, true);
  assert.equal(report.drive, null);
  // Manifest + images on disk where Batchly expects them
  const targetRoot = report.local.target;
  const readManifest = await fs.readFile(path.join(targetRoot, 'batch_manifest.csv'), 'utf8');
  assert.ok(readManifest.startsWith('store_folder,'));
  const jpg1 = await fs.stat(path.join(targetRoot, 'Store_A', 'D001', 'CU17_1.jpg'));
  assert.ok(jpg1.isFile() && jpg1.size > 0);
  // Staging cleaned up on success
  assert.equal(fsSync.existsSync(s.stagingDir), false);
});

await test('finalize drive (mock adapter): mirrors staging into MOCK_PENDING_BATCHES_DIR', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'drive';
  const batchId = 'BATCH-TEST-DRIVE-004';
  const s = await preply.startHandoff(batchId);
  const manifest = makeManifest([
    { store_folder: 'Store_A', design_id: 'D001', sku: 'CU17', title: 't', description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL' },
    { store_folder: 'Store_B', design_id: 'D001', sku: 'CBP1', title: 't', description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL' },
  ]);
  await preply.appendHandoffFiles(s.handoffId, [
    jpg('Store_A/D001/CU17_1.jpg'),
    jpg('Store_B/D001/CBP1_1.jpg'),
  ]);
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId,
    batchId,
    manifest,
    expectedPaths: ['Store_A/D001/CU17_1.jpg', 'Store_B/D001/CBP1_1.jpg', 'batch_manifest.csv'],
    mode: 'drive',
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.local, null);
  assert.equal(report.drive.ok, true);
  assert.equal(report.drive.adapter, 'mock');
  assert.equal(report.drive.batchFolderName, batchId);
  assert.equal(report.drive.files_created, 3); // 2 jpgs + manifest
  // The mock Drive adapter mirrors into MOCK_PENDING_BATCHES_DIR — this is
  // exactly the folder tree Batchly's downloadBatchFolder walks on real Drive.
  const rootMirror = path.join(preply.MOCK_PENDING_BATCHES_DIR, batchId);
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'batch_manifest.csv')));
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'Store_A', 'D001', 'CU17_1.jpg')));
  assert.ok(fsSync.existsSync(path.join(rootMirror, 'Store_B', 'D001', 'CBP1_1.jpg')));
});

await test('finalize drive (real adapter, stubbed): fails cleanly and preserves staging', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'drive';
  const batchId = 'BATCH-TEST-DRIVE-FAIL-005';
  preply.__setDrivePendingUploaderForTests(async () => {
    const err = new Error('Simulated Drive quota exceeded.');
    err.code = 'STORAGE_QUOTA';
    throw err;
  });
  try {
    const s = await preply.startHandoff(batchId);
    await preply.appendHandoffFiles(s.handoffId, [jpg('Store_A/D001/CU17_1.jpg')]);
    const report = await preply.finalizeHandoff({
      handoffId: s.handoffId,
      batchId,
      manifest: makeManifest([
        { store_folder: 'Store_A', design_id: 'D001', sku: 'CU17', title: 't', description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL' },
      ]),
      expectedPaths: ['Store_A/D001/CU17_1.jpg', 'batch_manifest.csv'],
      mode: 'drive',
    });
    assert.equal(report.ok, false);
    assert.equal(report.drive.ok, false);
    assert.match(report.drive.error, /Simulated Drive quota exceeded/);
    // Staging preserved so the browser doesn't have to re-render every JPEG on retry
    assert.equal(fsSync.existsSync(s.stagingDir), true);
  } finally {
    preply.__clearDrivePendingUploaderForTests();
  }
});

await test('finalize both: succeeds only when local AND drive succeed', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'both';
  const batchId = 'BATCH-TEST-BOTH-006';
  const s = await preply.startHandoff(batchId);
  const manifest = makeManifest([
    { store_folder: 'Store_A', design_id: 'D001', sku: 'CU17', title: 't', description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL' },
  ]);
  await preply.appendHandoffFiles(s.handoffId, [jpg('Store_A/D001/CU17_1.jpg')]);
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId,
    batchId,
    manifest,
    expectedPaths: ['Store_A/D001/CU17_1.jpg', 'batch_manifest.csv'],
    mode: 'both',
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.local.ok, true);
  assert.equal(report.drive.ok, true);
});

await test('missing manifest row → staging/manifest mismatch is caught', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'local';
  const batchId = 'BATCH-TEST-DRIFT-007';
  const s = await preply.startHandoff(batchId);
  await preply.appendHandoffFiles(s.handoffId, [jpg('Store_A/D001/CU17_1.jpg')]);
  await assert.rejects(
    preply.finalizeHandoff({
      handoffId: s.handoffId,
      batchId,
      manifest: 'ignored',
      // Client claims two files but only one was uploaded — must fail loud.
      expectedPaths: ['Store_A/D001/CU17_1.jpg', 'Store_B/D001/CBP1_1.jpg'],
      mode: 'local',
    }),
    /did not match manifest expectations/,
  );
});

await test('30 designs × 2 stores × 8 mockups = 480 files, chunked, does not blow up', async () => {
  process.env.PREPLY_BATCHLY_HANDOFF_MODE = 'local';
  const batchId = 'BATCH-TEST-SCALE-008';
  const s = await preply.startHandoff(batchId);
  const expected = [];
  const CHUNK_SIZE = 40;
  let buffer = [];
  for (let d = 1; d <= 30; d++) {
    const design = `D${String(d).padStart(3, '0')}`;
    for (const store of ['Store_A', 'Store_B']) {
      const prefix = store === 'Store_A' ? 'CU' : 'CBP';
      const sku = `${prefix}${d}`;
      for (let m = 1; m <= 8; m++) {
        const p = `${store}/${design}/${sku}_${m}.jpg`;
        buffer.push(jpg(p, (d * m) & 0xFF));
        expected.push(p);
        if (buffer.length >= CHUNK_SIZE) {
          await preply.appendHandoffFiles(s.handoffId, buffer);
          buffer = [];
        }
      }
    }
  }
  if (buffer.length) await preply.appendHandoffFiles(s.handoffId, buffer);
  const stagedCount = (await preply.collectStagedRelativePaths(s.stagingDir)).length;
  assert.equal(stagedCount, 480);

  const manifest = makeManifest(
    Array.from({ length: 30 }).flatMap((_, i) => ['Store_A','Store_B'].map(sf => ({
      store_folder: sf, design_id: `D${String(i+1).padStart(3, '0')}`,
      sku: `${sf === 'Store_A' ? 'CU' : 'CBP'}${i+1}`,
      title: `t${i}`, description: 'd', tags: 'a', price: 9.99, product_type: 'PHYSICAL',
    }))),
  );
  const report = await preply.finalizeHandoff({
    handoffId: s.handoffId, batchId, manifest,
    expectedPaths: [...expected, 'batch_manifest.csv'],
    mode: 'local',
  });
  assert.equal(report.ok, true, JSON.stringify(report).slice(0, 300));
  assert.equal(report.staged_file_count, 481); // 480 jpgs + manifest
});

// ── Parallel Drive tree upload (uploadTreeToPendingDrive) ─────────────────────
// Folder creation is concurrent (mapWithConcurrency over sibling dirs); these
// tests pin the invariants: every folder path created exactly once, and the
// retry path reuses prior folders/files instead of duplicating them.

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function makeFakeDrive({ priorTree = new Map() } = {}) {
  // priorTree: folderId -> [{ id, name, mimeType, size }]
  let nextId = 1;
  const folderCreates = [];
  const fileCreates = [];
  const drive = {
    files: {
      list: async (params) => {
        const match = /'([^']+)' in parents/.exec(params.q || '');
        const children = priorTree.get(match?.[1]) || [];
        return { data: { files: children, nextPageToken: null } };
      },
      create: async (params) => {
        const name = params.requestBody.name;
        const parent = params.requestBody.parents[0];
        if (params.requestBody.mimeType === FOLDER_MIME) {
          folderCreates.push({ name, parent });
          return { data: { id: `fake-folder-${nextId++}`, name } };
        }
        fileCreates.push({ name, parent });
        return { data: { id: `fake-file-${nextId++}`, name, size: 64 } };
      },
      delete: async () => ({ data: {} }),
    },
  };
  return { drive, folderCreates, fileCreates };
}

async function makeStagingTree(name) {
  const root = path.join(SCRATCH, name);
  await fs.rm(root, { recursive: true, force: true });
  for (const rel of ['Store_A/D001', 'Store_A/D002', 'Store_B/D001']) {
    await fs.mkdir(path.join(root, rel), { recursive: true });
    await fs.writeFile(path.join(root, rel, 'mockup.jpg'), Buffer.alloc(64, 0xff));
  }
  await fs.writeFile(path.join(root, 'batch_manifest.csv'), Buffer.alloc(64, 0x2c));
  return root;
}

await test('parallel Drive upload creates every folder exactly once and verifies all files', async () => {
  const staging = await makeStagingTree('staging-parallel-fresh');
  const fake = makeFakeDrive();
  preply.__setServiceAccountDriveClientForTests({
    drive: fake.drive, clientEmail: 'fake@sa', keyPath: 'k', scopes: [], instanceId: 'fake-parallel',
  });
  try {
    const report = await preply.uploadTreeToPendingDrive(staging, 'BATCH-PLL-001');
    assert.equal(report.verified, true);
    assert.equal(report.files_created, 4); // manifest + 3 mockups
    // Batch folder + Store_A + Store_B + 3 design folders = 6, no duplicates.
    assert.equal(report.folders_created, 6);
    const seen = new Set();
    for (const create of fake.folderCreates) {
      const key = `${create.parent}::${create.name}`;
      assert.ok(!seen.has(key), `folder created twice: ${key}`);
      seen.add(key);
    }
    assert.equal(fake.folderCreates.length, 6);
  } finally {
    preply.__clearServiceAccountDriveClientForTests();
  }
});

await test('parallel Drive upload retry reuses prior folders and size-matched files', async () => {
  const staging = await makeStagingTree('staging-parallel-retry');
  const pendingId = preply.getPendingBatchesFolderId();
  const priorTree = new Map([
    [pendingId, [{ id: 'prior-batch', name: 'BATCH-PLL-002', mimeType: FOLDER_MIME }]],
    ['prior-batch', [
      { id: 'prior-store-a', name: 'Store_A', mimeType: FOLDER_MIME },
      { id: 'prior-manifest', name: 'batch_manifest.csv', size: '64' },
    ]],
    ['prior-store-a', [{ id: 'prior-d001', name: 'D001', mimeType: FOLDER_MIME }]],
    ['prior-d001', [{ id: 'prior-jpg', name: 'mockup.jpg', size: '64' }]],
  ]);
  const fake = makeFakeDrive({ priorTree });
  preply.__setServiceAccountDriveClientForTests({
    drive: fake.drive, clientEmail: 'fake@sa', keyPath: 'k', scopes: [], instanceId: 'fake-retry',
  });
  try {
    const report = await preply.uploadTreeToPendingDrive(staging, 'BATCH-PLL-002');
    assert.equal(report.verified, true);
    // Only the folders missing from the prior tree get created:
    // Store_A/D002, Store_B, Store_B/D001 — never the batch root or Store_A.
    assert.deepEqual(fake.folderCreates.map(f => f.name).sort(), ['D001', 'D002', 'Store_B']);
    const reused = report.uploaded.filter(u => u.reused).map(u => u.path).sort();
    assert.deepEqual(reused, ['Store_A/D001/mockup.jpg', 'batch_manifest.csv']);
    // Re-uploaded files exclude the size-matched reused ones.
    assert.equal(fake.fileCreates.length, 2);
  } finally {
    preply.__clearServiceAccountDriveClientForTests();
  }
});

console.log('');
if (failed) {
  console.error(`Phase 3 handoff tests: FAILED (${failed})`);
  process.exit(1);
}
console.log('Phase 3 handoff tests: OK');
