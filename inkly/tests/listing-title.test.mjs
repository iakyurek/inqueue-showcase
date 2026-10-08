import assert from "node:assert/strict";
import test from "node:test";

import { normalizeListingTitle } from "../lib/listingTitle.js";

test("an all-caps generated title becomes natural title case", () => {
  const input = "TRENDY MAMA T-SHIRT DESIGN WITH STYLISH BOUTIQUE AESTHETIC";
  assert.equal(
    normalizeListingTitle(input),
    "Trendy Mama T-Shirt Design with Stylish Boutique Aesthetic",
  );
});

test("a mixed over-capitalized title loses shouting and over-capitalized connectors", () => {
  const input = "Trendy MAMA T-Shirt Design With Stylish Boutique Aesthetic For Modern Moms";
  assert.equal(
    normalizeListingTitle(input),
    "Trendy Mama T-Shirt Design with Stylish Boutique Aesthetic for Modern Moms",
  );
});

test("minor words are capitalized when they are the first or last word", () => {
  assert.equal(normalizeListingTitle("THE BEST GIFT FOR"), "The Best Gift For");
  assert.equal(normalizeListingTitle("for the win"), "For the Win");
});

test("domain acronyms stay uppercase, connectors stay lowercase", () => {
  assert.equal(
    normalizeListingTitle("retro sunset png design for dtf and svg cut files"),
    "Retro Sunset PNG Design for DTF and SVG Cut Files",
  );
});

test("commas and apostrophes are preserved with correct casing", () => {
  assert.equal(
    normalizeListingTitle("MAMA'S BOY SHIRT, BOLD PNG DESIGN, GIFT FOR HER"),
    "Mama's Boy Shirt, Bold PNG Design, Gift for Her",
  );
});

test("hyphenated compounds capitalize each side", () => {
  assert.equal(normalizeListingTitle("one-of-a-kind tee"), "One-Of-A-Kind Tee");
  assert.equal(normalizeListingTitle("T-SHIRT"), "T-Shirt");
});

test("normalization is idempotent", () => {
  const clean = "Trendy Mama T-Shirt Design with Stylish Boutique Aesthetic for Modern Moms";
  assert.equal(normalizeListingTitle(clean), clean);
});

test("empty and whitespace-only titles collapse to an empty string", () => {
  assert.equal(normalizeListingTitle(""), "");
  assert.equal(normalizeListingTitle("   "), "");
  assert.equal(normalizeListingTitle(null), "");
  assert.equal(normalizeListingTitle(undefined), "");
});

test("collapses runs of whitespace", () => {
  assert.equal(normalizeListingTitle("  hello    WORLD  "), "Hello World");
});
