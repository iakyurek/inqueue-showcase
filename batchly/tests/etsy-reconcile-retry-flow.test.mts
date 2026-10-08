// Phase 4: end-to-end retryFailedRows reconciliation flow.
//
// Seeds a synthetic BatchRun + one failed row + one connected Store into the
// existing SQLite dev.db, then calls retryFailedRows() with a mocked Etsy
// fetch that returns a matching draft. Verifies the row is adopted (status
// = recovered_existing_draft) rather than requeued for a fresh create.
//
// Cleans up its own DB rows on exit. No live Etsy calls (fetch is mocked).

import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  retryFailedRows,
} from "../src/lib/services/batchRunService";
import {
  __setEtsyFetchForTests,
  __resetEtsyFetchForTests,
  __setEtsySleepForTests,
  __resetEtsySleepForTests,
} from "../src/lib/services/etsy";

const TAG = "phase4-recon-flow";

async function cleanup() {
  await prisma.batchRunRow.deleteMany({ where: { batchFolder: { startsWith: TAG } } });
  await prisma.batchRunStore.deleteMany({ where: { run: { batchFolder: { startsWith: TAG } } } });
  await prisma.batchRun.deleteMany({ where: { batchFolder: { startsWith: TAG } } });
  await prisma.draftCreationRecord.deleteMany({ where: { batchFolder: { startsWith: TAG } } });
  await prisma.storeEtsyIds.deleteMany({ where: { store: { name: `${TAG}-store` } } });
  await prisma.store.deleteMany({ where: { name: `${TAG}-store` } });
}

async function main() {
  await cleanup();

  // Seed a "connected" test store (Etsy shop id + refresh token present).
  const store = await prisma.store.create({
    data: {
      name: `${TAG}-store`,
      // Row.storeFolder is looked up against Store.driveFolderName. Match them.
      driveFolderName: `${TAG}-store-folder`,
      skuPrefix: "TP",
      etsyShopId: "999999",
      etsyShopName: "Phase4 Test Shop",
      refreshToken: "test-refresh-token",
      accessToken: "test-valid-access",
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    },
  });
  await prisma.storeEtsyIds.create({
    data: {
      storeId: store.id,
      taxonomyId: "10101",
      shippingProfileId: "20202",
      readinessStateId: "30303",
    },
  });

  // Seed the run + one failed row (no listingId — the exact case Phase 4 fixes).
  const batchFolder = `${TAG}-BATCH-001`;
  const run = await prisma.batchRun.create({
    data: { batchFolder, status: "partial", totalStores: 1, totalRows: 1 },
  });
  const storeRun = await prisma.batchRunStore.create({
    data: { runId: run.id, storeFolder: `${TAG}-store-folder`, storeName: store.name, storeId: store.id, status: "failed" },
  });
  await prisma.batchRunRow.create({
    data: {
      runId: run.id, storeRunId: storeRun.id,
      storeFolder: `${TAG}-store-folder`, batchFolder,
      designId: "D001", sku: "TP17", title: "Cosmic Vibes",
      status: "failed",
      listingId: null,
      errors: JSON.stringify(["ETSY_API_ERROR: 500 — connection reset"]),
    },
  });

  // Mock Etsy: return a draft that matches by SKU.
  __setEtsySleepForTests(async () => {});
  __setEtsyFetchForTests(async (url) => {
    const u = String(url);
    if (u.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "reissued", expires_in: 3600 }), { status: 200 });
    }
    if (u.includes("/listings?state=draft")) {
      return new Response(JSON.stringify({
        results: [{ listing_id: 42424242, title: "Cosmic Vibes", state: "draft", sku: ["TP17"] }],
        count: 1,
      }), { status: 200 });
    }
    return new Response("", { status: 404 });
  });

  try {
    const result = await retryFailedRows(run.id);
    console.log("  retry result:", JSON.stringify(result));
    assert.equal(result.recoveredExistingDraftCount, 1, "expected one row to be adopted");
    assert.equal(result.retriableCount, 0, "no row should have been requeued");

    const row = await prisma.batchRunRow.findFirst({ where: { runId: run.id } });
    if (!row) throw new Error("row not found after retry");
    assert.strictEqual(row.status, "recovered_existing_draft", `got status=${row.status}`);
    assert.strictEqual(row.listingId, "42424242", `got listingId=${row.listingId}`);

    const record = await prisma.draftCreationRecord.findUnique({
      where: { storeId_batchFolder_designId: { storeId: store.id, batchFolder, designId: "D001" } },
    });
    assert.equal(record?.status, "recovered_existing_draft");
    assert.equal(record?.listingId, "42424242");
    console.log("  ok  retryFailedRows adopted existing Etsy draft by SKU (no duplicate created)");
  } finally {
    __resetEtsyFetchForTests();
    __resetEtsySleepForTests();
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
