// ---------------------------------------------------------------------------
// Ready Mockups — stamp-only workflow (server side).
//
// Operators upload finished ("ready") mockups in the browser, stamp every store
// logo onto them, and download one ZIP organized as <Store name>/<mockup>. This
// module owns the only server state that workflow needs:
//   * a logo library  (store name + image), and
//   * the default logo placement.
//
// Deliberately isolated: it never reads or writes batches, the SKU ledger,
// stores.json, or Google Drive. Mockups never touch the server at all — the
// compositing and ZIP build happen in the browser.
//
// Both state files are durable (Postgres write-through via the injected
// writeJsonFile), so the library survives Render redeploys. Logos are stored as
// base64 inside that JSON; the browser downscales them before upload, which
// keeps the library small.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

export const READY_STAMP_LIMITS = Object.freeze({
  maxLogos: 30,
  maxLogoBytes: 4 * 1024 * 1024,        // per logo, decoded
  maxLibraryBytes: 40 * 1024 * 1024,    // all logos, decoded
  maxStoreNameLength: 60,
  maxDimension: 12000,
});

// Top-right corner, matching Preply's default store-logo spot. Normalized to
// the mockup: center/box are fractions of its width/height.
export const DEFAULT_READY_STAMP_PLACEMENT = Object.freeze({
  center: Object.freeze({ x: 0.875, y: 0.095 }),
  box: Object.freeze({ width: 0.18, height: 0.12 }),
  rotationDeg: 0,
});

// Where a logo sits INSIDE the placement box. Store logos have very different
// shapes (wide wordmarks vs square badges); anchoring them to the same box edge
// keeps every store's logo the same distance from the mockup corner instead of
// floating wherever its aspect ratio centers it.
export const DEFAULT_READY_STAMP_ALIGN = Object.freeze({ x: 'right', y: 'top' });
const ALIGN_X = new Set(['left', 'center', 'right']);
const ALIGN_Y = new Set(['top', 'center', 'bottom']);

export function normalizeAlign(input) {
  if (!input || typeof input !== 'object') return null;
  if (!ALIGN_X.has(input.x) || !ALIGN_Y.has(input.y)) return null;
  return { x: input.x, y: input.y };
}

const MIME_BY_TYPE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
// Characters that are illegal (or treacherous) in a folder name on macOS,
// Windows, or inside a ZIP — the store name becomes the export folder name.
const FORBIDDEN_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;

export function normalizeStoreName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'Store name is required.' };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'Store name is required.' };
  if (value.length > READY_STAMP_LIMITS.maxStoreNameLength) {
    return { ok: false, error: `Store name must be ${READY_STAMP_LIMITS.maxStoreNameLength} characters or fewer.` };
  }
  if (FORBIDDEN_NAME_CHARS.test(value)) {
    return { ok: false, error: 'Store name cannot contain / \\ : * ? " < > | — it becomes a folder name.' };
  }
  if (value.startsWith('.')) return { ok: false, error: 'Store name cannot start with a dot.' };
  return { ok: true, value };
}

function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Accepts a data: URL for a PNG/JPEG/WebP and verifies the bytes really are
// that format (the declared MIME alone is not trusted).
export function parseImageDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'Logo image is required.' };
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!match) return { ok: false, error: 'Logo must be a PNG, JPEG, or WebP image.' };
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length) return { ok: false, error: 'Logo image is empty.' };
  if (buffer.length > READY_STAMP_LIMITS.maxLogoBytes) {
    return { ok: false, error: `Logo is too large (${(buffer.length / 1048576).toFixed(1)} MB). Max ${READY_STAMP_LIMITS.maxLogoBytes / 1048576} MB.` };
  }
  const sniffed = sniffImageType(buffer);
  if (!sniffed) return { ok: false, error: 'Logo file is not a valid PNG, JPEG, or WebP image.' };
  return { ok: true, mime: MIME_BY_TYPE[sniffed], buffer };
}

function normalizeDimension(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= READY_STAMP_LIMITS.maxDimension ? n : null;
}

function publicLogo(record) {
  const { data, ...meta } = record;
  return {
    ...meta,
    url: `/api/ready-stamp/logos/${encodeURIComponent(record.id)}/image?v=${encodeURIComponent(record.updatedAt)}`,
  };
}

function libraryBytes(logos) {
  return logos.reduce((sum, logo) => sum + (Number(logo.bytes) || 0), 0);
}

function nameTaken(logos, name, exceptId = null) {
  const key = name.toLowerCase();
  return logos.some((logo) => logo.id !== exceptId && String(logo.storeName).toLowerCase() === key);
}

export class ReadyStampError extends Error {
  constructor(status, message) {
    super(message);
    this.statusCode = status;
  }
}

// Factory so the server can inject its durable read/write helpers and the
// shared placement normalizer, and tests can inject in-memory fakes.
export function createReadyStampService({ logosFile, settingsFile, readJsonFile, writeJsonFile, normalizePlacement, now = () => new Date() }) {
  // Serialize every read-modify-write so concurrent uploads (e.g. importing all
  // store logos at once) can never drop each other's changes.
  let queue = Promise.resolve();
  function locked(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function readLogos() {
    const value = await readJsonFile(logosFile, { logos: [] });
    return Array.isArray(value?.logos) ? value.logos : [];
  }

  async function writeLogos(logos) {
    await writeJsonFile(logosFile, { logos });
  }

  async function listLogos() {
    const logos = await readLogos();
    return logos.map(publicLogo);
  }

  async function getLogoImage(id) {
    const logo = (await readLogos()).find((item) => item.id === id);
    if (!logo) return null;
    return { mime: logo.mime, buffer: Buffer.from(logo.data, 'base64') };
  }

  function createLogo(input = {}) {
    return locked(async () => {
      const logos = await readLogos();
      if (logos.length >= READY_STAMP_LIMITS.maxLogos) {
        throw new ReadyStampError(400, `The logo library is full (${READY_STAMP_LIMITS.maxLogos} logos). Delete one first.`);
      }
      const name = normalizeStoreName(input.storeName);
      if (!name.ok) throw new ReadyStampError(400, name.error);
      if (nameTaken(logos, name.value)) throw new ReadyStampError(409, `A logo for "${name.value}" already exists. Rename or replace it instead.`);
      const image = parseImageDataUrl(input.dataUrl);
      if (!image.ok) throw new ReadyStampError(400, image.error);
      if (libraryBytes(logos) + image.buffer.length > READY_STAMP_LIMITS.maxLibraryBytes) {
        throw new ReadyStampError(400, 'The logo library is out of space. Delete unused logos first.');
      }
      const stamp = now().toISOString();
      const record = {
        id: crypto.randomUUID(),
        storeName: name.value,
        enabled: input.enabled === undefined ? true : Boolean(input.enabled),
        mime: image.mime,
        bytes: image.buffer.length,
        width: normalizeDimension(input.width),
        height: normalizeDimension(input.height),
        createdAt: stamp,
        updatedAt: stamp,
        data: image.buffer.toString('base64'),
      };
      await writeLogos([...logos, record]);
      return publicLogo(record);
    });
  }

  function updateLogo(id, input = {}) {
    return locked(async () => {
      const logos = await readLogos();
      const index = logos.findIndex((item) => item.id === id);
      if (index === -1) throw new ReadyStampError(404, 'Logo not found.');
      const next = { ...logos[index] };
      if (input.storeName !== undefined) {
        const name = normalizeStoreName(input.storeName);
        if (!name.ok) throw new ReadyStampError(400, name.error);
        if (nameTaken(logos, name.value, id)) throw new ReadyStampError(409, `A logo for "${name.value}" already exists.`);
        next.storeName = name.value;
      }
      if (input.enabled !== undefined) next.enabled = Boolean(input.enabled);
      if (input.dataUrl !== undefined) {
        const image = parseImageDataUrl(input.dataUrl);
        if (!image.ok) throw new ReadyStampError(400, image.error);
        const others = logos.filter((item) => item.id !== id);
        if (libraryBytes(others) + image.buffer.length > READY_STAMP_LIMITS.maxLibraryBytes) {
          throw new ReadyStampError(400, 'The logo library is out of space. Delete unused logos first.');
        }
        next.mime = image.mime;
        next.bytes = image.buffer.length;
        next.data = image.buffer.toString('base64');
        next.width = normalizeDimension(input.width);
        next.height = normalizeDimension(input.height);
      }
      next.updatedAt = now().toISOString();
      const updated = [...logos];
      updated[index] = next;
      await writeLogos(updated);
      return publicLogo(next);
    });
  }

  function deleteLogo(id) {
    return locked(async () => {
      const logos = await readLogos();
      const remaining = logos.filter((item) => item.id !== id);
      if (remaining.length === logos.length) throw new ReadyStampError(404, 'Logo not found.');
      await writeLogos(remaining);
      return { deleted: id };
    });
  }

  async function getSettings() {
    const value = await readJsonFile(settingsFile, {});
    const placement = normalizePlacement(value?.placement) || structuredClone(DEFAULT_READY_STAMP_PLACEMENT);
    const align = normalizeAlign(value?.align) || { ...DEFAULT_READY_STAMP_ALIGN };
    return { placement, align, updatedAt: value?.updatedAt || null, isDefault: !value?.placement };
  }

  function saveSettings(input = {}) {
    return locked(async () => {
      const placement = normalizePlacement(input.placement);
      if (!placement) throw new ReadyStampError(400, 'Invalid logo placement.');
      const align = input.align === undefined ? { ...DEFAULT_READY_STAMP_ALIGN } : normalizeAlign(input.align);
      if (!align) throw new ReadyStampError(400, 'Invalid logo anchor.');
      const stored = { placement, align, updatedAt: now().toISOString() };
      await writeJsonFile(settingsFile, stored);
      return { ...stored, isDefault: false };
    });
  }

  return { listLogos, getLogoImage, createLogo, updateLogo, deleteLogo, getSettings, saveSettings };
}
