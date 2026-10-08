// Etsy production rules: physical-listing titles (no file-format vocabulary),
// hard 20-char tag limit, and the image-prompt spelling checklist.
//
// Run: node --test inkly/tests/etsy-listing-rules.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { scrubDigitalTerms, containsDigitalTerm, normalizeListingTitle } from "../lib/listingTitle.js";
import { heuristicListingMetadata } from "../lib/openaiClient.js";
import { buildImagePrompt } from "../lib/designRules.js";

test("scrubDigitalTerms removes file-format words and tidies punctuation", () => {
  assert.equal(
    scrubDigitalTerms("Inspirational 'God Is Good' Christian Faith T-Shirt Design PNG"),
    "Inspirational 'God Is Good' Christian Faith T-Shirt Design",
  );
  assert.equal(scrubDigitalTerms("Mama Mode Shirt, PNG, Gift for Mom"), "Mama Mode Shirt, Gift for Mom");
  assert.equal(scrubDigitalTerms("Trendy Tee Digital Download"), "Trendy Tee");
  assert.equal(scrubDigitalTerms("Sublimation DTF Printable Shirt"), "Shirt");
  // Whole-word only: innocent words that merely contain a banned substring stay.
  assert.equal(scrubDigitalTerms("Downtown Profile Shirt"), "Downtown Profile Shirt");
  // Idempotent on clean titles.
  assert.equal(scrubDigitalTerms("Camp Hair Don't Care Tee"), "Camp Hair Don't Care Tee");
});

test("containsDigitalTerm matches whole words only", () => {
  assert.equal(containsDigitalTerm("transparent png"), true);
  assert.equal(containsDigitalTerm("dtf transfer design"), true);
  assert.equal(containsDigitalTerm("downtown vibes shirt"), false);
});

test("heuristic listing: title has no digital vocabulary and tags obey Etsy limits", () => {
  const brief = {
    mainPhrase: "GOD IS GOOD ALL THE TIME",
    niche: "christian faith",
    targetBuyer: "faith-centered shoppers",
    printStyle: "modern minimal",
  };
  const { title, keywords } = heuristicListingMetadata(brief, {});

  assert.equal(containsDigitalTerm(title), false, `title contains digital term: ${title}`);
  assert.equal(title, normalizeListingTitle(title), "title should be normalized title case");
  assert.ok(title.length <= 140);

  assert.equal(keywords.length, 13);
  const seen = new Set();
  for (const tag of keywords) {
    assert.ok(tag.length <= 20, `tag over 20 chars: "${tag}" (${tag.length})`);
    assert.ok(tag.length >= 3, `tag too short: "${tag}"`);
    assert.equal(tag, tag.toLowerCase(), `tag not lowercase: "${tag}"`);
    assert.equal(containsDigitalTerm(tag), false, `digital term in tag: "${tag}"`);
    assert.ok(!seen.has(tag), `duplicate tag: "${tag}"`);
    seen.add(tag);
    assert.ok(!/^printable shirt \d+$/.test(tag), "numbered filler tags must be gone");
  }
});

test("image prompt enumerates a word-by-word spelling checklist and bans extra text", () => {
  const prompt = buildImagePrompt(
    { mainPhrase: "GOD IS GOOD", supportingText: "ALL THE TIME", subText: "WALK BY FAITH", layout: "retro_stack" },
    "on",
  );
  for (const word of ["\"GOD\"", "\"IS\"", "\"GOOD\"", "\"ALL\"", "\"THE\"", "\"TIME\"", "\"WALK\"", "\"BY\"", "\"FAITH\""]) {
    assert.ok(prompt.includes(word), `checklist missing ${word}`);
  }
  assert.match(prompt, /ONLY the text given above/);
  assert.match(prompt, /no dropped, doubled, merged, or extra letters/i);
  assert.match(prompt, /Small sub text: "WALK BY FAITH"/);
});
