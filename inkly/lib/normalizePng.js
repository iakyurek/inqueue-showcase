import sharp from "sharp";

// Explicit, user-visible limits for the "Upload Ready PNG" flow. These are the
// single source of truth — the multer fileSize limit, the error messages, and
// the drop-zone hint text all derive from here.
export const READY_PNG_LIMITS = {
  maxEdge: 16000, // px per side
  minEdge: 50, // px per side
  maxBytes: 60 * 1024 * 1024,
};

function uploadError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Normalize an uploaded ready-design PNG to a standard 8-bit RGBA sRGB PNG:
// non-interlaced, alpha ensured, and all ancillary metadata (ICC/EXIF/XMP/
// text chunks) stripped. File-specific oddities that used to fail downstream
// (16-bit depth, Adam7 interlacing, palette/grayscale color types, embedded
// color profiles) are converted instead of rejected. Rejections only happen
// when the file cannot be decoded at all or violates the explicit limits,
// and every rejection message tells the user what to do about it.
export async function normalizeReadyPng(buffer, options = {}) {
  const maxEdge = options.maxEdge ?? READY_PNG_LIMITS.maxEdge;
  const minEdge = options.minEdge ?? READY_PNG_LIMITS.minEdge;
  const limitInputPixels = maxEdge * maxEdge;

  // Metadata is header-only (no pixel decode), so read it without the pixel
  // limit — the explicit dimension checks below produce a friendlier message
  // than sharp's generic "exceeds pixel limit" error would.
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (error) {
    throw uploadError(`This PNG could not be decoded (${error.message}). Re-export it from your design tool as a standard PNG and try again.`);
  }

  if (meta.format !== "png") {
    throw uploadError(`This file is actually ${meta.format ? meta.format.toUpperCase() : "an unknown format"}, not a PNG. Export it as a PNG and re-upload.`);
  }

  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) {
    throw uploadError("This PNG reports no dimensions and could not be read. Re-export it as a standard PNG and try again.");
  }
  if (width > maxEdge || height > maxEdge) {
    throw uploadError(`This PNG is ${width}x${height}px — the maximum is ${maxEdge}px per side. Resize it and re-upload.`);
  }
  if (width < minEdge || height < minEdge) {
    throw uploadError(`This PNG is ${width}x${height}px — the minimum is ${minEdge}px per side. Upload a larger design.`);
  }

  // One decode feeds both outputs: the normalized PNG and a small raw buffer
  // for alpha-coverage stats (matching readAlphaStats' 500x600 sample), so the
  // caller never has to re-decode the file it just encoded. Compression level
  // 6 instead of 9: near-identical size on large RGBA images at a fraction of
  // the encode time.
  let normalizedBuffer;
  let outInfo;
  let alphaRaw = null;
  try {
    const base = sharp(buffer, { limitInputPixels })
      .rotate() // honor EXIF orientation before stripping metadata
      .toColourspace("srgb")
      .ensureAlpha();
    const [encoded, raw] = await Promise.all([
      base
        .clone()
        .png({ compressionLevel: 6, progressive: false, palette: false, force: true })
        .toBuffer({ resolveWithObject: true }),
      base
        .clone()
        .resize({ width: 500, height: 600, fit: "inside" })
        .raw()
        .toBuffer({ resolveWithObject: true }),
    ]);
    normalizedBuffer = encoded.data;
    outInfo = encoded.info;
    alphaRaw = { data: raw.data, info: raw.info };
  } catch (error) {
    throw uploadError(`This PNG decoded but could not be converted to a standard 8-bit RGBA PNG (${error.message}). Re-export it as a plain PNG and try again.`);
  }

  return {
    buffer: normalizedBuffer,
    alphaRaw,
    meta: {
      width: outInfo.width,
      height: outInfo.height,
      hasAlpha: outInfo.channels === 4,
    },
    normalized: {
      bitDepthChanged: meta.depth !== "uchar",
      deinterlaced: Boolean(meta.isProgressive),
      alphaAdded: !meta.hasAlpha,
      metadataStripped: Boolean(meta.icc || meta.exif || meta.xmp || meta.iptc || meta.orientation),
      colourspace: "srgb",
    },
  };
}
