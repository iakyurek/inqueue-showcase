// Vision QA gate: every AI-generated design is reviewed against a hard rubric
// (structured per-check verdict + retail-grade quality score) plus a
// deterministic transparency check before it is saved; failures regenerate
// with feedback and eventually error instead of presenting a bad design.
//
// Run: node --test inkly/tests/design-qa.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  buildQAUserPrompt,
  normalizeQAResult,
  reviewDesign,
  checkTransparency,
  expectedWords,
  MIN_DESIGN_QUALITY,
} from "../lib/designQA.js";
import { buildImagePrompt } from "../lib/designRules.js";
import {
  generateArtwork,
  pickStyleReferences,
  __setOpenAIClientForTests,
} from "../lib/openaiClient.js";

process.env.USE_PLACEHOLDER_IMAGES = "false";
delete process.env.DESIGN_QA;
delete process.env.DESIGN_QA_MAX_ATTEMPTS;

const BRIEF = {
  mainPhrase: "SPAIN VS FRANCE",
  supportingText: "SEMIFINAL",
  subText: "WORLD SOCCER CHAMPIONSHIP",
  layout: "sports_badge",
};

const GOOD_VERDICT = {
  textRead: ["SPAIN"],
  spellingCorrect: true,
  extraText: false,
  overlapOrClipping: false,
  backgroundClean: true,
  designQuality: 9,
  problems: [],
};

// Transparent 200x200 canvas with an opaque 80x80 block: valid design PNG
// with ~16% alpha coverage — passes the baked-in-background check.
async function transparentDesignPng() {
  const block = await sharp({
    create: { width: 80, height: 80, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
  }).png().toBuffer();
  return sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: block, top: 60, left: 60 }]).png().toBuffer();
}

// Fully opaque canvas: a baked-in background panel.
function opaquePng() {
  return sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 240, g: 240, b: 230, alpha: 1 } },
  }).png().toBuffer();
}

function fakeClient({ verdicts, imageError = null, pngPromise }) {
  const calls = { imagePrompts: [], editCalls: 0, reviews: 0 };
  let v = 0;
  return {
    calls,
    images: {
      async generate(params) {
        if (imageError) throw new Error(imageError);
        calls.imagePrompts.push(params.prompt);
        const png = await pngPromise;
        return { data: [{ b64_json: png.toString("base64") }] };
      },
      async edit(params) {
        calls.editCalls += 1;
        return this.generate(params);
      },
    },
    chat: {
      completions: {
        async create() {
          calls.reviews += 1;
          const verdict = verdicts[Math.min(v++, verdicts.length - 1)];
          return { choices: [{ message: { content: JSON.stringify(verdict) } }] };
        },
      },
    },
  };
}

test.afterEach(() => __setOpenAIClientForTests(undefined));

test("QA user prompt enumerates every expected word", () => {
  const prompt = buildQAUserPrompt(BRIEF);
  for (const word of expectedWords(BRIEF)) {
    assert.ok(prompt.includes(`"${word}"`), `missing ${word}`);
  }
  assert.match(prompt, /exactly these words and nothing else/);
});

test("normalizeQAResult passes only a fully clean, retail-grade verdict", () => {
  const good = normalizeQAResult(GOOD_VERDICT);
  assert.equal(good.pass, true);
  assert.equal(good.designQuality, 9);

  // Each failed check sinks the verdict and yields actionable feedback.
  for (const bad of [
    { ...GOOD_VERDICT, spellingCorrect: false },
    { ...GOOD_VERDICT, extraText: true },
    { ...GOOD_VERDICT, overlapOrClipping: true },
    { ...GOOD_VERDICT, backgroundClean: false },
    { ...GOOD_VERDICT, designQuality: MIN_DESIGN_QUALITY - 1 },
  ]) {
    const out = normalizeQAResult(bad);
    assert.equal(out.pass, false);
    assert.ok(out.problems.length >= 1, "failed verdicts must carry problems");
  }

  // Malformed replies fail closed with a synthesized problem.
  const malformed = normalizeQAResult({});
  assert.equal(malformed.pass, false);
  assert.ok(malformed.problems.length >= 1);
});

test("checkTransparency flags baked-in backgrounds and empty images", async () => {
  const good = await checkTransparency(await transparentDesignPng());
  assert.equal(good.pass, true);
  assert.ok(good.coverage < 0.5);

  const baked = await checkTransparency(await opaquePng());
  assert.equal(baked.pass, false);
  assert.match(baked.problem, /background panel is baked in/);

  const empty = await sharp({
    create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const nothing = await checkTransparency(empty);
  assert.equal(nothing.pass, false);
  assert.match(nothing.problem, /fully transparent/);
});

test("image prompt carries layout + retail-finish rules and QA rejection feedback", () => {
  const clean = buildImagePrompt(BRIEF, "on", { transparentBackground: true });
  assert.match(clean, /NOTHING may cover, clip, touch, or overlap any letter/);
  assert.match(clean, /Nothing is cut off by the canvas edge/);
  assert.match(clean, /Retail-grade finish/);
  assert.match(clean, /TRANSPARENT background \(true alpha\)/);
  assert.ok(!clean.includes("chroma background"), "transparent mode drops chroma instructions");
  assert.ok(!clean.includes("REJECTED"), "no rejection block without feedback");

  // Chroma flow (default) still intact for the SVG/legacy path.
  const chroma = buildImagePrompt(BRIEF, "on");
  assert.match(chroma, /chroma background/);

  // Backward-compatible: bare feedback array or options.feedback both work.
  for (const arg of [["the soccer ball clips the letters of FRANCE"], { feedback: ["the soccer ball clips the letters of FRANCE"] }]) {
    const retry = buildImagePrompt(BRIEF, "on", arg);
    assert.match(retry, /REJECTED by quality review/);
    assert.match(retry, /soccer ball clips the letters of FRANCE/);
  }
});

test("design passing review on first attempt returns QA metadata and skipChroma", async () => {
  const client = fakeClient({ verdicts: [GOOD_VERDICT], pngPromise: transparentDesignPng() });
  __setOpenAIClientForTests(client);
  const out = await generateArtwork({ brief: BRIEF, copyrightFilter: "on" });
  assert.equal(out.source, "openai");
  assert.equal(out.skipChroma, true);
  assert.equal(out.qa.pass, true);
  assert.equal(out.qa.attempts, 1);
  assert.ok(out.qa.alphaCoverage < 0.5);
  assert.equal(client.calls.reviews, 1);
});

test("rejected design regenerates with reviewer feedback in the prompt", async () => {
  const client = fakeClient({
    verdicts: [
      { ...GOOD_VERDICT, overlapOrClipping: true, problems: ["badge overlaps the word FRANCE"] },
      GOOD_VERDICT,
    ],
    pngPromise: transparentDesignPng(),
  });
  __setOpenAIClientForTests(client);
  const out = await generateArtwork({ brief: BRIEF, copyrightFilter: "on" });
  assert.equal(out.qa.attempts, 2);
  assert.equal(client.calls.imagePrompts.length, 2);
  assert.ok(!client.calls.imagePrompts[0].includes("REJECTED"));
  assert.match(client.calls.imagePrompts[1], /badge overlaps the word FRANCE/);
});

test("baked-in background fails deterministically without spending a QA call", async () => {
  const client = fakeClient({ verdicts: [GOOD_VERDICT], pngPromise: opaquePng() });
  __setOpenAIClientForTests(client);
  await assert.rejects(
    generateArtwork({ brief: BRIEF, copyrightFilter: "on" }),
    (err) => err.code === "DESIGN_QA_FAILED" && /background panel is baked in/.test(err.message),
  );
  assert.equal(client.calls.reviews, 0, "vision review should be skipped when transparency fails");
  assert.equal(client.calls.imagePrompts.length, 3, "default is 3 attempts");
});

test("design failing every attempt throws DESIGN_QA_FAILED — never presented", async () => {
  const client = fakeClient({
    verdicts: [{ ...GOOD_VERDICT, designQuality: 4, problems: ["flat basic clip art"] }],
    pngPromise: transparentDesignPng(),
  });
  __setOpenAIClientForTests(client);
  await assert.rejects(
    generateArtwork({ brief: BRIEF, copyrightFilter: "on" }),
    (err) => err.code === "DESIGN_QA_FAILED" && err.statusCode === 502 && /flat basic clip art/.test(err.message),
  );
});

test("image API failure throws loudly instead of silently substituting SVG", async () => {
  const client = fakeClient({ verdicts: [], imageError: "401 bad key", pngPromise: transparentDesignPng() });
  __setOpenAIClientForTests(client);
  await assert.rejects(
    generateArtwork({ brief: BRIEF, copyrightFilter: "on" }),
    (err) => err.code === "IMAGE_GENERATION_FAILED" && /401 bad key/.test(err.message),
  );
});

test("reviewDesign retries once, then fails open when the review call keeps erroring", async () => {
  let calls = 0;
  const flaky = {
    chat: {
      completions: {
        async create() {
          calls += 1;
          if (calls === 1) throw new Error("review timeout");
          return { choices: [{ message: { content: JSON.stringify(GOOD_VERDICT) } }] };
        },
      },
    },
  };
  const png = await transparentDesignPng();
  const recovered = await reviewDesign({ pngBuffer: png, brief: BRIEF, client: flaky });
  assert.equal(recovered.status, "reviewed");
  assert.equal(recovered.pass, true);
  assert.equal(calls, 2, "first failure retried once");

  const dead = {
    chat: { completions: { async create() { throw new Error("review down"); } } },
  };
  const qa = await reviewDesign({ pngBuffer: png, brief: BRIEF, client: dead });
  assert.equal(qa.status, "skipped");
  assert.equal(qa.pass, true);
  assert.match(qa.reason, /review down/);
});

test("DESIGN_QA=off skips review entirely", async () => {
  process.env.DESIGN_QA = "off";
  try {
    const qa = await reviewDesign({ pngBuffer: Buffer.alloc(0), brief: BRIEF, client: {} });
    assert.equal(qa.status, "skipped");
    assert.equal(qa.pass, true);
  } finally {
    delete process.env.DESIGN_QA;
  }
});

test("pickStyleReferences returns [] for missing/empty dirs and caps at 2", async () => {
  assert.deepEqual(pickStyleReferences("/nonexistent/dir"), []);

  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inkly-style-"));
  try {
    assert.deepEqual(pickStyleReferences(dir), [], "README-only folder yields no refs");
    fs.writeFileSync(path.join(dir, "README.md"), "docs");
    for (const f of ["a.png", "b.jpg", "c.jpeg", "d.txt"]) fs.writeFileSync(path.join(dir, f), "x");
    const picked = pickStyleReferences(dir);
    assert.equal(picked.length, 2);
    for (const p of picked) assert.match(p, /\.(png|jpe?g)$/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
