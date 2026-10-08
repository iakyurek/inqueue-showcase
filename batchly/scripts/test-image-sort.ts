// H1 tests — numeric-aware image sorting for Etsy upload order.
//
// Read-only against Etsy: exercises findImagesForDesign against a throwaway
// batch folder under workspace/downloads. Creates NO Etsy drafts, no Etsy calls.
//
// Run: npx tsx scripts/test-image-sort.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { findImagesForDesign } from "../src/lib/services/draftFlowHelpers";
import { listSizeChartImages } from "../src/lib/services/supplementalImageHelpers";

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");
const SUPPLEMENTAL_ROOT = path.join(process.cwd(), "workspace", "supplemental-images");
const BATCH = `__H1_TEST_${Date.now()}`;
const STORE = "Store_A"; // Store_A / NorthWindUS mapping is unchanged
const DESIGN = "D001";
const imageDir = path.join(DOWNLOADS_DIR, BATCH, STORE, DESIGN);
const SC_REL = path.join("__h1_size_charts", String(Date.now()));
const scDir = path.join(SUPPLEMENTAL_ROOT, SC_REL);

let passed = 0;
function ok(label: string) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function main() {
  console.log("H1 — numeric image sorting");

  fs.mkdirSync(imageDir, { recursive: true });
  // Write in scrambled order; filesystem readdir order is not guaranteed.
  const scrambled = ["CU17_10.jpg", "CU17_2.jpg", "CU17_1.jpg", "CU17_5.jpg", "CU17_9.jpg", "CU17_3.jpg", "CU17_4.jpg", "CU17_8.jpg", "CU17_6.jpg", "CU17_7.jpg"];
  for (const name of scrambled) fs.writeFileSync(path.join(imageDir, name), "x");

  try {
    const images = findImagesForDesign(BATCH, STORE, DESIGN);
    const expected = Array.from({ length: 10 }, (_, i) => `CU17_${i + 1}.jpg`);

    assert.deepEqual(images, expected);
    ok("10 mockups sort in numeric order (_1 … _10)");

    const idx10 = images.indexOf("CU17_10.jpg");
    const idx2 = images.indexOf("CU17_2.jpg");
    assert.ok(idx2 < idx10, "_2 must come before _10");
    ok("_10.jpg does not come before _2.jpg");

    // Store_A path resolved correctly (design images found under Store_A/D001).
    assert.equal(images.length, 10);
    ok("Store_A / NorthWindUS design folder resolves (Store_A/D001)");

    // Size charts must be numerically ordered too (they are concatenated AFTER
    // mockups by batchRunService, so mockups-first ordering is preserved).
    fs.mkdirSync(scDir, { recursive: true });
    for (const name of ["size-chart-10.png", "size-chart-2.png", "size-chart-1.png"]) {
      fs.writeFileSync(path.join(scDir, name), "x");
    }
    const charts = listSizeChartImages({
      enabled: true,
      includeSizeCharts: true,
      includePromoImages: false,
      sizeChartFolder: path.relative(process.cwd(), scDir),
      promoFolder: "",
      maxSupplementalImages: 10,
    });
    assert.deepEqual(charts.map((c) => c.basename), ["size-chart-1.png", "size-chart-2.png", "size-chart-10.png"]);
    ok("size charts are numerically ordered and come after mockups");

    console.log(`\nH1: ${passed} checks passed.`);
  } finally {
    fs.rmSync(path.join(DOWNLOADS_DIR, BATCH), { recursive: true, force: true });
    fs.rmSync(path.join(SUPPLEMENTAL_ROOT, "__h1_size_charts"), { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("\nH1 FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
