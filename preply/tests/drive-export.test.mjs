import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';

// Run the whole suite against a scratch data directory. The tests used to
// read/write the production data/batches.json while the live Preply server
// was also writing it — concurrent writes tore the file and corrupted it.
// Seeds come from the committed fixtures so the suite is hermetic on a fresh clone.
const __dirnameTest = path.dirname(new URL(import.meta.url).pathname);
const SEED_DATA_DIR = path.join(__dirnameTest, 'fixtures', 'data');
const SCRATCH_DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'preply-test-data-'));
for (const seedFile of ['stores.json', 'settings.json', 'mockup-presets.json', 'sku-ledger.json']) {
  try {
    await fs.copyFile(path.join(SEED_DATA_DIR, seedFile), path.join(SCRATCH_DATA_DIR, seedFile));
  } catch { /* missing seed file — server will create defaults */ }
}
process.env.PREPLY_DATA_DIR = SCRATCH_DATA_DIR;

const {
  createBatch,
  createServiceAccountSkuFolder,
  commitExportedBatch,
  resetBatchWorkflow,
  exportDesignsToStoreDrives,
  dryRunBatchExport,
  uploadDesignToServiceAccountSkuFolder,
  uploadDesignToSkuFolder,
  scanServiceAccountStoreSkuFolders,
  refreshBatchSkuReservation,
  saveStores,
  reserveSkusFromDrive,
  writeBatchFilesAtomic,
  isSafeBatchId,
  safeRelativeSegments,
  getDriveMode,
  isRemoteDriveMode,
  getDriveAdapterLabel,
  userFriendlyDriveError,
  buildOAuthConsentUrl,
  getOAuthStatus,
  readStores,
  saveBatches,
  readJsonFile,
  writeJsonFile,
  BATCHES_FILE,
  DRIVE_EXPORT_REPORT_FILE,
  SOURCE_DESIGNS_DIR,
  MOCK_DRIVE_DIR,
  __setServiceAccountDriveClientForTests,
  __clearServiceAccountDriveClientForTests,
  __setOAuthDriveClientForTests,
  __clearOAuthDriveClientForTests
} = await import('../server.js');

const pngBase64 = Buffer.from('preply-test-design').toString('base64');
const originalBatches = await readJsonFile(BATCHES_FILE, []);
const originalDriveReport = await readJsonFile(DRIVE_EXPORT_REPORT_FILE, null);
const createdBatchIds = new Set();

function safeId(input, fallback = 'item') {
  return String(input || fallback)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || fallback;
}

async function activeNorthWindStore() {
  const stores = await readStores();
  const store = stores.find(item => item.name === 'NorthwindUS');
  assert.equal(store?.store_folder, 'Store_A');
  return store;
}

async function resetMockRoot(store) {
  const rootPath = path.join(MOCK_DRIVE_DIR, safeId(store.skuRootFolderId));
  await fs.rm(rootPath, { recursive: true, force: true });
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}

function statusFromReport(report) {
  return Object.fromEntries((report.stores || []).map(store => [
    store.store_id,
    Object.fromEntries((store.items || []).map(item => [item.sku, item]))
  ]));
}

async function resetBatchesForTest() {
  const datePart = new Date().toISOString().slice(0, 10);
  await fs.rm(path.join(SOURCE_DESIGNS_DIR, safeId(`BATCH-${datePart}-101`)), { recursive: true, force: true });
  const placeholders = Array.from({ length: 100 }, (_, index) => ({
    id: `BATCH-${datePart}-TEST-${String(index + 1).padStart(3, '0')}`,
    status: 'Canceled',
    reservedSkus: {}
  }));
  await saveBatches(placeholders);
}

async function createTestBatch(options = {}) {
  await resetBatchesForTest();
  const batch = await createBatch({
    designIds: ['D001'],
    sourceZipName: 'test.zip',
    validation: {},
    designFiles: options.persistSource === false ? [] : [
      { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
    ]
  });
  createdBatchIds.add(batch.id);
  return batch;
}

test.after(async () => {
  await writeJsonFile(BATCHES_FILE, originalBatches);
  if (originalDriveReport) await writeJsonFile(DRIVE_EXPORT_REPORT_FILE, originalDriveReport);
  for (const batchId of createdBatchIds) {
    await fs.rm(path.join(SOURCE_DESIGNS_DIR, safeId(batchId)), { recursive: true, force: true });
  }
  await fs.rm(SCRATCH_DATA_DIR, { recursive: true, force: true });
});

test('successful export creates SKU folder and uploads D001 into it', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  const batch = await createTestBatch();
  const report = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ]);

  assert.equal(report.status, 'completed');
  assert.equal(report.failures.length, 0);
  const item = report.stores[0].items[0];
  assert.equal(item.sku, 'CU1');
  assert.equal(item.folder_created, true);
  assert.equal(item.source_png_uploaded, true);
  assert.equal(item.final_upload_target_folder_id, item.folder_id);
  assert.equal(item.local_raw_design_exists, true);
  assert.ok(item.local_raw_design_size > 0);
  assert.equal(item.status, 'completed');
  assert.ok(item.folder_id);
  assert.ok(item.uploaded_file_id);
  assert.ok(fsSync.existsSync(path.join(rootPath, 'CU1', 'D001.png')));
});

test('retry reuses an existing current-batch SKU folder and does not duplicate it', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  const batch = await createTestBatch({ persistSource: false });
  const failed = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: '' }
  ]);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stores[0].items[0].folder_created, true);
  assert.match(failed.stores[0].items[0].error, /Raw source design file for D001 was not found locally/);
  assert.doesNotMatch(failed.stores[0].items[0].error, /service account/i);

  const retryBatch = {
    ...batch,
    driveExportStatus: statusFromReport(failed)
  };
  const retried = await exportDesignsToStoreDrives(retryBatch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ], { retryOnly: true });

  assert.equal(retried.status, 'completed');
  const item = retried.stores[0].items[0];
  assert.equal(item.folder_reused, true);
  assert.equal(item.folder_created, false);
  assert.equal(item.source_png_uploaded, true);
  assert.equal(item.status, 'completed');
  const skuFolders = (await fs.readdir(rootPath, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name === 'CU1');
  assert.equal(skuFolders.length, 1);
});

test('retry keeps the original SKU after source upload failure', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);

  const batch = await createTestBatch({ persistSource: false });
  const failed = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: '' }
  ]);
  const retryBatch = { ...batch, driveExportStatus: statusFromReport(failed) };
  const retried = await exportDesignsToStoreDrives(retryBatch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ], { retryOnly: true });

  assert.equal(failed.stores[0].items[0].sku, 'CU1');
  assert.equal(retried.stores[0].items[0].sku, 'CU1');
});

test('retry ignores a stale folder id and recreates the same reserved SKU folder', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  const batch = await createTestBatch();
  const retryBatch = {
    ...batch,
    driveExportStatus: {
      [store.id]: {
        CU1: {
          design_id: 'D001',
          sku: 'CU1',
          folder_id: 'stale-folder-id',
          uploaded_file_id: null,
          status: 'failed',
          error: 'old failure'
        }
      }
    }
  };
  const retried = await exportDesignsToStoreDrives(retryBatch, await readStores(), [], { retryOnly: true });

  const item = retried.stores[0].items[0];
  assert.equal(item.sku, 'CU1');
  assert.equal(item.folder_created, true);
  assert.equal(item.status, 'completed');
  assert.ok(fsSync.existsSync(path.join(rootPath, 'CU1', 'D001.png')));
});

test('dry run says Drive would be updated and does not write folders', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  const batch = await createTestBatch();
  await resetMockRoot(store);
  const report = await dryRunBatchExport(batch, await readStores());

  assert.equal(report.hasConflicts, false);
  assert.match(report.message, /Would create 1 SKU folder/);
  assert.equal(fsSync.existsSync(path.join(rootPath, 'CU1')), false);
});

test('service-account create, target get, and upload use the same Drive client and required params', async () => {
  const previousMode = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'service_account';
  const calls = [];
  const fakeDrive = {
    files: {
      create: async params => {
        calls.push({ method: 'create', params });
        if (params.requestBody?.mimeType === 'application/vnd.google-apps.folder') {
          return { data: { id: 'sku-folder-id', name: params.requestBody.name } };
        }
        return { data: { id: 'uploaded-file-id', name: params.requestBody.name, size: String(pngBase64.length) } };
      },
      get: async params => {
        calls.push({ method: 'get', params });
        return {
          data: {
            id: params.fileId,
            name: 'CU18',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['parent-folder-id'],
            ownedByMe: true,
            capabilities: { canAddChildren: true, canEdit: true },
            permissions: []
          }
        };
      }
    }
  };
  __setServiceAccountDriveClientForTests({
    drive: fakeDrive,
    clientEmail: 'preply-drive-bot@example-project.iam.gserviceaccount.com',
    keyPath: './google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
    instanceId: 'fake-drive-client-1'
  });

  try {
    const store = {
      id: 'northwindus-logo',
      name: 'NorthwindUS',
      store_folder: 'Store_A',
      skuRootFolderId: 'parent-folder-id'
    };
    const folder = await createServiceAccountSkuFolder(store, 'CU18');
    const upload = await uploadDesignToServiceAccountSkuFolder(store, 'CU18', {
      designId: 'D001',
      filename: 'D001.png',
      path: '/tmp/D001.png',
      exists: true,
      size: 18,
      buffer: Buffer.from('preply-test-design')
    }, folder);

    assert.equal(folder.createdByClientEmail, 'preply-drive-bot@example-project.iam.gserviceaccount.com');
    assert.equal(upload.uploadedByClientEmail, folder.createdByClientEmail);
    assert.equal(upload.uploadedByClientInstance, folder.createdByClientInstance);
    assert.deepEqual(calls.map(call => call.method), ['create', 'get', 'create']);
    assert.deepEqual(calls[0].params.requestBody.parents, ['parent-folder-id']);
    assert.equal(calls[0].params.supportsAllDrives, true);
    assert.equal(calls[1].params.fileId, 'sku-folder-id');
    assert.equal(calls[1].params.supportsAllDrives, true);
    assert.match(calls[1].params.fields, /capabilities/);
    assert.match(calls[1].params.fields, /permissions/);
    assert.deepEqual(calls[2].params.requestBody.parents, ['sku-folder-id']);
    assert.equal(calls[2].params.media.mimeType, 'image/png');
    assert.equal(calls[2].params.supportsAllDrives, true);
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previousMode;
    __clearServiceAccountDriveClientForTests();
  }
});

test('service-account SKU scan uses all-drives list options', async () => {
  const previousMode = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'service_account';
  const calls = [];
  __setServiceAccountDriveClientForTests({
    drive: {
      files: {
        list: async params => {
          calls.push(params);
          return { data: { files: [], nextPageToken: null } };
        }
      }
    },
    clientEmail: 'preply-drive-bot@example-project.iam.gserviceaccount.com',
    keyPath: './google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
    instanceId: 'fake-drive-client-list'
  });

  try {
    const scan = await scanServiceAccountStoreSkuFolders({
      id: 'northwindus-logo',
      name: 'NorthwindUS',
      code: 'CU',
      skuPrefix: 'CU',
      skuRootFolderId: 'parent-folder-id'
    });
    assert.equal(scan.serviceAccountEmail, 'preply-drive-bot@example-project.iam.gserviceaccount.com');
    assert.equal(calls[0].supportsAllDrives, true);
    assert.equal(calls[0].includeItemsFromAllDrives, true);
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previousMode;
    __clearServiceAccountDriveClientForTests();
  }
});

test('reset archives an exported batch without deleting it or its presets/stores', async () => {
  const storesBefore = JSON.stringify(await readStores());
  const presetsBefore = fsSync.existsSync(path.join(MOCK_DRIVE_DIR, '..', 'mockup-presets.json'))
    ? fsSync.readFileSync(path.join(MOCK_DRIVE_DIR, '..', 'mockup-presets.json'), 'utf8') : null;

  const store = await activeNorthWindStore();
  await resetMockRoot(store);
  const batch = await createTestBatch();
  await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ]);
  await commitExportedBatch(batch.id, {});

  const result = await resetBatchWorkflow(batch.id);
  assert.equal(result.ok, true);
  assert.equal(result.archived, true);
  assert.equal(result.status, 'Exported');
  assert.equal(result.drive_untouched, true);

  const batches = await readJsonFile(BATCHES_FILE, []);
  const archived = batches.find(b => b.id === batch.id);
  assert.ok(archived, 'batch record is kept, not deleted');
  assert.equal(archived.archived, true);
  assert.equal(archived.workflowActive, false);

  // Permanent config untouched.
  assert.equal(JSON.stringify(await readStores()), storesBefore);
  const cc = (await readStores()).find(s => s.name === 'NorthwindUS');
  assert.equal(cc.store_folder, 'Store_A');
  assert.equal(cc.skuPrefix, 'CU');
  const presetsAfter = presetsBefore !== null
    ? fsSync.readFileSync(path.join(MOCK_DRIVE_DIR, '..', 'mockup-presets.json'), 'utf8') : null;
  assert.equal(presetsAfter, presetsBefore, 'mockup presets untouched');
});

test('reset of a batch with incomplete Drive upload requires force', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);
  const batch = await createTestBatch({ persistSource: false });
  const failed = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: '' }
  ]);
  // Persist the failed drive report onto the batch so reset can see it.
  const batches = await readJsonFile(BATCHES_FILE, []);
  const idx = batches.findIndex(b => b.id === batch.id);
  batches[idx] = { ...batches[idx], driveExportReport: failed };
  await writeJsonFile(BATCHES_FILE, batches);

  const guarded = await resetBatchWorkflow(batch.id);
  assert.equal(guarded.ok, false);
  assert.equal(guarded.requiresForce, true);
  assert.match(guarded.message, /Google Drive upload is incomplete/);

  const forced = await resetBatchWorkflow(batch.id, { force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.archived, true);
});

test('reset prunes local source cache only after a completed Drive upload', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);
  const batch = await createTestBatch();
  const sourceDir = path.join(SOURCE_DESIGNS_DIR, safeId(batch.id));
  assert.equal(fsSync.existsSync(sourceDir), true, 'source PNG cached locally');

  await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ]);
  // Mark the batch's drive report completed so reset is allowed to prune the cache.
  const batches = await readJsonFile(BATCHES_FILE, []);
  const idx = batches.findIndex(b => b.id === batch.id);
  batches[idx] = { ...batches[idx], status: 'Exported', driveExportReport: { status: 'completed', failures: [] } };
  await writeJsonFile(BATCHES_FILE, batches);

  const result = await resetBatchWorkflow(batch.id);
  assert.equal(result.ok, true);
  assert.equal(result.source_cache_removed, true);
  assert.equal(fsSync.existsSync(sourceDir), false, 'local source cache pruned after Drive upload');
});

test('storageQuotaExceeded 403 is reported as a quota issue, not a permission error', () => {
  const err = new Error('Service Accounts do not have storage quota.');
  err.code = 403;
  err.errors = [{ reason: 'storageQuotaExceeded', domain: 'usageLimits', message: err.message }];
  const friendly = userFriendlyDriveError(err);
  assert.match(friendly, /no storage quota/i);
  assert.match(friendly, /OAuth user upload|Shared Drive/);
  assert.doesNotMatch(friendly, /lacks access/);
});

test('oauth is a recognized remote mode with its own adapter label', () => {
  const previousMode = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
  try {
    assert.equal(getDriveMode(), 'oauth');
    assert.equal(isRemoteDriveMode(), true);
    assert.equal(getDriveAdapterLabel(), 'OAuth user Drive adapter');
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previousMode;
  }
});

test('oauth status and consent URL stay consistent with client configuration', async () => {
  // Robust to ambient creds: assert the invariant rather than absolute values —
  // a consent URL exists iff a client is configured.
  const status = await getOAuthStatus();
  const consentUrl = buildOAuthConsentUrl();
  assert.equal(status.client_configured, consentUrl !== null);
  if (consentUrl) {
    const u = new URL(consentUrl);
    assert.equal(u.host, 'accounts.google.com');
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive');
    assert.equal(u.searchParams.get('access_type'), 'offline');
  }
  assert.equal(typeof status.connected, 'boolean');
});

test('oauth mode uploads the source PNG through the OAuth user client', async () => {
  const previousMode = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'oauth';
  const calls = [];
  const fakeDrive = {
    files: {
      get: async params => {
        calls.push({ method: 'get', params });
        return {
          data: {
            id: params.fileId,
            name: 'CU18',
            mimeType: 'application/vnd.google-apps.folder',
            parents: ['parent-folder-id'],
            ownedByMe: true,
            capabilities: { canAddChildren: true, canEdit: true },
            permissions: []
          }
        };
      },
      create: async params => {
        calls.push({ method: 'create', params });
        return { data: { id: 'oauth-uploaded-file-id', name: params.requestBody.name, size: '18' } };
      }
    }
  };
  __setOAuthDriveClientForTests({
    drive: fakeDrive,
    clientEmail: 'shop-owner@gmail.com',
    keyPath: 'google-oauth-client.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
    instanceId: 'oauth-user-drive-test'
  });

  try {
    const store = {
      id: 'northwindus-logo',
      name: 'NorthwindUS',
      store_folder: 'Store_A',
      skuRootFolderId: 'parent-folder-id'
    };
    // Dispatcher must route through the OAuth client when mode === 'oauth'.
    const upload = await uploadDesignToSkuFolder(store, 'CU18', {
      designId: 'D001',
      filename: 'D001.png',
      path: '/tmp/D001.png',
      exists: true,
      size: 18,
      buffer: Buffer.from('preply-test-design')
    }, { id: 'sku-folder-id', name: 'CU18' });

    assert.equal(upload.id, 'oauth-uploaded-file-id');
    assert.equal(upload.uploadedByClientEmail, 'shop-owner@gmail.com');
    assert.equal(upload.uploadedByClientInstance, 'oauth-user-drive-test');
    // Verified the target folder, then uploaded into that exact folder id.
    assert.deepEqual(calls.map(c => c.method), ['get', 'create']);
    assert.deepEqual(calls[1].params.requestBody.parents, ['sku-folder-id']);
    assert.equal(calls[1].params.media.mimeType, 'image/png');
    assert.equal(calls[1].params.supportsAllDrives, true);
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previousMode;
    __clearOAuthDriveClientForTests();
  }
});

test('service-account upload failure preserves raw Google API reason and target folder', async () => {
  const previousMode = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = 'service_account';
  const rawError = new Error('The user does not have sufficient permissions for this file.');
  rawError.code = 403;
  rawError.errors = [{ reason: 'insufficientFilePermissions', domain: 'global', message: rawError.message }];
  const fakeDrive = {
    files: {
      get: async () => ({
        data: {
          id: 'sku-folder-id',
          name: 'CU18',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['parent-folder-id'],
          ownedByMe: true,
          capabilities: { canAddChildren: true, canEdit: true },
          permissions: []
        }
      }),
      create: async params => {
        if (params.requestBody?.mimeType === 'application/vnd.google-apps.folder') return { data: { id: 'sku-folder-id', name: 'CU18' } };
        throw rawError;
      }
    }
  };
  __setServiceAccountDriveClientForTests({
    drive: fakeDrive,
    clientEmail: 'preply-drive-bot@example-project.iam.gserviceaccount.com',
    keyPath: './google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/drive'],
    instanceId: 'fake-drive-client-2'
  });

  try {
    await assert.rejects(
      uploadDesignToServiceAccountSkuFolder({
        id: 'northwindus-logo',
        name: 'NorthwindUS',
        store_folder: 'Store_A',
        skuRootFolderId: 'parent-folder-id'
      }, 'CU18', {
        designId: 'D001',
        filename: 'D001.png',
        path: '/tmp/D001.png',
        exists: true,
        size: 18,
        buffer: Buffer.from('preply-test-design')
      }, { id: 'sku-folder-id', name: 'CU18' }),
      error => {
        assert.equal(error.operation, 'upload source PNG');
        assert.equal(error.targetFolderId, 'sku-folder-id');
        assert.equal(error.googleError.code, 403);
        assert.deepEqual(error.googleError.reasons, ['insufficientFilePermissions']);
        assert.deepEqual(error.googleError.domains, ['global']);
        assert.match(error.message, /SKU folder created but upload failed/);
        return true;
      }
    );
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previousMode;
    __clearServiceAccountDriveClientForTests();
  }
});

// ---------------------------------------------------------------------------
// Verified-export contract + fail-loud persistence (silent Drive handoff fix)
// ---------------------------------------------------------------------------

test('two designs create two SKU folders, each with its own source PNG, and verification passes', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  await resetBatchesForTest();
  const batch = await createBatch({
    designIds: ['D001', 'D002'],
    sourceZipName: 'test-two.zip',
    validation: {},
    designFiles: [
      { designId: 'D001', filename: 'D001.png', base64: pngBase64 },
      { designId: 'D002', filename: 'D002.png', base64: pngBase64 }
    ]
  });
  createdBatchIds.add(batch.id);

  const report = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 },
    { designId: 'D002', filename: 'D002.png', base64: pngBase64 }
  ]);

  assert.equal(report.status, 'completed');
  assert.equal(report.verification.ok, true);
  assert.equal(report.verification.expected_items, 2);
  assert.equal(report.verification.completed_items, 2);
  const skus = report.stores[0].items.map(item => item.sku).sort();
  assert.deepEqual(skus, ['CU1', 'CU2']);
  assert.ok(fsSync.existsSync(path.join(rootPath, 'CU1', 'D001.png')));
  assert.ok(fsSync.existsSync(path.join(rootPath, 'CU2', 'D002.png')));
});

test('a failed upload produces a failed report with verification problems (visible failed state)', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);

  const batch = await createTestBatch({ persistSource: false });
  const report = await exportDesignsToStoreDrives(batch, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: '' }
  ]);

  assert.equal(report.status, 'failed');
  assert.equal(report.verification.ok, false);
  assert.equal(report.verification.expected_items, 1);
  assert.equal(report.verification.completed_items, 0);
  assert.ok(report.verification.problems.length > 0);
  assert.ok(report.failures.length > 0);
});

test('a batch with empty activeStores can never report a completed Drive export', async () => {
  const batch = await createTestBatch();
  const noStores = { ...batch, activeStores: [] };

  const report = await exportDesignsToStoreDrives(noStores, await readStores(), [
    { designId: 'D001', filename: 'D001.png', base64: pngBase64 }
  ]);

  assert.notEqual(report.status, 'completed');
  assert.equal(report.verification.ok, false);
  assert.match(report.verification.problems[0], /activeStores or reservedSkus is empty/);
  assert.ok(report.failures.length > 0);
});

test('a corrupted batches.json fails loudly instead of silently reading as empty', async () => {
  const validBatches = await readJsonFile(BATCHES_FILE, []);
  await fs.writeFile(BATCHES_FILE, `${JSON.stringify(validBatches, null, 2)}\n  }\n]`, 'utf8');
  try {
    await assert.rejects(
      resetBatchWorkflow('BATCH-DOES-NOT-EXIST'),
      error => {
        assert.equal(error.code, 'STATE_FILE_CORRUPTED');
        assert.match(error.message, /batches\.json is corrupted/);
        return true;
      }
    );
  } finally {
    await writeJsonFile(BATCHES_FILE, validBatches);
  }
});

// ---------------------------------------------------------------------------
// Stale SKU reservation recovery (Refresh SKU Reservation)
// ---------------------------------------------------------------------------

test('refreshBatchSkuReservation re-scans Drive, reserves the next safe SKUs, clears stale export state, and writes nothing to Drive', async () => {
  const store = await activeNorthWindStore();
  const rootPath = await resetMockRoot(store);

  // Batch reserves CU1 against an empty Drive root.
  const batch = await createTestBatch();
  assert.equal(batch.reservedSkus.D001[store.id].sku, 'CU1');

  // Drive reality moves on: another batch/manual work consumes CU1 and CU2,
  // making this batch's CU1 reservation stale. Also simulate a stale failed
  // export status pointing at old folder ids.
  await fs.mkdir(path.join(rootPath, 'CU1'));
  await fs.mkdir(path.join(rootPath, 'CU2'));
  const batches = await readJsonFile(BATCHES_FILE, []);
  const index = batches.findIndex(item => item.id === batch.id);
  batches[index].driveExportStatus = { [store.id]: { CU1: { sku: 'CU1', status: 'failed', folder_id: 'stale-folder-id' } } };
  batches[index].driveExportReport = { status: 'failed', failures: [{ message: 'stale' }] };
  await saveBatches(batches);

  const before = await fs.readdir(rootPath);
  const { batch: refreshed, previousReservedSkus } = await refreshBatchSkuReservation(batch.id);

  // Next safe SKU after the latest real Drive folder (CU2) is CU3 — the stale
  // CU1 reservation is not reused and no duplicate folder will ever be needed.
  assert.equal(previousReservedSkus.D001[store.id].sku, 'CU1');
  assert.equal(refreshed.reservedSkus.D001[store.id].sku, 'CU3');
  assert.equal(refreshed.driveReservedRanges[store.id].reservedStart, 'CU3');
  assert.equal(refreshed.driveReservedRanges[store.id].latestFound, 'CU2');

  // Stale export state is cleared; batch is not marked exported.
  assert.deepEqual(refreshed.driveExportStatus, {});
  assert.equal(refreshed.driveExportReport, null);
  assert.equal(refreshed.exportState.sku_reserved, true);
  assert.equal(refreshed.exportState.folder_created, false);
  assert.equal(refreshed.exportState.source_png_uploaded, false);
  assert.equal(refreshed.exportState.batch_zip_exported, false);
  assert.notEqual(refreshed.status, 'Exported');

  // Read-only against Drive: exactly the same folders as before, no files.
  const after = await fs.readdir(rootPath);
  assert.deepEqual(after.sort(), before.sort());
  assert.deepEqual(await fs.readdir(path.join(rootPath, 'CU1')), []);
  assert.deepEqual(await fs.readdir(path.join(rootPath, 'CU2')), []);

  // The refreshed reservation was persisted.
  const persisted = (await readJsonFile(BATCHES_FILE, [])).find(item => item.id === batch.id);
  assert.equal(persisted.reservedSkus.D001[store.id].sku, 'CU3');
});

test('refreshBatchSkuReservation refuses to touch an exported batch', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);

  const batch = await createTestBatch();
  const batches = await readJsonFile(BATCHES_FILE, []);
  const index = batches.findIndex(item => item.id === batch.id);
  batches[index].status = 'Exported';
  await saveBatches(batches);

  await assert.rejects(
    refreshBatchSkuReservation(batch.id),
    error => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /already exported/);
      return true;
    }
  );
});

test('refreshBatchSkuReservation skips PAST SKUs held by another active batch', async () => {
  const store = await activeNorthWindStore();
  await resetMockRoot(store);

  const batch = await createTestBatch();
  // Another live batch already holds CU2 — the SKU a fresh scan of an
  // empty-but-for-CU1 Drive root would hand out next. Reservation floors now
  // start the refreshed range past the rival's numbers instead of throwing
  // and stranding the operator (the old 409 behavior).
  await fs.mkdir(path.join(MOCK_DRIVE_DIR, safeId(store.skuRootFolderId), 'CU1'));
  const batches = await readJsonFile(BATCHES_FILE, []);
  const index = batches.findIndex(item => item.id === batch.id);
  batches.push({
    id: `${batch.id}-RIVAL`,
    status: 'Intake Complete',
    reservedSkus: { D999: { [store.id]: { storeId: store.id, storeName: store.name, sku: 'CU2' } } }
  });
  await saveBatches(batches);
  assert.ok(index >= 0);

  const { batch: refreshed } = await refreshBatchSkuReservation(batch.id);
  const skus = Object.values(refreshed.reservedSkus).map(byStore => byStore[store.id].sku);
  assert.ok(!skus.includes('CU2'), `refreshed range must avoid the rival's CU2 (got ${skus.join(', ')})`);
  assert.equal(skus[0], 'CU3', 'range starts past both the Drive scan (CU1) and the rival reservation (CU2)');
});

// ─── B3: atomic + verified Batchly local handoff ─────────────────────────────

import os2 from 'node:os';

async function makeHandoffRoot() {
  return fs.mkdtemp(path.join(os2.tmpdir(), 'preply-handoff-'));
}

const jpg = Buffer.from('fake-jpg-bytes').toString('base64');

test('B3 — successful handoff writes the full batch folder atomically', async () => {
  const root = await makeHandoffRoot();
  try {
    const result = await writeBatchFilesAtomic(root, 'BATCH-2026-07-02-001', 'store_folder,design_id\nStore_A,D001\n', [
      { path: 'Store_A/D001/CU1_1.jpg', base64: jpg },
      { path: 'Store_A/D001/CU1_2.jpg', base64: jpg }
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.filesWritten, 2);
    const target = path.join(root, 'BATCH-2026-07-02-001');
    assert.ok(fsSync.existsSync(path.join(target, 'batch_manifest.csv')));
    assert.ok(fsSync.existsSync(path.join(target, 'Store_A', 'D001', 'CU1_1.jpg')));
    assert.ok(fsSync.existsSync(path.join(target, 'Store_A', 'D001', 'CU1_2.jpg')));
    // No leftover temp dirs.
    const leftovers = fsSync.readdirSync(root).filter(name => name.startsWith('.tmp-'));
    assert.equal(leftovers.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B3 — mid-write failure leaves NO partial folder and no temp dir', async () => {
  const root = await makeHandoffRoot();
  try {
    // First file writes "x" as a FILE; second needs "x/" as a DIR → mkdir fails → abort.
    const result = await writeBatchFilesAtomic(root, 'BATCH-FAIL-001', null, [
      { path: 'x', base64: jpg },
      { path: 'x/y.jpg', base64: jpg }
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.filesWritten, 0);
    // Target folder must not exist, and no temp dir may remain.
    assert.equal(fsSync.existsSync(path.join(root, 'BATCH-FAIL-001')), false);
    const leftovers = fsSync.readdirSync(root);
    assert.equal(leftovers.length, 0, `expected empty root, found: ${leftovers.join(', ')}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B3 — failed handoff preserves a pre-existing target folder', async () => {
  const root = await makeHandoffRoot();
  try {
    const target = path.join(root, 'BATCH-PREEXIST-001');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'sentinel.txt'), 'keep me', 'utf8');
    const result = await writeBatchFilesAtomic(root, 'BATCH-PREEXIST-001', null, [
      { path: 'x', base64: jpg },
      { path: 'x/y.jpg', base64: jpg }
    ]);
    assert.equal(result.ok, false);
    // Existing target and its sentinel are untouched (removal only after full success).
    assert.ok(fsSync.existsSync(path.join(target, 'sentinel.txt')));
    assert.equal(fsSync.readFileSync(path.join(target, 'sentinel.txt'), 'utf8'), 'keep me');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B3 — path traversal is rejected and nothing is written', async () => {
  const root = await makeHandoffRoot();
  try {
    const result = await writeBatchFilesAtomic(root, 'BATCH-TRAVERSAL-001', null, [
      { path: '../escape.jpg', base64: jpg }
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsafe_path');
    // No target dir, no escaped file, no temp dir.
    assert.equal(fsSync.existsSync(path.join(root, 'BATCH-TRAVERSAL-001')), false);
    assert.equal(fsSync.existsSync(path.join(path.dirname(root), 'escape.jpg')), false);
    assert.equal(fsSync.readdirSync(root).length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B3 — unsafe batch id is rejected', async () => {
  const root = await makeHandoffRoot();
  try {
    assert.equal(isSafeBatchId('BATCH-2026-07-02-001'), true);
    assert.equal(isSafeBatchId('..'), false);
    assert.equal(isSafeBatchId('a/b'), false);
    const result = await writeBatchFilesAtomic(root, '..', null, [{ path: 'Store_A/D001/CU1_1.jpg', base64: jpg }]);
    assert.equal(result.ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('B3 — safeRelativeSegments accepts the Batchly path shape and rejects traversal', () => {
  assert.deepEqual(safeRelativeSegments('Store_A/D001/CU1_1.jpg'), ['Store_A', 'D001', 'CU1_1.jpg']);
  assert.equal(safeRelativeSegments('Store_A/../../etc/passwd'), null);
  assert.equal(safeRelativeSegments('../x'), null);
  assert.equal(safeRelativeSegments(''), null);
});

test('B3 — re-export replaces a prior target with only the new files', async () => {
  const root = await makeHandoffRoot();
  try {
    const id = 'BATCH-REEXPORT-001';
    await writeBatchFilesAtomic(root, id, null, [
      { path: 'Store_A/D001/CU1_1.jpg', base64: jpg },
      { path: 'Store_A/D002/CU2_1.jpg', base64: jpg }
    ]);
    // Second export with a single design must not leave the stale D002 folder.
    const result = await writeBatchFilesAtomic(root, id, null, [
      { path: 'Store_A/D001/CU1_1.jpg', base64: jpg }
    ]);
    assert.equal(result.ok, true);
    const target = path.join(root, id);
    assert.ok(fsSync.existsSync(path.join(target, 'Store_A', 'D001', 'CU1_1.jpg')));
    assert.equal(fsSync.existsSync(path.join(target, 'Store_A', 'D002')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ─── B1: store activation gate + per-store SKU reservation error ──────────────

const STORES_FILE_TEST = path.join(SCRATCH_DATA_DIR, 'stores.json');

// saveStores persists to the scratch stores.json; snapshot and restore it so a
// gate test never leaks its minimal store set into the other tests.
async function withStoresRestored(fn) {
  const backup = await fs.readFile(STORES_FILE_TEST, 'utf8').catch(() => null);
  try {
    return await fn();
  } finally {
    if (backup !== null) await fs.writeFile(STORES_FILE_TEST, backup);
  }
}

// A fully export-ready active store (logoDir points at the real StoreLogos asset).
function readyActiveStore(overrides = {}) {
  return {
    id: 'northwindus-logo',
    name: 'NorthwindUS',
    code: 'CU',
    skuPrefix: 'CU',
    active: true,
    store_folder: 'Store_A',
    logoDir: 'northwindUS-logo',
    skuRootFolderId: 'real-drive-folder-123',
    ...overrides
  };
}

async function withDriveMode(mode, fn) {
  const previous = process.env.GOOGLE_DRIVE_AUTH_MODE;
  process.env.GOOGLE_DRIVE_AUTH_MODE = mode;
  try {
    return await fn();
  } finally {
    process.env.GOOGLE_DRIVE_AUTH_MODE = previous;
  }
}

test('B1 — active store with a real folder id saves and keeps NorthWindUS = Store_A', async () => {
  await withStoresRestored(async () => {
    const stores = await saveStores([readyActiveStore()]);
    const cc = stores.find(s => s.name.toLowerCase().includes('northwind'));
    assert.ok(cc, 'NorthWindUS store should exist');
    assert.equal(cc.store_folder, 'Store_A');
    assert.equal(cc.active, true);
  });
});

test('B1 — active store with mock-drive-* id is ALLOWED in mock mode', async () => {
  await withStoresRestored(async () => {
    await withDriveMode('mock', async () => {
      const stores = await saveStores([readyActiveStore({ skuRootFolderId: 'mock-drive-northwindus-logo' })]);
      assert.equal(stores[0].active, true);
    });
  });
});

test('B1 — active store with mock-drive-* id is REJECTED in OAuth mode', async () => {
  await withStoresRestored(async () => {
    await withDriveMode('oauth', async () => {
      await assert.rejects(
        saveStores([readyActiveStore({ skuRootFolderId: 'mock-drive-northwindus-logo' })]),
        error => {
          assert.equal(error.statusCode, 400);
          assert.match(error.message, /NorthwindUS/);
          assert.match(error.message, /placeholder/);
          return true;
        }
      );
    });
  });
});

test('B1 — active store with mock-drive-* id is REJECTED in service_account mode', async () => {
  await withStoresRestored(async () => {
    await withDriveMode('service_account', async () => {
      await assert.rejects(
        saveStores([readyActiveStore({ skuRootFolderId: 'mock-drive-x' })]),
        /NorthwindUS/
      );
    });
  });
});

test('B1 — active store missing store_folder is rejected', async () => {
  await withStoresRestored(async () => {
    await assert.rejects(
      saveStores([readyActiveStore({ store_folder: '' })]),
      error => {
        assert.match(error.message, /Batchly folder/);
        return true;
      }
    );
  });
});

test('B1 — active store missing logo is rejected', async () => {
  await withStoresRestored(async () => {
    await assert.rejects(
      saveStores([readyActiveStore({ id: 'no-logo-store', logoDir: 'does-not-exist', logoUrl: null, store_logo: null })]),
      error => {
        assert.match(error.message, /store logo/);
        return true;
      }
    );
  });
});

test('B1 — active store missing skuPrefix is rejected', async () => {
  await withStoresRestored(async () => {
    await assert.rejects(
      saveStores([readyActiveStore({ skuPrefix: '', sku_prefix: '' })]),
      error => {
        assert.match(error.message, /SKU prefix/);
        return true;
      }
    );
  });
});

test('B1 — inactive incomplete store is allowed (mock-drive-*, no folder, no logo)', async () => {
  await withStoresRestored(async () => {
    await withDriveMode('oauth', async () => {
      const stores = await saveStores([
        readyActiveStore(),
        {
          id: 'store-b-logo',
          name: 'StoreB',
          skuPrefix: 'SB',
          active: false,
          store_folder: '',
          logoDir: 'does-not-exist',
          skuRootFolderId: 'mock-drive-store-b-logo'
        }
      ]);
      const b = stores.find(s => s.name === 'StoreB');
      assert.ok(b, 'inactive StoreB should still be saved');
      assert.equal(b.active, false);
    });
  });
});

test('B1 — failed SKU reservation names the failing store', async () => {
  await withDriveMode('service_account', async () => {
    const badStore = {
      id: 'store-b-logo',
      name: 'StoreB',
      code: 'SB',
      skuPrefix: 'SB',
      active: true,
      store_folder: 'Store_B',
      skuRootFolderId: 'mock-drive-store-b-logo'
    };
    await assert.rejects(
      reserveSkusFromDrive(['D001'], [badStore]),
      error => {
        assert.match(error.message, /SKU reservation failed for StoreB/);
        assert.match(error.message, /Store_B/);
        return true;
      }
    );
  });
});
