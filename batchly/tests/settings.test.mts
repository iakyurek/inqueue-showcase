// Phase 5: Batchly settings backend — AppSetting CRUD + precedence, mocked
// Drive folder test, redacted settings status, duplicate-folder warning,
// production guardrails, and a static no-draft-code check for the new
// settings surface. No live Drive or Etsy calls (Drive client is mocked).
//
// Run: cd batchly && npx tsx tests/settings.test.mts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  SETTING_KEYS,
  getSetting,
  setSetting,
  deleteSetting,
  getPendingFolderId,
  setPendingFolderLastTest,
  getPendingFolderLastTest,
} from "../src/lib/services/appSettings";
import {
  listBatchFolders,
  testPendingFolder,
  getConnectionInfo,
  __setDriveClientForTests,
  __resetDriveClientForTests,
} from "../src/lib/services/drive";
import { getBatchlySettingsStatus } from "../src/lib/services/settingsStatus";
import { findDuplicateDriveFolders } from "../src/lib/services/storeIntegrity";
import { computeProductionWarnings } from "../src/lib/productionGuardrails";

const TAG = "phase5-settings";

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).stack || (err as Error).message}`); }
}

async function cleanup() {
  await prisma.storeEtsyIds.deleteMany({ where: { store: { name: { startsWith: TAG } } } });
  await prisma.store.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.appSetting.deleteMany({});
}

// Minimal mocked Drive v3 client: one pending folder with two batch subfolders.
function mockDriveClient(opts: { folderName?: string; failGet?: boolean } = {}) {
  const calls: { listQueries: string[] } = { listQueries: [] };
  const client = {
    files: {
      get: async (params: { fileId: string }) => {
        if (opts.failGet) throw new Error("File not found: 404");
        return { data: { id: params.fileId, name: opts.folderName ?? "pending-batches", mimeType: "application/vnd.google-apps.folder", trashed: false } };
      },
      list: async (params: { q?: string }) => {
        calls.listQueries.push(params.q ?? "");
        return {
          data: {
            files: [
              { id: "b1", name: "BATCH-001", modifiedTime: "2026-07-01T00:00:00Z" },
              { id: "b2", name: "BATCH-002", modifiedTime: "2026-07-02T00:00:00Z" },
            ],
          },
        };
      },
    },
    about: { get: async () => ({ data: { user: { emailAddress: "test@example.com" } } }) },
  };
  return { client: client as never, calls };
}

console.log("Phase 5 Batchly settings tests");
await cleanup();

// ---------------------------------------------------------------------------
// AppSetting CRUD + precedence
// ---------------------------------------------------------------------------

await test("appSettings get/set/delete roundtrip", async () => {
  assert.equal(await getSetting("phase5-test-key"), null);
  await setSetting("phase5-test-key", "v1");
  assert.equal(await getSetting("phase5-test-key"), "v1");
  await setSetting("phase5-test-key", "v2");
  assert.equal(await getSetting("phase5-test-key"), "v2");
  await deleteSetting("phase5-test-key");
  assert.equal(await getSetting("phase5-test-key"), null);
});

await test("getPendingFolderId: DB wins over env; env is fallback; null when neither", async () => {
  const envBackup = process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID;
  try {
    process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID = "ENV_FOLDER";
    await deleteSetting(SETTING_KEYS.pendingFolderId);
    assert.deepEqual(await getPendingFolderId(), { value: "ENV_FOLDER", source: "env" });

    await setSetting(SETTING_KEYS.pendingFolderId, "DB_FOLDER");
    assert.deepEqual(await getPendingFolderId(), { value: "DB_FOLDER", source: "db" });

    delete process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID;
    await deleteSetting(SETTING_KEYS.pendingFolderId);
    assert.deepEqual(await getPendingFolderId(), { value: null, source: null });
  } finally {
    if (envBackup === undefined) delete process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID = envBackup;
  }
});

// ---------------------------------------------------------------------------
// Drive folder test + scan use the mocked client (no live Drive)
// ---------------------------------------------------------------------------

await test("testPendingFolder passes with mocked Drive client and persists last-test", async () => {
  const { client } = mockDriveClient({ folderName: "Pending Batches" });
  __setDriveClientForTests(client);
  try {
    const result = await testPendingFolder("FOLDER_ABC");
    assert.equal(result.ok, true);
    assert.equal(result.folderName, "Pending Batches");
    assert.equal(result.folderCount, 2);
    await setPendingFolderLastTest(result);
    const persisted = await getPendingFolderLastTest();
    assert.equal(persisted?.ok, true);
    assert.equal(persisted?.folderId, "FOLDER_ABC");
  } finally {
    __resetDriveClientForTests();
  }
});

await test("testPendingFolder reports failure without throwing", async () => {
  const { client } = mockDriveClient({ failGet: true });
  __setDriveClientForTests(client);
  try {
    const result = await testPendingFolder("BAD_FOLDER");
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /404/);
  } finally {
    __resetDriveClientForTests();
  }
});

await test("listBatchFolders uses the persisted folder ID (DB over env)", async () => {
  const { client, calls } = mockDriveClient();
  __setDriveClientForTests(client);
  try {
    process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID = "ENV_FOLDER";
    await setSetting(SETTING_KEYS.pendingFolderId, "DB_FOLDER_XYZ");
    const folders = await listBatchFolders();
    assert.equal(folders.length, 2);
    assert.ok(calls.listQueries[0].includes("'DB_FOLDER_XYZ' in parents"), calls.listQueries[0]);
  } finally {
    __resetDriveClientForTests();
    delete process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID;
    await deleteSetting(SETTING_KEYS.pendingFolderId);
  }
});

await test("getConnectionInfo reports connected under the test seam without token file", async () => {
  const { client } = mockDriveClient();
  __setDriveClientForTests(client);
  try {
    assert.equal((await getConnectionInfo()).connected, true);
  } finally {
    __resetDriveClientForTests();
  }
});

// ---------------------------------------------------------------------------
// Settings status: redaction, tokenState, readiness, duplicates
// ---------------------------------------------------------------------------

await test("settings status redacts tokens and derives per-store state", async () => {
  const connected = await prisma.store.create({
    data: {
      name: `${TAG}-connected`,
      driveFolderName: `${TAG}-Store_X`,
      skuPrefix: "PX",
      etsyShopId: "111",
      etsyShopName: "Phase5 Shop",
      accessToken: "SECRET_ACCESS_TOKEN_VALUE",
      refreshToken: "SECRET_REFRESH_TOKEN_VALUE",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await prisma.storeEtsyIds.create({
    data: { storeId: connected.id, taxonomyId: "1", shippingProfileId: "2", readinessStateId: null },
  });
  await prisma.store.create({
    data: { name: `${TAG}-bare`, driveFolderName: `${TAG}-Store_Y`, skuPrefix: "PY" },
  });

  const status = await getBatchlySettingsStatus();
  const raw = JSON.stringify(status);
  assert.ok(!raw.includes("SECRET_ACCESS_TOKEN_VALUE"), "leaked accessToken");
  assert.ok(!raw.includes("SECRET_REFRESH_TOKEN_VALUE"), "leaked refreshToken");

  const sx = status.etsy.stores.find(s => s.name === `${TAG}-connected`);
  assert.ok(sx);
  assert.equal(sx.connected, true);
  assert.equal(sx.tokenState, "ok");
  assert.equal(sx.shopName, "Phase5 Shop");
  assert.deepEqual(sx.readinessMissing, ["readinessStateId"]);

  const sy = status.etsy.stores.find(s => s.name === `${TAG}-bare`);
  assert.ok(sy);
  assert.equal(sy.connected, false);
  assert.equal(sy.tokenState, "none");
  assert.equal(sy.hasEtsyIds, false);
});

await test("duplicate driveFolderName detection (pure helper — DB has @unique)", () => {
  const duplicates = findDuplicateDriveFolders([
    { id: "1", name: "A", driveFolderName: "Store_A" },
    { id: "2", name: "B", driveFolderName: "Store_A" },
    { id: "3", name: "C", driveFolderName: "Store_B" },
  ]);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].driveFolderName, "Store_A");
  assert.equal(duplicates[0].stores.length, 2);
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

await test("guardrails: SQLite DATABASE_URL in production → DATABASE_URL_SQLITE error", () => {
  const warnings = computeProductionWarnings({
    NODE_ENV: "production",
    INQUEUE_SESSION_SECRET: "x".repeat(40),
    DATABASE_URL: "file:./dev.db",
    ETSY_CLIENT_ID: "id",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    ETSY_REDIRECT_URI: "https://batchly.example.com/api/auth/etsy/callback",
    GOOGLE_REDIRECT_URI: "https://batchly.example.com/api/auth/google/callback",
  });
  assert.equal(warnings.length, 1, JSON.stringify(warnings));
  assert.equal(warnings[0].code, "DATABASE_URL_SQLITE");
  assert.equal(warnings[0].level, "error");
});

await test("guardrails: localhost redirect URIs in production → errors", () => {
  const warnings = computeProductionWarnings({
    NODE_ENV: "production",
    INQUEUE_SESSION_SECRET: "x".repeat(40),
    DATABASE_URL: "postgresql://u:p@host/db",
    ETSY_CLIENT_ID: "id",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    ETSY_REDIRECT_URI: "http://localhost:3030/api/auth/etsy/callback",
    GOOGLE_REDIRECT_URI: "http://127.0.0.1:3030/api/auth/google/callback",
  });
  assert.ok(warnings.find(w => w.code === "ETSY_REDIRECT_URI_LOCALHOST"));
  assert.ok(warnings.find(w => w.code === "GOOGLE_REDIRECT_URI_LOCALHOST"));
});

await test("guardrails: clean production env → no warnings; dev missing creds → warns only", () => {
  const clean = computeProductionWarnings({
    NODE_ENV: "production",
    INQUEUE_SESSION_SECRET: "x".repeat(40),
    DATABASE_URL: "postgresql://u:p@host/db",
    ETSY_CLIENT_ID: "id",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    ETSY_REDIRECT_URI: "https://b.example.com/cb",
    GOOGLE_REDIRECT_URI: "https://b.example.com/cb",
  });
  assert.deepEqual(clean, []);

  const dev = computeProductionWarnings({ NODE_ENV: "development" });
  assert.ok(dev.every(w => w.level === "warn"), JSON.stringify(dev));
});

// ---------------------------------------------------------------------------
// Static safety: the new settings surface imports no draft-creation code
// ---------------------------------------------------------------------------

await test("settings routes/components contain no draft-creation calls", () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const files = [
    "src/app/api/settings/app/route.ts",
    "src/app/api/settings/status/route.ts",
    "src/app/api/drive/test-folder/route.ts",
    "src/app/api/drive/disconnect/route.ts",
    "src/lib/services/settingsStatus.ts",
    "src/lib/services/appSettings.ts",
    "src/components/settings/DrivePendingFolderCard.tsx",
    "src/components/settings/EtsyStoresSummary.tsx",
    "src/components/settings/ProductionWarningsBanner.tsx",
  ];
  const forbidden = [
    "createDraftListing",
    "draft-from-manifest",
    "mini-batch-create",
    "batchRunService",
    "uploadListingImage",
    "updateListingInventory",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const needle of forbidden) {
      assert.ok(!source.includes(needle), `${file} references ${needle}`);
    }
  }
});

await cleanup();
await prisma.$disconnect();

console.log("");
if (failed) { console.error(`Phase 5 Batchly settings tests: FAILED (${failed})`); process.exit(1); }
console.log("Phase 5 Batchly settings tests: OK");
