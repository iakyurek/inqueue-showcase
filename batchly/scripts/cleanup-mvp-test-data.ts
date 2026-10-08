/**
 * Safe cleanup of MVP test/demo data from the local Prisma/SQLite database.
 *
 * What it deletes:
 *   - BatchRun records (+ child BatchRunStore / BatchRunRow rows) where
 *     batchFolder matches a test/demo name pattern (see TEST_PATTERNS below)
 *
 * What it NEVER touches:
 *   - Store records (OAuth tokens, shop IDs, refresh tokens)
 *   - StoreEtsyIds records
 *   - GlobalListingPreset / GlobalVariationPreset / GlobalSupplementalImagePreset
 *   - DraftCreationRun / DraftCreationRecord (legacy draft flow)
 *   - Anything on Etsy (no API calls are made)
 *
 * Usage:
 *   npm run cleanup:test-data           — dry run (shows candidates, makes no changes)
 *   npm run cleanup:test-data -- --run  — actually deletes matching records
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PATTERNS = [
  /test/i,
  /demo/i,
  /mock/i,
  /sample/i,
  /fake/i,
  /dummy/i,
  /dev[_-]/i,
  /store[_-]?a[_-]test/i,
  /batch[_-]?test/i,
];

function isTestName(name: string): boolean {
  return TEST_PATTERNS.some((p) => p.test(name));
}

async function main() {
  const dryRun = !process.argv.includes("--run");

  if (dryRun) {
    console.log("DRY RUN — pass --run to actually delete\n");
  } else {
    console.log("LIVE RUN — will delete matching records\n");
  }

  // --- BatchRuns ---
  const allRuns = await prisma.batchRun.findMany({
    select: {
      id: true,
      batchFolder: true,
      status: true,
      created: true,
      startedAt: true,
      stores: { select: { id: true, storeFolder: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const testRuns = allRuns.filter((run) => isTestName(run.batchFolder));
  const realRuns = allRuns.filter((run) => !isTestName(run.batchFolder));

  console.log(`Total BatchRuns: ${allRuns.length}`);
  console.log(`  Test/demo candidates: ${testRuns.length}`);
  console.log(`  Real runs (preserved): ${realRuns.length}\n`);

  if (testRuns.length === 0) {
    console.log("No test BatchRuns found — nothing to clean.\n");
  } else {
    console.log("Test BatchRuns that will be deleted:");
    for (const run of testRuns) {
      const started = new Date(run.startedAt).toLocaleString();
      console.log(`  [${run.id.slice(0, 8)}] "${run.batchFolder}" — status:${run.status} created:${run.created} started:${started}`);
      for (const s of run.stores) {
        console.log(`    └ store: ${s.storeFolder} (id: ${s.id.slice(0, 8)})`);
      }
    }
    console.log();
  }

  if (realRuns.length > 0) {
    console.log("Real BatchRuns that will be preserved:");
    for (const run of realRuns) {
      console.log(`  [${run.id.slice(0, 8)}] "${run.batchFolder}" — status:${run.status}`);
    }
    console.log();
  }

  // --- DraftCreationRun / DraftCreationRecord (legacy) ---
  const legacyRunCount = await prisma.draftCreationRun.count();
  console.log(`Legacy DraftCreationRun records: ${legacyRunCount} (not touched by this script)`);

  if (dryRun) {
    console.log("\n--- DRY RUN complete. No changes made. ---");
    console.log("Re-run with --run to apply deletions.");
    await prisma.$disconnect();
    return;
  }

  // Perform deletions
  let deletedRuns = 0;
  for (const run of testRuns) {
    const storeRunIds = run.stores.map((s) => s.id);

    // Delete BatchRunRows for this run
    const rowsDeleted = await prisma.batchRunRow.deleteMany({
      where: { runId: run.id },
    });

    // Delete BatchRunStores
    const storesDeleted = await prisma.batchRunStore.deleteMany({
      where: { runId: run.id },
    });

    // Delete the BatchRun itself
    await prisma.batchRun.delete({ where: { id: run.id } });

    console.log(`Deleted BatchRun [${run.id.slice(0, 8)}] "${run.batchFolder}" — ${storesDeleted.count} stores, ${rowsDeleted.count} rows`);
    deletedRuns++;
    void storeRunIds; // used above for context only
  }

  console.log(`\nDone — deleted ${deletedRuns} BatchRun(s) and their child records.`);
  console.log("Store records, Etsy IDs, and presets were not touched.");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
