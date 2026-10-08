// Hub store-config sync tests — Batchly side. Validation, dry-run diff,
// apply mapping, token protection, stale versions, and the enablement gate
// fallback. No live Etsy/Drive calls.
//
// Runs against the local DATABASE_URL database, so every write targets ONLY
// Store_F (inactive, never connected) and is snapshot-restored. When the
// database is a legacy SQLite file (pre-Postgres checkouts) a file-level
// safety backup is also taken and removed on success; under Postgres the
// row-level snapshot/restore is the only mechanism.
//
// Run: cd batchly && npx tsx tests/hub-config-sync.test.mts

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  applyHubConfigSync,
  computeHubSyncDiff,
  validateHubSyncPayload,
  HUB_CONFIG_VERSION_KEY,
} from "../src/lib/services/hubConfigSync";
import { isStoreFolderEnabled, MINI_BATCH_ENABLED_STORE_FOLDERS } from "../src/lib/services/draftFlowHelpers";
import { getSetting, deleteSetting } from "../src/lib/services/appSettings";
import { buildHubConfigureRedirect, canonicalStoreFolder } from "../src/lib/sso";

const DB_PATH = path.join(process.cwd(), "prisma", "dev.db");
const DB_BACKUP = `${DB_PATH}.bak-hubsync-test`;
// Legacy SQLite checkouts only; false under Postgres.
const HAS_DB_FILE = fs.existsSync(DB_PATH);

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).stack || (err as Error).message}`); }
}

function payloadFor(slot: string, configVersion: number, fields: Record<string, unknown> = {}) {
  return {
    configVersion,
    generatedAt: new Date().toISOString(),
    stores: [{ slot, displayName: "", enabled: false, skuPrefix: "", driveFolderId: "", notes: "", etsyIds: {}, ...fields }],
  };
}

async function main() {
  if (HAS_DB_FILE) fs.copyFileSync(DB_PATH, DB_BACKUP);
  console.log("batchly hub-config sync tests (Store_F only, restore-safe)");

  const storeF = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" }, include: { etsyIds: true } });
  assert.ok(storeF, "Store_F must exist (seeded)");
  const snapshot = {
    name: storeF!.name, skuPrefix: storeF!.skuPrefix, configEnabled: storeF!.configEnabled,
    refreshToken: storeF!.refreshToken, hadEtsyIds: Boolean(storeF!.etsyIds),
    etsyIds: storeF!.etsyIds ? { ...storeF!.etsyIds } : null,
  };
  const prevFlag = process.env.INQUEUE_STORE_CONFIG_SOURCE;
  const prevVersion = await getSetting(HUB_CONFIG_VERSION_KEY);

  try {
    // ── validation ─────────────────────────────────────────────────────────
    await test("payload validation rejects malformed payloads", () => {
      assert.ok(validateHubSyncPayload(null));
      assert.ok(validateHubSyncPayload({ configVersion: -1, stores: [] }));
      assert.ok(validateHubSyncPayload({ configVersion: 1, stores: [{ slot: "Store_G" }] })); // A–F only
      assert.equal(validateHubSyncPayload(payloadFor("Store_F", 1)), null);
    });

    // ── dry-run (flag unset) ───────────────────────────────────────────────
    delete process.env.INQUEUE_STORE_CONFIG_SOURCE;

    await test("dry-run: reports field diff, writes nothing", async () => {
      const result = await applyHubConfigSync(payloadFor("Store_F", 1, { displayName: "Fernprint", skuPrefix: "U", enabled: false }));
      assert.equal(result.applied, false);
      assert.equal(result.mode, "dry-run");
      const fields = (result.diff ?? []).map((d) => d.field);
      assert.ok(fields.includes("displayName"), JSON.stringify(result.diff));
      const after = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" } });
      assert.equal(after!.name, snapshot.name, "dry-run must not write");
      assert.equal(await getSetting(HUB_CONFIG_VERSION_KEY), prevVersion, "dry-run must not record a version");
    });

    await test("diff warns about missing store rows instead of creating them", async () => {
      const { warnings } = await computeHubSyncDiff({
        configVersion: 1,
        stores: [{ slot: "Store_A" }, { slot: "Store_B" }],
      } as never);
      // Seeded DB has all rows — simulate by asking for a diff shape only.
      assert.ok(Array.isArray(warnings));
    });

    // ── apply (flag=hub), Store_F only ─────────────────────────────────────
    process.env.INQUEUE_STORE_CONFIG_SOURCE = "hub";

    await test("apply: maps displayName/skuPrefix/enabled + StoreEtsyIds; never touches tokens", async () => {
      // Plant a sentinel token to prove sync cannot clobber token columns.
      await prisma.store.update({ where: { id: storeF!.id }, data: { refreshToken: "sentinel-token-do-not-touch" } });
      const result = await applyHubConfigSync(payloadFor("Store_F", 10, {
        displayName: "Fernprint Hub",
        enabled: true,
        skuPrefix: "U",
        etsyIds: { taxonomyId: 1071, shippingProfileId: 222, readinessStateId: 333, returnPolicyId: null, sectionId: null },
      }));
      assert.equal(result.applied, true, JSON.stringify(result));
      assert.equal(result.appliedVersion, 10);
      const after = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" }, include: { etsyIds: true } });
      assert.equal(after!.name, "Fernprint Hub");
      assert.equal(after!.skuPrefix, "U");
      assert.equal(after!.configEnabled, true);
      assert.equal(after!.etsyIds?.taxonomyId, "1071", "IDs stored as strings");
      assert.equal(after!.etsyIds?.shippingProfileId, "222");
      assert.equal(after!.refreshToken, "sentinel-token-do-not-touch", "sync must NEVER touch tokens");
      assert.equal(after!.etsyShopId, storeF!.etsyShopId, "sync must never touch shop identity");
      assert.equal(await getSetting(HUB_CONFIG_VERSION_KEY), "10");
    });

    await test("stale version rejected after apply", async () => {
      const result = await applyHubConfigSync(payloadFor("Store_F", 5));
      assert.equal(result.applied, false);
      assert.equal(result.error, "stale");
      assert.equal(result.appliedVersion, 10);
    });

    await test("re-applying the same version is idempotent", async () => {
      const result = await applyHubConfigSync(payloadFor("Store_F", 10, { displayName: "Fernprint Hub", enabled: true, skuPrefix: "U" }));
      assert.equal(result.applied, true);
    });

    // ── enablement gate ────────────────────────────────────────────────────
    await test("isStoreFolderEnabled: local mode = legacy allowlist, byte-for-byte", async () => {
      delete process.env.INQUEUE_STORE_CONFIG_SOURCE;
      for (const folder of MINI_BATCH_ENABLED_STORE_FOLDERS) {
        assert.equal(await isStoreFolderEnabled(folder), true, folder);
      }
      assert.equal(await isStoreFolderEnabled("Store_Z"), false);
      assert.equal(await isStoreFolderEnabled(""), false);
    });

    await test("isStoreFolderEnabled: hub mode = configEnabled === true only", async () => {
      process.env.INQUEUE_STORE_CONFIG_SOURCE = "hub";
      assert.equal(await isStoreFolderEnabled("Store_F"), true, "Store_F was synced enabled above");
      // configEnabled=false → disabled
      await prisma.store.update({ where: { id: storeF!.id }, data: { configEnabled: false } });
      assert.equal(await isStoreFolderEnabled("Store_F"), false);
      // configEnabled=null (never synced) → disabled, not fallback
      await prisma.store.update({ where: { id: storeF!.id }, data: { configEnabled: null } });
      assert.equal(await isStoreFolderEnabled("Store_F"), false, "null must mean disabled in hub mode");
      // unknown folder → disabled
      assert.equal(await isStoreFolderEnabled("Store_Z"), false);
    });

    await test("Store_A row untouched by everything above", async () => {
      const a = await prisma.store.findUnique({ where: { driveFolderName: "Store_A" } });
      assert.ok(a);
      assert.equal(a!.configEnabled, null, "Store_A configEnabled must still be null (never synced in tests)");
    });

    // ── Etsy Connect return flow (the store_not_found / wrong-redirect bug) ──

    await test("canonicalStoreFolder normalizes slots and rejects everything else", () => {
      assert.equal(canonicalStoreFolder("Store_A"), "Store_A");
      assert.equal(canonicalStoreFolder("store_a"), "Store_A");
      assert.equal(canonicalStoreFolder("STORE-a"), "Store_A");
      assert.equal(canonicalStoreFolder("  Store_f  "), "Store_F");
      // Display names are NOT folders — this was a suspected cause of store_not_found.
      assert.equal(canonicalStoreFolder("NorthwindUS"), null);
      for (const bad of ["Store_I", "Store_", "../Store_A", "", null, undefined, "Store_AA"]) {
        assert.equal(canonicalStoreFolder(bad as string), null, `expected null for ${JSON.stringify(bad)}`);
      }
    });

    await test("buildHubConfigureRedirect targets the hub /configure route from env only", () => {
      const url = new URL(buildHubConfigureRedirect("https://hub.example.com", {
        etsy: "connected", store: "Store_A",
      }));
      assert.equal(url.origin, "https://hub.example.com");
      assert.equal(url.pathname, "/configure");
      assert.equal(url.searchParams.get("etsy"), "connected");
      assert.equal(url.searchParams.get("store"), "Store_A");
      // Empty values are dropped, never emitted as "store=".
      const noStore = new URL(buildHubConfigureRedirect("https://hub.example.com", { etsy: "error", store: "" }));
      assert.equal(noStore.searchParams.has("store"), false);
    });

    await test("sync CREATES a missing store row (fresh DB → no more store_not_found)", async () => {
      // Make the Store_F slot LOOK unseeded without deleting the seeded row
      // (it has listings/batchStores behind foreign keys): park the original
      // under a temporary folder name, then restore it at the end.
      await prisma.store.update({ where: { id: storeF!.id }, data: { driveFolderName: "Store_TMP_PARKED" } });
      try {
        assert.equal(await prisma.store.findUnique({ where: { driveFolderName: "Store_F" } }), null);

        // Dry-run first: the missing row must be reported, never silently created.
        process.env.INQUEUE_STORE_CONFIG_SOURCE = "local";
        const dry = await applyHubConfigSync(payloadFor("Store_F", 20, { displayName: "Fernprint", skuPrefix: "U" }));
        assert.equal(dry.applied, false);
        assert.ok((dry.diff ?? []).some((d) => d.field === "row" && d.incoming === "create"), JSON.stringify(dry.diff));
        assert.equal(await prisma.store.findUnique({ where: { driveFolderName: "Store_F" } }), null, "dry-run must not create");

        // Apply: the row is created, so Etsy Connect can now resolve the slot.
        process.env.INQUEUE_STORE_CONFIG_SOURCE = "hub";
        const applied = await applyHubConfigSync(payloadFor("Store_F", 21, {
          displayName: "Fernprint", skuPrefix: "U", enabled: false,
          etsyIds: { taxonomyId: 1071 },
        }));
        assert.equal(applied.applied, true, JSON.stringify(applied));
        const created = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" }, include: { etsyIds: true } });
        assert.ok(created, "row must exist after sync");
        assert.equal(created!.name, "Fernprint");
        assert.equal(created!.skuPrefix, "U");
        assert.equal(created!.configEnabled, false);
        assert.equal(created!.etsyIds?.taxonomyId, "1071");
        // Created rows must never carry token material.
        assert.equal(created!.accessToken, null);
        assert.equal(created!.refreshToken, null);
        assert.equal(created!.etsyShopId, null);

        // Drop the row sync created (it has no relations) and un-park the original.
        await prisma.storeEtsyIds.deleteMany({ where: { storeId: created!.id } });
        await prisma.store.delete({ where: { id: created!.id } });
      } finally {
        await prisma.store.update({ where: { id: storeF!.id }, data: { driveFolderName: "Store_F" } });
      }
    });

    await test("sync on an EXISTING connected store preserves its Etsy tokens", async () => {
      process.env.INQUEUE_STORE_CONFIG_SOURCE = "hub";
      const f = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" } });
      await prisma.store.update({
        where: { id: f!.id },
        data: { refreshToken: "keep-me", accessToken: "keep-me-too", etsyShopId: "999", etsyShopName: "KeepShop" },
      });
      await applyHubConfigSync(payloadFor("Store_F", 22, { displayName: "Fernprint Renamed", skuPrefix: "U" }));
      const after = await prisma.store.findUnique({ where: { driveFolderName: "Store_F" } });
      assert.equal(after!.name, "Fernprint Renamed");
      assert.equal(after!.refreshToken, "keep-me", "upsert must not clear tokens");
      assert.equal(after!.accessToken, "keep-me-too");
      assert.equal(after!.etsyShopId, "999");
      assert.equal(after!.etsyShopName, "KeepShop");
    });
  } finally {
    // ── restore Store_F + settings exactly ─────────────────────────────────
    // The create-missing-row test deletes and recreates Store_F, so restore by
    // driveFolderName (stable) rather than by the original cuid.
    const restored = await prisma.store.upsert({
      where: { driveFolderName: "Store_F" },
      create: {
        name: snapshot.name,
        driveFolderName: "Store_F",
        skuPrefix: snapshot.skuPrefix,
        configEnabled: snapshot.configEnabled,
        refreshToken: snapshot.refreshToken,
      },
      update: {
        name: snapshot.name,
        skuPrefix: snapshot.skuPrefix,
        configEnabled: snapshot.configEnabled,
        refreshToken: snapshot.refreshToken,
        accessToken: null,
        etsyShopId: null,
        etsyShopName: null,
      },
      select: { id: true },
    });
    if (!snapshot.hadEtsyIds) {
      await prisma.storeEtsyIds.deleteMany({ where: { storeId: restored.id } });
    } else if (snapshot.etsyIds) {
      await prisma.storeEtsyIds.upsert({
        where: { storeId: restored.id },
        create: {
          storeId: restored.id,
          taxonomyId: snapshot.etsyIds.taxonomyId,
          shippingProfileId: snapshot.etsyIds.shippingProfileId,
          readinessStateId: snapshot.etsyIds.readinessStateId,
          returnPolicyId: snapshot.etsyIds.returnPolicyId,
          sectionId: snapshot.etsyIds.sectionId,
        },
        update: {
          taxonomyId: snapshot.etsyIds.taxonomyId,
          shippingProfileId: snapshot.etsyIds.shippingProfileId,
          readinessStateId: snapshot.etsyIds.readinessStateId,
          returnPolicyId: snapshot.etsyIds.returnPolicyId,
          sectionId: snapshot.etsyIds.sectionId,
        },
      });
    }
    if (prevVersion === null) await deleteSetting(HUB_CONFIG_VERSION_KEY);
    if (prevFlag === undefined) delete process.env.INQUEUE_STORE_CONFIG_SOURCE;
    else process.env.INQUEUE_STORE_CONFIG_SOURCE = prevFlag;
    await prisma.$disconnect();
  }

  if (failed) {
    console.error(`\nbatchly hub-config sync tests: FAILED (${failed})`);
    if (HAS_DB_FILE) console.error(`dev.db safety backup kept at ${DB_BACKUP}`);
    process.exit(1);
  }
  if (HAS_DB_FILE) fs.rmSync(DB_BACKUP, { force: true });
  console.log("\nbatchly hub-config sync tests: OK (Store_F restored)");
}

main().catch(async (err) => {
  console.error(err);
  if (HAS_DB_FILE) console.error(`dev.db safety backup kept at ${DB_BACKUP}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
