import path from "path";
import { validateBatchFolder } from "../src/lib/services/validator";

const batchName = process.argv[2];

if (!batchName) {
  console.error("Usage: npm run validate -- <batch-folder-name>");
  console.error('Example: npm run validate -- "Batch-001-Sample"');
  process.exit(1);
}

const folderPath = path.join(process.cwd(), "workspace", "sample-batches", batchName);

console.log(`\nValidating: ${folderPath}\n`);

async function main() {
  const result = await validateBatchFolder(folderPath);

  console.log(`Status:  ${result.valid ? "✅ VALID" : "❌ INVALID"}`);
  console.log(`Manifest rows:    ${result.manifestRowCount}`);
  console.log(`Stores found:     ${result.totalStoresFound}/${result.manifestStoreFolderCount}`);
  console.log(`Design folders:   ${result.totalDesignFoldersFound}`);
  console.log(`Images found:     ${result.totalImagesFound}`);
  console.log(`Errors:           ${result.errors.length}`);
  console.log(`Warnings:         ${result.warnings.length}`);

  if (result.errors.length > 0) {
    console.log("\n── ERRORS ──────────────────────────────────────────────────");
    for (const e of result.errors) {
      console.log(`  [${e.code}] ${e.message}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("\n── WARNINGS ─────────────────────────────────────────────────");
    for (const w of result.warnings) {
      console.log(`  [${w.code}] ${w.message}`);
    }
  }

  if (result.missingFolders.length > 0) {
    console.log("\n── MISSING FOLDERS ──────────────────────────────────────────");
    for (const f of result.missingFolders) console.log(`  ${f}`);
  }

  if (result.missingImages.length > 0) {
    console.log("\n── MISSING IMAGES ───────────────────────────────────────────");
    for (const m of result.missingImages) console.log(`  ${m}`);
  }

  console.log(`\nChecked at: ${result.checkedAt}\n`);
  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
