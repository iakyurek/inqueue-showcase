/**
 * cleanupPipeline.js
 *
 * Staged local processing that brackets the background remover and upscaler
 * APIs so each gets the best possible input and its output is cleaned before
 * passing downstream.
 *
 * Pipeline stages:
 *   A. Analyze     — inspect dimensions, detect existing transparency
 *   B. Preprocess  — orient, size-up for API, add safe margin
 *   C. BG removal  — Photoroom → remove.bg (SKIPPED when already transparent)
 *   D. Post-clean  — clear alpha noise, trim transparent margins
 *   E. Upscale     — alpha-aware wrapper around the existing upscaler
 *   F. Compose     — handled by composeTransparent() in server.js
 */

import sharp from "sharp";
import { removeBackgroundWithProvider } from "./backgroundRemover.js";
import { upscale } from "./upscaler.js";

// ── Pipeline constants ────────────────────────────────────────────────────────

// Minimum long edge (px) before submitting to the background removal API.
// Segmentation models produce poor masks on very small inputs; we upsize first.
const MIN_LONG_EDGE_FOR_API = 1500;

// Fraction of safe white padding added on each side before API submission.
// Prevents the model from treating content touching a canvas edge as background.
const SAFE_MARGIN_FRACTION = 0.02;

// Alpha values below this threshold are cleared to 0 after background removal.
// Removes semi-transparent fringe/halo artifacts from API masking.
const ALPHA_NOISE_THRESHOLD = 20;

// If this share of outermost border pixels are already transparent, the image
// already has a clean alpha channel and background removal is skipped.
const ALREADY_TRANSPARENT_THRESHOLD = 0.65;


// ── Stage A: Analyze ─────────────────────────────────────────────────────────

/**
 * Inspect the upload: report dimensions, alpha state, and whether
 * background removal can be safely skipped.
 */
export async function analyzeUpload(buffer) {
  const meta = await sharp(buffer).rotate().metadata();
  const long = Math.max(meta.width || 1, meta.height || 1);
  const hasAlpha = Boolean(meta.hasAlpha);

  let alreadyTransparent = false;
  if (hasAlpha) {
    // Sample the outermost pixel ring at low resolution — cheap transparency check
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize({ width: 100, height: 100, fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    let transparentCount = 0;
    let totalCount = 0;

    for (let x = 0; x < width; x++) {
      for (const y of [0, height - 1]) {
        const i = (y * width + x) * channels;
        totalCount++;
        if (data[i + 3] < 20) transparentCount++;
      }
    }
    for (let y = 1; y < height - 1; y++) {
      for (const x of [0, width - 1]) {
        const i = (y * width + x) * channels;
        totalCount++;
        if (data[i + 3] < 20) transparentCount++;
      }
    }

    alreadyTransparent =
      totalCount > 0 &&
      transparentCount / totalCount >= ALREADY_TRANSPARENT_THRESHOLD;
  }

  return { width: meta.width, height: meta.height, long, hasAlpha, alreadyTransparent };
}


// ── Stage B: Preprocess for background removal ────────────────────────────────

/**
 * Prepare the image so the background removal API gets a clean, well-sized input:
 *  • Auto-orient  — apply EXIF rotation so the API sees the correct orientation
 *  • Resize up    — ensure the long edge is at least MIN_LONG_EDGE_FOR_API
 *  • Flatten      — composite any existing alpha onto white (APIs expect solid bg)
 *  • Safe margin  — embed on a white canvas with padding so edge content isn't clipped
 */
export async function preprocessForBgRemoval(buffer) {
  const meta = await sharp(buffer).rotate().metadata();
  const long = Math.max(meta.width || 1, meta.height || 1);

  let pipeline = sharp(buffer)
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } }); // flatten alpha to white

  if (long < MIN_LONG_EDGE_FOR_API) {
    pipeline = pipeline.resize({
      width: MIN_LONG_EDGE_FOR_API,
      height: MIN_LONG_EDGE_FOR_API,
      fit: "inside",
      kernel: "lanczos3",
      withoutEnlargement: false,
    });
  }

  let prepared = await pipeline.png().toBuffer();

  // Add white padding margin so the API doesn't clip design edges
  const pm = await sharp(prepared).metadata();
  const margin = Math.max(10, Math.round(Math.max(pm.width || 1, pm.height || 1) * SAFE_MARGIN_FRACTION));
  const paddedW = (pm.width || 0) + margin * 2;
  const paddedH = (pm.height || 0) + margin * 2;

  prepared = await sharp({
    create: { width: paddedW, height: paddedH, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: prepared, left: margin, top: margin }])
    .png()
    .toBuffer();

  return prepared;
}


// ── Stage D: Post-removal cleanup ─────────────────────────────────────────────

/**
 * Clean the transparent result from the background remover before upscaling:
 *  • Clear pixels below ALPHA_NOISE_THRESHOLD (removes fringe/halo from API masking)
 *  • Round near-fully-opaque pixels up to 255 (firms up solid design areas)
 *  • Trim transparent margins so the upscaler focuses on actual content
 */
export async function cleanupAfterBgRemoval(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const raw = Buffer.from(data);
  const { width, height, channels } = info;

  for (let pos = 0; pos < width * height; pos++) {
    const aIdx = pos * channels + 3;
    const a = raw[aIdx];
    if (a < ALPHA_NOISE_THRESHOLD) {
      raw[aIdx] = 0;    // clear fringe/noise pixel
    } else if (a > 235) {
      raw[aIdx] = 255;  // firm up near-solid pixel
    }
  }

  let cleaned = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();

  // Trim transparent margins so the upscaler's budget goes to content, not empty space
  try {
    cleaned = await sharp(cleaned)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
  } catch {
    // Nothing to trim — keep as-is
  }

  return cleaned;
}


// ── Stage E: Alpha-aware upscaling ───────────────────────────────────────────

/**
 * Real-ESRGAN via Replicate does not preserve the alpha channel — it silently
 * discards transparency and returns an opaque image. This wrapper:
 *  1. Extracts the alpha channel and saves it as a grayscale mask
 *  2. Flattens the design onto neutral gray (minimises edge halos on restore)
 *  3. Upscales the alpha-stripped RGB version
 *  4. Resizes the saved alpha mask to match the upscaled dimensions
 *  5. Rejoins RGB + resized alpha into a correct RGBA PNG
 *
 * For the Lanczos3 fallback, Sharp preserves alpha natively — no wrapping needed.
 * If Real-ESRGAN fails internally, upscale() already falls back to Lanczos3;
 * the wrapper handles both outcomes correctly since we always rejoin the saved alpha.
 */
export async function upscaleAlphaAware(buffer) {
  const useReplicate =
    process.env.UPSCALE_PROVIDER === "replicate" &&
    Boolean(process.env.REPLICATE_API_TOKEN);

  const meta = await sharp(buffer).metadata();
  const hasAlpha = Boolean(meta.hasAlpha);

  if (!useReplicate || !hasAlpha) {
    // Lanczos3 handles alpha correctly — pass through unchanged
    return upscale(buffer);
  }

  // Save alpha as single-channel raw bytes at original resolution
  const { data: alphaData } = await sharp(buffer)
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Flatten onto neutral gray before sending to the API
  // (white/black backgrounds create light/dark halos when alpha is re-joined;
  //  gray is the closest to "no bias" for an 8-bit channel boundary)
  const { data: rgbData } = await sharp(buffer)
    .flatten({ background: { r: 128, g: 128, b: 128 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const flatBuffer = await sharp(rgbData, {
    raw: { width: meta.width, height: meta.height, channels: 3 },
  })
    .png()
    .toBuffer();

  // Run the real upscaler on the alpha-stripped RGB version
  const { buffer: upscaledRgb, method } = await upscale(flatBuffer);
  const upMeta = await sharp(upscaledRgb).metadata();
  const upW = upMeta.width || meta.width || 1;
  const upH = upMeta.height || meta.height || 1;

  // Resize the saved alpha mask to match the upscaled RGB dimensions
  const alphaResized = await sharp(Buffer.from(alphaData), {
    raw: { width: meta.width, height: meta.height, channels: 1 },
  })
    .resize(upW, upH, { kernel: "lanczos3" })
    .raw()
    .toBuffer();

  // Get RGB raw data from the upscaled image
  const { data: rgbUpData } = await sharp(upscaledRgb)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Manually combine RGB + restored alpha into RGBA
  const rgbaData = Buffer.allocUnsafe(upW * upH * 4);
  for (let i = 0; i < upW * upH; i++) {
    rgbaData[i * 4]     = rgbUpData[i * 3];
    rgbaData[i * 4 + 1] = rgbUpData[i * 3 + 1];
    rgbaData[i * 4 + 2] = rgbUpData[i * 3 + 2];
    rgbaData[i * 4 + 3] = alphaResized[i];
  }

  const withAlpha = await sharp(rgbaData, {
    raw: { width: upW, height: upH, channels: 4 },
  })
    .png()
    .toBuffer();

  return { buffer: withAlpha, method };
}


// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Run the complete cleanup pipeline on a raw upload buffer.
 *
 * Returns { transparent, provider, upscaleMethod, skippedBgRemoval, sourceLongEdge }
 * where `transparent` is a cleaned, upscaled PNG ready for composeTransparent().
 */
export async function runCleanupPipeline(rawBuffer, { filename = "design.png" } = {}) {
  // A. Analyze — decide what the pipeline needs to do
  const analysis = await analyzeUpload(rawBuffer);

  let bgBuffer;
  let provider = null;
  let skippedBgRemoval = false;

  if (analysis.alreadyTransparent) {
    // Design already has a clean alpha — skip the API call entirely
    skippedBgRemoval = true;
    bgBuffer = await sharp(rawBuffer).rotate().ensureAlpha().png().toBuffer();
    console.log("[cleanup] Skipped background removal — design already has clean transparency.");
  } else {
    // B. Preprocess — orient, size-up, add safe margin
    const preparedBuffer = await preprocessForBgRemoval(rawBuffer);

    // C. Background removal — Photoroom primary, remove.bg fallback
    const result = await removeBackgroundWithProvider(preparedBuffer, { filename });
    bgBuffer = result.buffer;
    provider = result.provider;
  }

  // D. Post-removal cleanup — clear alpha noise, trim transparent margins
  const cleanedBuffer = await cleanupAfterBgRemoval(bgBuffer);

  // Record the cleaned size before upscaling (used as sourceLongEdge in metadata)
  const cleanedMeta = await sharp(cleanedBuffer).metadata();
  const sourceLongEdge = Math.max(cleanedMeta.width || 0, cleanedMeta.height || 0);

  // E. Alpha-aware upscale — handles Real-ESRGAN alpha loss transparently
  const { buffer: transparent, method: upscaleMethod } = await upscaleAlphaAware(cleanedBuffer);

  return { transparent, provider, upscaleMethod, skippedBgRemoval, sourceLongEdge };
}
