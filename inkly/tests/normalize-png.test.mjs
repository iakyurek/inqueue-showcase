import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { normalizeReadyPng, READY_PNG_LIMITS } from "../lib/normalizePng.js";
import { readAlphaStats, alphaStatsFromRaw } from "../lib/exportPng.js";

// A visible 200x120 red rectangle with an alpha gradient — a "normal" design.
async function makeNormalPng() {
  return sharp({
    create: { width: 200, height: 120, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 0.8 } },
  }).png().toBuffer();
}

// An "unusual" PNG: 16-bit depth, Adam7 interlaced, with an embedded ICC
// profile and EXIF-style metadata — the class of file-specific uploads that
// used to be stored raw or fail downstream.
async function makeUnusualPng() {
  return sharp({
    create: { width: 180, height: 90, channels: 3, background: { r: 10, g: 200, b: 120 } },
  })
    .toColourspace("rgb16")
    .withMetadata({ density: 144 })
    .withIccProfile("p3")
    .png({ progressive: true })
    .toBuffer();
}

test("a normal 8-bit RGBA PNG passes through with dimensions and alpha preserved", async () => {
  const input = await makeNormalPng();
  const result = await normalizeReadyPng(input);

  assert.equal(result.meta.width, 200);
  assert.equal(result.meta.height, 120);
  assert.equal(result.meta.hasAlpha, true);

  const outMeta = await sharp(result.buffer).metadata();
  assert.equal(outMeta.format, "png");
  assert.equal(outMeta.depth, "uchar");
  assert.equal(outMeta.channels, 4);
  assert.ok(!outMeta.isProgressive);
});

test("an unusual PNG (16-bit, interlaced, ICC profile) is normalized to 8-bit RGBA sRGB non-interlaced with metadata stripped", async () => {
  const input = await makeUnusualPng();
  const inMeta = await sharp(input).metadata();
  assert.equal(inMeta.depth, "ushort", "fixture should be 16-bit");
  assert.equal(inMeta.isProgressive, true, "fixture should be interlaced");
  assert.ok(inMeta.icc, "fixture should carry an ICC profile");

  const result = await normalizeReadyPng(input);
  const outMeta = await sharp(result.buffer).metadata();
  assert.equal(outMeta.format, "png");
  assert.equal(outMeta.depth, "uchar", "normalized output must be 8-bit");
  assert.ok(!outMeta.isProgressive, "normalized output must be non-interlaced");
  assert.equal(outMeta.channels, 4, "normalized output must be RGBA");
  assert.equal(outMeta.space, "srgb");
  assert.ok(!outMeta.icc, "ICC profile must be stripped");
  assert.ok(!outMeta.exif, "EXIF must be stripped");

  assert.equal(result.normalized.bitDepthChanged, true);
  assert.equal(result.normalized.deinterlaced, true);
  assert.equal(result.normalized.alphaAdded, true);
  assert.equal(result.normalized.metadataStripped, true);
});

test("a renamed non-PNG (real WebP bytes) is rejected naming the detected format", async () => {
  const webp = await sharp({
    create: { width: 60, height: 60, channels: 3, background: { r: 5, g: 5, b: 200 } },
  }).webp().toBuffer();

  await assert.rejects(normalizeReadyPng(webp), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /actually WEBP, not a PNG/);
    return true;
  });
});

test("an undecodable buffer with PNG magic bytes (simulated decoder failure) gives an actionable error", async () => {
  const garbage = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("this-is-not-a-real-png-chunk-stream-................"),
  ]);

  await assert.rejects(normalizeReadyPng(garbage), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /could not be decoded|could not be read/);
    assert.match(error.message, /Re-export it/);
    return true;
  });
});

test("oversized dimensions are rejected with the actual size and the limit in the message", async () => {
  const input = await makeNormalPng(); // 200x120
  await assert.rejects(normalizeReadyPng(input, { maxEdge: 100 }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /200x120px/);
    assert.match(error.message, /maximum is 100px per side/);
    return true;
  });
});

test("undersized dimensions are rejected with the actual size and the limit in the message", async () => {
  const tiny = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();

  await assert.rejects(normalizeReadyPng(tiny), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /20x20px/);
    assert.match(error.message, new RegExp(`minimum is ${READY_PNG_LIMITS.minEdge}px`));
    return true;
  });
});

test("alphaRaw from the fused pipeline matches a standalone readAlphaStats decode", async () => {
  // Half-transparent gradient-ish fixture: an opaque box composited onto a
  // transparent canvas, so coverage is a real fraction, not 0 or 1.
  const box = await sharp({
    create: { width: 150, height: 100, channels: 4, background: { r: 30, g: 60, b: 200, alpha: 1 } },
  }).png().toBuffer();
  const input = await sharp({
    create: { width: 300, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: box, top: 50, left: 40 }]).png().toBuffer();

  const result = await normalizeReadyPng(input);
  assert.ok(result.alphaRaw, "normalizeReadyPng must return alphaRaw");

  const fused = alphaStatsFromRaw(result.alphaRaw);
  const legacy = await readAlphaStats(result.buffer);

  assert.equal(fused.width, legacy.width);
  assert.equal(fused.height, legacy.height);
  assert.equal(fused.hasContent, true);
  assert.ok(Math.abs(fused.coverage - legacy.coverage) < 0.01, `coverage ${fused.coverage} vs ${legacy.coverage}`);
  assert.ok(Math.abs(fused.centerX - legacy.centerX) < 0.02);
  assert.ok(Math.abs(fused.centerY - legacy.centerY) < 0.02);
  // Sanity: the box is 150x100 of 300x400 = 12.5% coverage.
  assert.ok(fused.coverage > 0.1 && fused.coverage < 0.15);
});

test("limits are sane and exported for the server/UI to reference", () => {
  assert.equal(READY_PNG_LIMITS.maxBytes, 60 * 1024 * 1024);
  assert.equal(READY_PNG_LIMITS.maxEdge, 16000);
  assert.ok(READY_PNG_LIMITS.minEdge > 0);
});
