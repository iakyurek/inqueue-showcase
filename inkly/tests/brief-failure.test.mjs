// Brief-generation failure policy: a failed or unconfigured brief step must
// throw BRIEF_GENERATION_FAILED instead of silently typesetting the raw
// prompt as the shirt's main phrase (the image prompt says "spell exactly").
// The heuristic fallback is allowed only in USE_PLACEHOLDER_IMAGES mode.
//
// Run: node inkly/tests/brief-failure.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

const PROMPT = "Create a Transparent PNG T-Shirt Design for a Trendy Christian Faith-Based Shirt";
const inputs = { prompt: PROMPT, designPhrase: "", niche: "" };

delete process.env.OPENAI_API_KEY; // no client in any of these tests

const { generateBrief, analyzeReference, planDesignBriefs } = await import("../lib/openaiClient.js");

test("generateBrief without a key throws instead of using the raw prompt", async () => {
  delete process.env.USE_PLACEHOLDER_IMAGES;
  await assert.rejects(
    () => generateBrief({ inputs, copyrightFilter: "on" }),
    (err) => err.code === "BRIEF_GENERATION_FAILED" && err.statusCode === 502,
  );
});

test("analyzeReference without a key throws the same coded error", async () => {
  delete process.env.USE_PLACEHOLDER_IMAGES;
  await assert.rejects(
    () => analyzeReference({ imageBase64: "aGk=", inputs, copyrightFilter: "on" }),
    (err) => err.code === "BRIEF_GENERATION_FAILED",
  );
});

test("planDesignBriefs without a key throws the same coded error", async () => {
  delete process.env.USE_PLACEHOLDER_IMAGES;
  await assert.rejects(
    () => planDesignBriefs({ inputs, count: 5, copyrightFilter: "on" }),
    (err) => err.code === "BRIEF_GENERATION_FAILED",
  );
});

test("placeholder mode keeps the heuristic fallback for dev/tests", async () => {
  process.env.USE_PLACEHOLDER_IMAGES = "true";
  try {
    const brief = await generateBrief({ inputs, copyrightFilter: "on" });
    assert.equal(brief.mainPhrase, PROMPT.toUpperCase());
    const planned = await planDesignBriefs({ inputs, count: 3, copyrightFilter: "on" });
    assert.equal(planned.length, 3);
  } finally {
    delete process.env.USE_PLACEHOLDER_IMAGES;
  }
});
