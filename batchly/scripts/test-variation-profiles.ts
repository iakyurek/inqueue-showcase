/**
 * Unit tests for the Batchly variation-profile resolver (no DB).
 * Run: npx tsx scripts/test-variation-profiles.ts
 */
import assert from "node:assert/strict";
import {
  normalizeVariationProfileKey,
  resolveVariationProfile,
  __setDefaultVariationProfilesForTests,
  DEFAULT_VARIATION_PROFILE,
  type VariationProfilesPayload,
} from "../src/lib/services/variationProfiles";
// Dev-only test: reach into the Hub's canonical builder (excluded from the app
// build) so we exercise the REAL synced payload, not just a hand-written stub.
import { buildVariationProfilesPayload } from "../../lib/variationProfiles/index.js";

// The exact payload the Hub pushes via config-sync.
const REAL_SYNCED = buildVariationProfilesPayload() as unknown as VariationProfilesPayload;

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).stack || (err as Error).message}`); }
}

// A SYNTHETIC payload where double_sided is deliberately left pending, used to
// prove the safety guard (a pending profile is rejected, never silently priced
// from front_sided). The real hub payload — where double_sided is complete — is
// exercised separately via REAL_SYNCED below.
const SYNCED: VariationProfilesPayload = {
  defaultProfileKey: "front_sided",
  profiles: [
    {
      key: "front_sided", label: "Front-sided design", version: 1, status: "complete",
      variation1: { name: "Style", options: [{}] }, variation2: { name: "Primary color", options: [{}] },
      offerings: [{ styleKey: "unisex_tee__s", styleLabel: "Unisex T-shirt- S", colorKey: "black", colorLabel: "Black", price: "34.99", quantity: 999, enabled: true }],
    },
    {
      key: "double_sided", label: "Double-sided design", version: 0, status: "pending",
      variation1: { name: "Style", options: [] }, variation2: { name: "Primary color", options: [] },
      offerings: [],
    },
  ],
};

async function main() {
  console.log("batchly variation-profile resolver tests");

  await test("normalize: empty/missing/whitespace/case -> front_sided default", () => {
    assert.equal(normalizeVariationProfileKey(""), DEFAULT_VARIATION_PROFILE);
    assert.equal(normalizeVariationProfileKey(null), DEFAULT_VARIATION_PROFILE);
    assert.equal(normalizeVariationProfileKey(undefined), DEFAULT_VARIATION_PROFILE);
    assert.equal(normalizeVariationProfileKey("  FRONT_SIDED "), "front_sided");
    assert.equal(normalizeVariationProfileKey("double_sided"), "double_sided");
  });

  await test("front_sided is usable even with NO synced profiles (existing behavior preserved)", async () => {
    __setDefaultVariationProfilesForTests(null);
    const r = await resolveVariationProfile("front_sided");
    assert.equal(r.usable, true);
    assert.equal(r.key, "front_sided");
    // Legacy manifest (blank) resolves to front_sided and is usable.
    const legacy = await resolveVariationProfile("");
    assert.equal(legacy.usable, true);
    assert.equal(legacy.key, "front_sided");
  });

  await test("double_sided is rejected when NOT synced (unrecognized)", async () => {
    __setDefaultVariationProfilesForTests(null);
    const r = await resolveVariationProfile("double_sided");
    assert.equal(r.usable, false);
    assert.match(r.reason!, /not recognized|not configured/i);
  });

  await test("double_sided is rejected when synced but pending (no silent front pricing)", async () => {
    __setDefaultVariationProfilesForTests(SYNCED);
    const r = await resolveVariationProfile("double_sided");
    assert.equal(r.usable, false);
    assert.match(r.reason!, /not configured yet|pending/i);
    assert.equal(r.profile?.status, "pending");
  });

  await test("unknown profile key is rejected", async () => {
    __setDefaultVariationProfilesForTests(SYNCED);
    const r = await resolveVariationProfile("triple_sided");
    assert.equal(r.usable, false);
    assert.match(r.reason!, /not recognized/i);
  });

  await test("front_sided remains usable when synced complete", async () => {
    __setDefaultVariationProfilesForTests(SYNCED);
    const r = await resolveVariationProfile("front_sided");
    assert.equal(r.usable, true);
    assert.equal(r.profile?.status, "complete");
  });

  await test("a would-be-complete double_sided becomes usable once synced complete", async () => {
    const completed: VariationProfilesPayload = JSON.parse(JSON.stringify(SYNCED));
    const ds = completed.profiles.find((p) => p.key === "double_sided")!;
    ds.status = "complete";
    ds.offerings = [{ styleKey: "unisex_tee__s", styleLabel: "Unisex T-shirt- S", colorKey: "black", colorLabel: "Black", price: "40.99", quantity: 999, enabled: true }];
    __setDefaultVariationProfilesForTests(completed);
    const r = await resolveVariationProfile("double_sided");
    assert.equal(r.usable, true);
  });

  // --- Against the REAL Hub payload (double_sided is now a complete matrix) ---

  await test("real synced double_sided resolves usable with 188 offerings", async () => {
    __setDefaultVariationProfilesForTests(REAL_SYNCED);
    const r = await resolveVariationProfile("double_sided");
    assert.equal(r.usable, true);
    assert.equal(r.key, "double_sided");
    assert.equal(r.profile?.status, "complete");
    assert.equal(r.profile?.offerings.length, 188);
    // A double_sided price must be its OWN tier, never borrowed from front_sided.
    const unisexS = r.profile!.offerings.find(
      (o) => o.styleLabel === "Unisex T-shirt- S" && o.colorLabel === "Black");
    assert.equal(unisexS?.price, "44.00");
  });

  await test("mixed batch: front_sided and double_sided each resolve independently", async () => {
    __setDefaultVariationProfilesForTests(REAL_SYNCED);
    const rows = ["front_sided", "double_sided", "", "  Double_Sided  "];
    const resolved = await Promise.all(rows.map((k) => resolveVariationProfile(k)));
    assert.equal(resolved[0].key, "front_sided"); assert.equal(resolved[0].usable, true);
    assert.equal(resolved[1].key, "double_sided"); assert.equal(resolved[1].usable, true);
    assert.equal(resolved[2].key, "front_sided"); assert.equal(resolved[2].usable, true); // legacy blank
    assert.equal(resolved[3].key, "double_sided"); assert.equal(resolved[3].usable, true); // case/space
    // Prices differ per profile — no cross-contamination.
    const f = resolved[0].profile!.offerings.find((o) => o.styleLabel === "Unisex T-shirt- S" && o.colorLabel === "Black");
    const d = resolved[1].profile!.offerings.find((o) => o.styleLabel === "Unisex T-shirt- S" && o.colorLabel === "Black");
    assert.equal(f?.price, "34.99");
    assert.equal(d?.price, "44.00");
  });

  await test("unknown key is still rejected against the real payload (no fallback)", async () => {
    __setDefaultVariationProfilesForTests(REAL_SYNCED);
    const r = await resolveVariationProfile("sparkly_sided");
    assert.equal(r.usable, false);
  });

  __setDefaultVariationProfilesForTests(null);
  console.log("");
  if (failed) { console.error(`variation-profile resolver tests: FAILED (${failed})`); process.exit(1); }
  console.log("variation-profile resolver tests: OK");
}

main();
