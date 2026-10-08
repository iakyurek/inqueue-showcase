/**
 * Manifest back-compat for the variation_profile column (no DB).
 * Run: npx tsx scripts/test-manifest-variation-profile.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManifest } from "../src/lib/services/manifest";

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).message}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-vp-"));
function write(name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

const BASE = "store_folder,design_id,sku,title,description,tags,price,product_type";
const ROW = "Store_A,D001,CU17,My Title,A description,tag1,34.99,PHYSICAL";

console.log("manifest variation_profile tests");

test("legacy manifest with NO variation_profile column -> front_sided, still parses", () => {
  const p = write("legacy.csv", `${BASE}\n${ROW}\n`);
  const r = parseManifest(p);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].variation_profile, "front_sided");
});

test("explicit double_sided value is preserved", () => {
  const p = write("double.csv", `${BASE},variation_profile\n${ROW},double_sided\n`);
  const r = parseManifest(p);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].variation_profile, "double_sided");
});

test("blank/whitespace variation_profile cell -> front_sided", () => {
  const p = write("blank.csv", `${BASE},variation_profile\n${ROW},   \n`);
  const r = parseManifest(p);
  assert.equal(r.rows[0].variation_profile, "front_sided");
});

test("case/space in value is normalized", () => {
  const p = write("case.csv", `${BASE},variation_profile\n${ROW}, Double_Sided \n`);
  const r = parseManifest(p);
  assert.equal(r.rows[0].variation_profile, "double_sided");
});

test("unknown value is preserved as-is (resolver rejects later, not the parser)", () => {
  const p = write("unknown.csv", `${BASE},variation_profile\n${ROW},triple_sided\n`);
  const r = parseManifest(p);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].variation_profile, "triple_sided");
});

fs.rmSync(dir, { recursive: true, force: true });
console.log("");
if (failed) { console.error(`manifest variation_profile tests: FAILED (${failed})`); process.exit(1); }
console.log("manifest variation_profile tests: OK");
