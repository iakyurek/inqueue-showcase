// B5 tests — store driveFolderName uniqueness guard.
//
// Read-only: exercises the pure guard helpers and confirms the live seed data
// (incl. Store_A) passes. Creates NO Etsy drafts and touches NO Etsy tokens.
//
// Run: npx tsx scripts/test-store-integrity.ts
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import {
  findDuplicateDriveFolders,
  formatDuplicateStoreFolderError,
  assertUniqueStoreDriveFolders,
} from "../src/lib/services/storeIntegrity";

let passed = 0;
function ok(label: string) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log("B5 — store driveFolderName uniqueness");

  // 1) unique values pass (no duplicates reported)
  const unique = [
    { id: "1", name: "Store A", driveFolderName: "Store_A" },
    { id: "2", name: "Store B", driveFolderName: "Store_B" },
  ];
  assert.deepEqual(findDuplicateDriveFolders(unique), []);
  ok("unique driveFolderName values pass");

  // 2) duplicate is detected and error names the folder + both stores
  const dupes = [
    { id: "1", name: "Store A", driveFolderName: "Store_A" },
    { id: "2", name: "Rogue Store", driveFolderName: "Store_A" },
    { id: "3", name: "Store B", driveFolderName: "Store_B" },
  ];
  const found = findDuplicateDriveFolders(dupes);
  assert.equal(found.length, 1);
  assert.equal(found[0].driveFolderName, "Store_A");
  assert.equal(found[0].stores.length, 2);
  const message = formatDuplicateStoreFolderError(found);
  assert.match(message, /DUPLICATE_STORE_DRIVE_FOLDER/);
  assert.match(message, /Store_A/);
  assert.match(message, /Store A/);
  assert.match(message, /Rogue Store/);
  ok("duplicate driveFolderName is rejected and names the stores involved");

  // 3) empty/unassigned folders are not treated as conflicts
  assert.deepEqual(
    findDuplicateDriveFolders([
      { id: "1", name: "X", driveFolderName: "" },
      { id: "2", name: "Y", driveFolderName: "" },
    ]),
    [],
  );
  ok("empty driveFolderName values are not flagged as duplicates");

  // 4) live seed data passes the guard, and Store_A still resolves
  await assertUniqueStoreDriveFolders();
  ok("existing seed data passes assertUniqueStoreDriveFolders()");

  const storeA = await prisma.store.findUnique({ where: { driveFolderName: "Store_A" } });
  assert.ok(storeA, "Store_A must resolve via unique driveFolderName");
  assert.equal(storeA?.driveFolderName, "Store_A");
  ok("Store_A / NorthWindUS mapping resolves correctly");

  console.log(`\nB5: ${passed} checks passed.`);
}

main()
  .catch((error) => {
    console.error("\nB5 FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
