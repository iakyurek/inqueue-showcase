import sharp from "sharp";

/**
 * Trim, fit, and center a transparent design onto the export canvas.
 * Output: transparent PNG, 4500x5400 by default, 300 DPI metadata, sRGB.
 */
export async function composeTransparent(designBuffer, options = {}) {
  const width = Number(options.width || process.env.DEFAULT_CANVAS_WIDTH || 4500);
  const height = Number(options.height || process.env.DEFAULT_CANVAS_HEIGHT || 5400);
  const dpi = Number(options.dpi || process.env.EXPORT_DPI || 300);
  const padW = options.padW ?? 0.86;
  const padH = options.padH ?? 0.8;

  // trim any transparent margin first
  let trimmed = designBuffer;
  try {
    trimmed = await sharp(designBuffer)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
  } catch {
    /* keep original if trim has nothing to do */
  }

  const meta = await sharp(trimmed).metadata();
  const maxW = Math.round(width * padW);
  const maxH = Math.round(height * padH);
  const scale = Math.min(maxW / (meta.width || 1), maxH / (meta.height || 1));
  const dw = Math.max(1, Math.round((meta.width || 1) * scale));
  const dh = Math.max(1, Math.round((meta.height || 1) * scale));

  const resized = await sharp(trimmed)
    .resize(dw, dh, { kernel: "lanczos3", fit: "fill" })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });

  const out = await canvas
    .composite([{ input: resized, gravity: "center" }])
    .withMetadata({ density: dpi }) // writes 300 DPI (pHYs) into the PNG
    .png({ compressionLevel: 9 })
    .toBuffer();

  return out;
}

export async function readAlphaStats(pngBuffer) {
  const { data, info } = await sharp(pngBuffer)
    .resize({ width: 500, height: 600, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return alphaStatsFromRaw({ data, info });
}

// Stats from an already-decoded raw RGBA buffer — callers that just produced
// one (e.g. normalizeReadyPng) skip a redundant decode of their own output.
export function alphaStatsFromRaw({ data, info }) {
  const { width, height, channels } = info;
  let opaque = 0, minX = width, minY = height, maxX = 0, maxY = 0;
  const colors = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (data[i + 3] > 20) {
        opaque++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        colors.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
      }
    }
  }
  const total = width * height;
  return {
    width, height,
    coverage: opaque / total,
    hasContent: opaque > 0,
    centerX: opaque ? (minX + maxX) / 2 / width : 0.5,
    centerY: opaque ? (minY + maxY) / 2 / height : 0.5,
    colorBuckets: colors.size,
  };
}
