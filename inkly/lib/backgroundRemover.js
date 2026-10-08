import sharp from "sharp";
import { basename } from "path";

function parseHexColor(value = "#FF00FF") {
  const cleaned = String(value).trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(cleaned)) return { r: 255, g: 0, b: 255, hex: "#FF00FF" };
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
    hex: `#${cleaned.toUpperCase()}`,
  };
}

function distance(r, g, b, color) {
  const dr = r - color.r, dg = g - color.g, db = b - color.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function isVeryLight(r, g, b) {
  return r >= 246 && g >= 246 && b >= 246;
}

function sampleBorderColors(raw, width, height, channels) {
  const samples = [];
  const stepX = Math.max(1, Math.floor(width / 60));
  const stepY = Math.max(1, Math.floor(height / 60));
  const add = (x, y) => {
    const idx = (y * width + x) * channels;
    const a = raw[idx + 3] ?? 255;
    if (a < 20) return;
    samples.push({ r: raw[idx], g: raw[idx + 1], b: raw[idx + 2] });
  };
  for (let x = 0; x < width; x += stepX) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { add(0, y); add(width - 1, y); }

  const unique = [];
  for (const s of samples) {
    if (!unique.some((u) => distance(s.r, s.g, s.b, u) < 18)) unique.push(s);
    if (unique.length >= 8) break;
  }
  return unique;
}

// Flood-fill from the borders so background-colored regions INSIDE the artwork
// (e.g. white inside a letter) are preserved — only connected background goes.
function edgeConnectedRemoval(raw, width, height, channels, colors, threshold) {
  if (!colors.length) return;
  const visited = new Uint8Array(width * height);
  const queue = [];

  const shouldRemove = (idx) => {
    const a = raw[idx + 3] ?? 255;
    if (a < 20) return true;
    const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
    if (isVeryLight(r, g, b)) return true;
    return colors.some((c) => distance(r, g, b, c) <= threshold);
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pos = y * width + x;
    if (visited[pos]) return;
    const idx = pos * channels;
    if (!shouldRemove(idx)) return;
    visited[pos] = 1;
    queue.push(pos);
  };

  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    const x = pos % width, y = Math.floor(pos / width);
    raw[pos * channels + 3] = 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
}

export function getChromaColor() {
  return parseHexColor(process.env.DESIGN_CHROMA_COLOR || "#FF00FF");
}

/**
 * Convert any image buffer to a clean transparent PNG.
 * Pass 1: chroma-key removal (for AI art generated on a flat chroma bg).
 * Pass 2: edge-connected fallback (for uploads with white/gray/solid bg).
 */
export async function makeTransparentPng(buffer, options = {}) {
  const chroma = parseHexColor(options.chromaColor || process.env.DESIGN_CHROMA_COLOR || "#FF00FF");
  const chromaThreshold = Number(options.chromaThreshold || process.env.DESIGN_CHROMA_THRESHOLD || 65);
  const feather = Number(options.feather || process.env.DESIGN_CHROMA_FEATHER || 30);
  const edgeThreshold = Number(options.edgeThreshold || process.env.DESIGN_EDGE_BG_THRESHOLD || 36);
  const maxSize = Number(options.maxSize || process.env.DESIGN_CLEANUP_MAX_SIZE || 2048);
  const skipChroma = options.skipChroma === true; // for uploads that never had chroma

  const processed = await sharp(buffer)
    .rotate()
    .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const raw = Buffer.from(processed.data);
  const { width, height, channels } = processed.info;
  if (!width || !height || channels < 4) {
    return await sharp(buffer).png().toBuffer();
  }

  if (!skipChroma) {
    for (let pos = 0; pos < width * height; pos++) {
      const idx = pos * channels;
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2], a = raw[idx + 3] ?? 255;
      const d = distance(r, g, b, chroma);
      if (d <= chromaThreshold) {
        raw[idx + 3] = 0;
      } else if (d <= chromaThreshold + feather) {
        const keep = (d - chromaThreshold) / feather;
        raw[idx + 3] = Math.max(0, Math.min(255, Math.round(a * keep)));
      }
    }
  }

  const borderColors = sampleBorderColors(raw, width, height, channels).filter((c) => {
    const isDarkArtwork = c.r < 80 && c.g < 80 && c.b < 80;
    return !isDarkArtwork;
  });
  edgeConnectedRemoval(raw, width, height, channels, borderColors, edgeThreshold);

  const transparent = await sharp(raw, { raw: { width, height, channels } }).png().toBuffer();

  try {
    return await sharp(transparent)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png()
      .toBuffer();
  } catch {
    return transparent;
  }
}

async function photoroomRemoveBackground(buffer, filename = "design.png") {
  const key = process.env.PHOTOROOM_API_KEY;
  if (!key) throw new Error("Missing PHOTOROOM_API_KEY.");

  const form = new FormData();
  form.append("image_file", new Blob([buffer], { type: "image/png" }), basename(filename));

  const response = await fetch("https://sdk.photoroom.com/v1/segment", {
    method: "POST",
    headers: { "x-api-key": key },
    body: form,
  });
  if (!response.ok) throw new Error(`Photoroom background removal failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function removeBgRemoveBackground(buffer, filename = "design.png") {
  const key = process.env.REMOVEBG_API_KEY;
  if (!key) throw new Error("Missing REMOVEBG_API_KEY.");

  const form = new FormData();
  form.append("image_file", new Blob([buffer], { type: "image/png" }), basename(filename));
  form.append("size", "auto");

  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": key },
    body: form,
  });
  if (!response.ok) throw new Error(`remove.bg background removal failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

export function backgroundProviderStatus() {
  return {
    photoroom: Boolean(process.env.PHOTOROOM_API_KEY),
    removebg: Boolean(process.env.REMOVEBG_API_KEY),
  };
}

export async function removeBackgroundWithProvider(buffer, options = {}) {
  const status = backgroundProviderStatus();
  if (!status.photoroom && !status.removebg) {
    const err = new Error("Add PHOTOROOM_API_KEY or REMOVEBG_API_KEY to enable cleanup.");
    err.code = "MISSING_BACKGROUND_PROVIDER";
    throw err;
  }

  if (status.photoroom) {
    try {
      return { buffer: await photoroomRemoveBackground(buffer, options.filename), provider: "photoroom" };
    } catch (err) {
      if (!status.removebg) throw err;
      console.warn("[background] Photoroom failed, falling back to remove.bg:", err.message);
    }
  }

  return { buffer: await removeBgRemoveBackground(buffer, options.filename), provider: "removebg" };
}
