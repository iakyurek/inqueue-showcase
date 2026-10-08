import http from 'http';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath, pathToFileURL } from 'url';
import { google } from 'googleapis';
import {
  getSessionFromRequest,
  isPublicPath,
  clearSessionCookieHeader,
} from '../lib/auth.js';
import {
  verifySsoTicket,
  newToolSessionCookieHeader,
  getToolSessionFromRequest,
  buildToolLaunchRedirect,
  sanitizeNextPath,
} from '../lib/sso.js';
import { getServiceAuthFromRequest, createServiceToken } from '../lib/serviceAuth.js';
import { createStateStore } from './stateStore.js';
import { createReadyStampService, ReadyStampError } from './readyStamp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(filename) {
  const envPath = path.join(__dirname, filename);
  if (!fsSync.existsSync(envPath)) return;
  const raw = fsSync.readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile('.env');
loadEnvFile('.env.local');

// Also pull the shared inQueue session secret from the root .env.local so
// Preply verifies the same signed cookie the hub issues.
(function loadRootInQueueEnv() {
  const rootEnv = path.join(__dirname, '..', '.env.local');
  if (!fsSync.existsSync(rootEnv)) return;
  for (const line of fsSync.readFileSync(rootEnv, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const key = t.slice(0, i).trim();
    if (!key.startsWith('INQUEUE_')) continue;
    let value = t.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const INQUEUE_HUB_URL = process.env.INQUEUE_HUB_URL || 'http://localhost:4000';
// OAuth callback must be reachable without a session (Google redirects the
// user's browser here after consent; the code exchange itself proves identity).
const PREPLY_AUTH_EXEMPT_PREFIXES = ['/api/drive/oauth/callback'];

// Store-config source-of-truth flag. 'local' (default): stores.json is edited
// here and hub sync runs in dry-run mode. 'hub': the inQueue hub pushes store
// configuration through /api/internal/config-sync, which applies it via
// saveStores(); the Store Settings tab becomes an emergency escape hatch.
function getStoreConfigSource() {
  return process.env.INQUEUE_STORE_CONFIG_SOURCE === 'hub' ? 'hub' : 'local';
}

const PORT = Number(process.env.PORT || 3001);
const PUBLIC_DIR = path.join(__dirname, 'public');
const BLANK_MOCKUPS_DIR = path.join(__dirname, 'BlankMockups');
const STORE_LOGOS_DIR = path.join(__dirname, 'StoreLogos');
const FREE_SHIPPING_DIR = path.join(__dirname, 'FreeShippingLogo');
// PREPLY_DATA_DIR lets the test suite run against a scratch directory instead
// of the production data files (two processes writing data/batches.json
// concurrently is what corrupted it).
const DATA_DIR = process.env.PREPLY_DATA_DIR
  ? path.resolve(process.env.PREPLY_DATA_DIR)
  : path.join(__dirname, 'data');
const STORES_FILE = path.join(DATA_DIR, 'stores.json');
const BATCHES_FILE = path.join(DATA_DIR, 'batches.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SKU_LEDGER_FILE = path.join(DATA_DIR, 'sku-ledger.json');
const MOCKUP_PRESETS_FILE = path.join(DATA_DIR, 'mockup-presets.json');
const HUB_CONFIG_STATE_FILE = path.join(DATA_DIR, 'hub-config-state.json');
// Ready Mockups (stamp-only workflow): logo library + default logo placement.
const READY_STAMP_LOGOS_FILE = path.join(DATA_DIR, 'ready-stamp-logos.json');
const READY_STAMP_SETTINGS_FILE = path.join(DATA_DIR, 'ready-stamp-settings.json');
const STORES_BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MOCK_DRIVE_DIR = path.join(DATA_DIR, 'mock-drive');
const SOURCE_DESIGNS_DIR = path.join(DATA_DIR, 'source-designs');
const BATCH_EXPORTS_DIR = path.join(MOCK_DRIVE_DIR, 'batch-exports');
const BATCHLY_DOWNLOADS_DIR = process.env.PREPLY_BATCHLY_DOWNLOADS_DIR
  ? path.resolve(process.env.PREPLY_BATCHLY_DOWNLOADS_DIR)
  : path.join(__dirname, '..', 'batchly', 'workspace', 'downloads');
const LOGS_DIR = path.join(__dirname, 'logs');
const DRIVE_EXPORT_REPORT_FILE = path.join(LOGS_DIR, 'drive_export_report.json');
// Chunked Batchly handoff staging (Phase 3). Each in-flight export has its
// own subdir here; on finalize the contents are atomically moved to the
// selected destinations (local BATCHLY_DOWNLOADS_DIR and/or the Drive
// pending-batches folder). Never served, never listed.
const HANDOFF_STAGING_DIR = path.join(DATA_DIR, 'handoff-staging');
// Mock pending-batches folder used when GOOGLE_DRIVE_AUTH_MODE=mock — mirrors
// the Drive tree Batchly expects at PREPLY_PENDING_BATCHES_FOLDER_ID.
const MOCK_PENDING_BATCHES_DIR = path.join(MOCK_DRIVE_DIR, 'pending-batches');

// -- Durable state (Postgres write-through) -------------------------------------
// Files whose contents must survive a redeploy even without a persistent disk.
// When PREPLY_DATABASE_URL is set, every write to one of these files also
// upserts the JSON into the preply_state table, and boot hydrates the disk
// copies from the table (see hydrateDurableState). Binary caches
// (source-designs, mock-drive, handoff staging) and the stores.json backups
// are intentionally NOT here — they are regenerable or advisory.
// NOTE: OAUTH_TOKEN_FILE is registered further down where it is defined.
const DURABLE_STATE_FILES = new Map([
  [STORES_FILE, 'stores.json'],
  [BATCHES_FILE, 'batches.json'],
  [SETTINGS_FILE, 'settings.json'],
  [SKU_LEDGER_FILE, 'sku-ledger.json'],
  [MOCKUP_PRESETS_FILE, 'mockup-presets.json'],
  [HUB_CONFIG_STATE_FILE, 'hub-config-state.json'],
  [DRIVE_EXPORT_REPORT_FILE, 'drive_export_report.json'],
  [READY_STAMP_LOGOS_FILE, 'ready-stamp-logos.json'],
  [READY_STAMP_SETTINGS_FILE, 'ready-stamp-settings.json'],
]);
let stateStore = createStateStore(process.env.PREPLY_DATABASE_URL);

function __setStateStoreForTests(store) {
  stateStore = store;
}

// Ready Mockups stamp-only workflow. Uses the same durable JSON helpers and the
// same placement validation as the batch Stamp step; touches nothing else.
const readyStamp = createReadyStampService({
  logosFile: READY_STAMP_LOGOS_FILE,
  settingsFile: READY_STAMP_SETTINGS_FILE,
  readJsonFile,
  writeJsonFile,
  normalizePlacement: normalizeStampPlacement,
});

// Small bounded JSON reader for the Ready Mockups API: a logo upload is at most
// a few MB of base64, so there is no reason to accept the 250 MB batch limit.
async function readReadyStampBody(req) {
  const raw = await readRawBody(req, 8 * 1024 * 1024);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ReadyStampError(400, 'Invalid JSON body.');
  }
}

// Existing store logos (Store Settings) the operator can import into the
// library in one click. Read-only; reuses the store list and logo folders.
async function readyStampStoreLogoSources() {
  // Sequential on purpose: both helpers run Preply's first-boot file seeding,
  // which is not safe to run concurrently on a fresh data dir.
  const logoDirs = await getStoreLogos();
  const stores = await readStores();
  const urlByDir = new Map(logoDirs.filter((dir) => dir.url).map((dir) => [dir.name, dir.url]));
  return stores
    .filter((store) => store.logoDir && urlByDir.has(store.logoDir))
    .map((store) => ({
      storeName: store.name || store.storeName,
      active: Boolean(store.active),
      url: urlByDir.get(store.logoDir),
    }));
}

async function handleReadyStampApi(req, res, pathname) {
  try {
    if (pathname === '/api/ready-stamp/logos') {
      if (req.method === 'GET') return json(res, 200, { logos: await readyStamp.listLogos() });
      if (req.method === 'POST') return json(res, 201, { logo: await readyStamp.createLogo(await readReadyStampBody(req)) });
      return json(res, 405, { error: 'Method not allowed.' });
    }
    const imageMatch = /^\/api\/ready-stamp\/logos\/([A-Za-z0-9-]{1,64})\/image$/.exec(pathname);
    if (imageMatch) {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
      const image = await readyStamp.getLogoImage(imageMatch[1]);
      if (!image) return json(res, 404, { error: 'Logo not found.' });
      // The client always requests ?v=<updatedAt>, so a changed logo gets a new URL.
      return send(res, 200, image.buffer, {
        'Content-Type': image.mime,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
    }
    const logoMatch = /^\/api\/ready-stamp\/logos\/([A-Za-z0-9-]{1,64})$/.exec(pathname);
    if (logoMatch) {
      if (req.method === 'PATCH') return json(res, 200, { logo: await readyStamp.updateLogo(logoMatch[1], await readReadyStampBody(req)) });
      if (req.method === 'DELETE') return json(res, 200, await readyStamp.deleteLogo(logoMatch[1]));
      return json(res, 405, { error: 'Method not allowed.' });
    }
    if (pathname === '/api/ready-stamp/settings') {
      if (req.method === 'GET') return json(res, 200, await readyStamp.getSettings());
      if (req.method === 'PUT') return json(res, 200, await readyStamp.saveSettings(await readReadyStampBody(req)));
      return json(res, 405, { error: 'Method not allowed.' });
    }
    if (pathname === '/api/ready-stamp/store-logo-sources' && req.method === 'GET') {
      return json(res, 200, { sources: await readyStampStoreLogoSources() });
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    if (error instanceof ReadyStampError) return json(res, error.statusCode, { error: error.message });
    if (/Request body too large/.test(error?.message || '')) return json(res, 413, { error: 'Upload is too large.' });
    throw error;
  }
}

// -- Phase 5: persisted app settings -------------------------------------------
// settings.json carries UI-editable settings alongside the older keys
// (minimumSelectedMockups etc.). Persisted values win; env vars are the
// deploy-time fallback, so clearing a value in the UI reverts to env. A single
// Preply process is the only writer of settings.json, so an in-memory cache is
// safe and keeps getHandoffMode()/getPendingBatchesFolderId() synchronous for
// the handoff pipeline. If Preply ever runs multiple instances, replace the
// cache with a read-per-request.
let settingsCache = null;

async function loadSettingsCache() {
  settingsCache = await readJsonFile(SETTINGS_FILE, {});
  return settingsCache;
}

function getCachedSettings() {
  return settingsCache || {};
}

const HANDOFF_MODES = ['local', 'drive', 'both'];
// folderId recorded for mock-mode pending-folder tests (there is no real
// Drive folder; uploads go to MOCK_PENDING_BATCHES_DIR).
const MOCK_PENDING_FOLDER_TOKEN = 'mock-pending-batches';

// -- Phase 3: Batchly handoff mode --------------------------------------------
// local: write only to BATCHLY_DOWNLOADS_DIR (current behavior, dev default).
// drive: upload only to the Drive pending-batches folder (Render/prod).
// both:  do both; fail the whole handoff if either fails (transitional).
function getHandoffMode() {
  const persisted = String(getCachedSettings().handoffMode || '').trim().toLowerCase();
  if (HANDOFF_MODES.includes(persisted)) return persisted;
  const raw = String(process.env.PREPLY_BATCHLY_HANDOFF_MODE || 'local').trim().toLowerCase();
  return HANDOFF_MODES.includes(raw) ? raw : 'local';
}
function getPendingBatchesFolderId() {
  const persisted = String(getCachedSettings().pendingBatchesFolderId || '').trim();
  if (persisted) return persisted;
  return String(process.env.PREPLY_PENDING_BATCHES_FOLDER_ID || '').trim();
}

function describeHandoffMode() {
  const persisted = String(getCachedSettings().handoffMode || '').trim().toLowerCase();
  if (HANDOFF_MODES.includes(persisted)) return { value: persisted, source: 'settings' };
  const env = String(process.env.PREPLY_BATCHLY_HANDOFF_MODE || '').trim().toLowerCase();
  if (HANDOFF_MODES.includes(env)) return { value: env, source: 'env' };
  return { value: 'local', source: 'default' };
}

function describePendingBatchesFolder() {
  const persisted = String(getCachedSettings().pendingBatchesFolderId || '').trim();
  if (persisted) return { value: persisted, source: 'settings' };
  const env = String(process.env.PREPLY_PENDING_BATCHES_FOLDER_ID || '').trim();
  if (env) return { value: env, source: 'env' };
  return { value: '', source: 'default' };
}
// Cap the per-chunk request body to keep browser memory and node buffer sane.
// Each chunk is a JSON array of {path, base64}; 20 rendered JPEGs at ~500 KB
// base64-encoded is ~13 MB, well under the 32 MB ceiling.
const HANDOFF_CHUNK_MAX_BYTES = 32 * 1024 * 1024;
const ACCEPTED_IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);
const MOCKUP_IMAGES = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
// OAuth user-upload config. Uploads run as a real Google user (who has My Drive
// storage quota), so files land inside the personal store folder — something a
// service account can never do. Client creds come from google-oauth-client.json
// (downloaded from Google Cloud Console) or env vars; the refresh token earned
// from the one-time consent is stored durably in data/google-oauth-token.json.
const OAUTH_CLIENT_FILE = path.join(__dirname, 'google-oauth-client.json');
const OAUTH_TOKEN_FILE = path.join(DATA_DIR, 'google-oauth-token.json');
// The refresh token must survive redeploys without a disk — losing it means
// reconnecting Google Drive after every deploy.
DURABLE_STATE_FILES.set(OAUTH_TOKEN_FILE, 'google-oauth-token.json');
const OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${PORT}/api/drive/oauth/callback`;
let cachedDriveClient = null;
let cachedOAuthDriveClient = null;
let cachedDriveStatus = null;
let driveClientInstanceSeq = 0;

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon'
  }[ext] || 'application/octet-stream';
}

function safeJoin(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const target = path.normalize(path.join(baseDir, decoded));
  if (!target.startsWith(baseDir)) return null;
  return target;
}

async function ensureDirs() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(BLANK_MOCKUPS_DIR, { recursive: true });
  await fs.mkdir(STORE_LOGOS_DIR, { recursive: true });
  await fs.mkdir(FREE_SHIPPING_DIR, { recursive: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(MOCK_DRIVE_DIR, { recursive: true });
  await fs.mkdir(SOURCE_DESIGNS_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await ensureDataFiles();
}

async function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Strict variant for state files whose silent loss breaks the workflow
// (batches, stores). A missing file is fine (fallback); a file that exists
// but cannot be parsed means corruption — fail loudly instead of pretending
// the state is empty, which is how a Drive export silently no-oped.
async function readJsonFileStrict(filePath, fallback) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (parseError) {
    const error = new Error(
      `${path.basename(filePath)} is corrupted (invalid JSON: ${parseError.message}). ` +
      `Refusing to continue with empty state. Restore it from a backup or repair the file at ${filePath}.`
    );
    error.code = 'STATE_FILE_CORRUPTED';
    console.error(`[state] ${error.message}`);
    throw error;
  }
}

// Atomic write: write the payload to a temp file in the same directory, then
// rename over the target. A crash or concurrent writer can no longer leave a
// half-written/mixed file behind.
async function writeJsonFileToDisk(filePath, value) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

// Disk write plus Postgres write-through for durable state files. When the
// DB write fails the error propagates: with PREPLY_DATABASE_URL set the
// database is the authoritative copy, so pretending the save succeeded would
// silently reintroduce the lost-on-deploy problem this layer exists to fix.
async function writeJsonFile(filePath, value) {
  await writeJsonFileToDisk(filePath, value);
  const stateKey = DURABLE_STATE_FILES.get(filePath);
  if (stateStore && stateKey) await stateStore.put(stateKey, value);
}

// Delete a state file from disk AND from the durable-state table (used by
// Drive disconnect, so a forgotten refresh token stays forgotten after the
// next deploy).
async function removeJsonFile(filePath) {
  await fs.rm(filePath, { force: true });
  const stateKey = DURABLE_STATE_FILES.get(filePath);
  if (stateStore && stateKey) await stateStore.remove(stateKey);
}

// Boot hydration: pull every durable key from Postgres onto disk before the
// server starts serving; seed the table from disk for keys it does not have
// yet (first boot after enabling PREPLY_DATABASE_URL keeps existing local
// state). Failure is fatal by design — with a database configured, starting
// from blank disk state would look like data loss and write it back.
let durableStateHydrated = false;
async function hydrateDurableState() {
  if (!stateStore || durableStateHydrated) return;
  durableStateHydrated = true;
  await stateStore.init();
  const rows = await stateStore.getAll();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(LOGS_DIR, { recursive: true });
  let hydrated = 0;
  let seeded = 0;
  for (const [filePath, key] of DURABLE_STATE_FILES) {
    if (rows.has(key)) {
      await writeJsonFileToDisk(filePath, rows.get(key));
      hydrated += 1;
    } else {
      try {
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        await stateStore.put(key, parsed);
        seeded += 1;
      } catch {
        // No disk file (fresh instance) or unparsable JSON (never seed
        // corruption into the durable copy) — ensureDataFiles will create
        // defaults and write-through as usual.
      }
    }
  }
  console.log(`[state] durable state: ${hydrated} hydrated from Postgres, ${seeded} seeded from disk`);
}

function titleCaseFromSlug(input) {
  return String(input || '')
    .replace(/-logo$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function storeCodeFromName(name) {
  const words = String(name || '').match(/[A-Z]?[a-z]+|[A-Z]+|\d+/g) || [];
  const code = words.map(word => word[0]).join('').toUpperCase().slice(0, 3);
  return code || 'ST';
}

function safeId(input, fallback = 'item') {
  return String(input || fallback)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || fallback;
}

function safeFilename(input, fallback = 'source.png') {
  const name = String(input || fallback).split(/[\\/]/).pop() || fallback;
  return name.replace(/[^A-Za-z0-9._-]/g, '_') || fallback;
}

function sourceDesignPath(batchId, filename) {
  return path.join(SOURCE_DESIGNS_DIR, safeId(batchId, 'batch'), safeFilename(filename));
}

function decodeSourcePngBase64(input) {
  const raw = String(input || '').trim();
  if (!raw) return Buffer.alloc(0);
  const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
  return Buffer.from(base64, 'base64');
}

async function writeSourceDesignFile(batchId, designId, filename, base64) {
  const data = decodeSourcePngBase64(base64);
  const target = sourceDesignPath(batchId, filename || `${designId}.png`);
  if (!data.length) return { path: target, exists: false, size: 0 };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return { path: target, exists: true, size: data.length };
}

async function persistBatchSourceDesigns(batch, designFiles = []) {
  const fileByDesign = new Map((designFiles || []).map(file => [file.designId, file]));
  for (const design of batch.designs || []) {
    const source = fileByDesign.get(design.id);
    const filename = design.filename || source?.filename || `${design.id}.png`;
    if (!source?.base64) {
      design.sourcePngPath = design.sourcePngPath || sourceDesignPath(batch.id, filename);
      continue;
    }
    const saved = await writeSourceDesignFile(batch.id, design.id, filename, source.base64);
    design.sourcePngPath = saved.path;
    design.sourcePngBytes = saved.size;
    design.sourcePngStoredAt = saved.exists ? new Date().toISOString() : design.sourcePngStoredAt || null;
  }
  return batch;
}

async function resolveLocalSourcePng(batch, design, designFile = null) {
  const filename = safeFilename(design.filename || designFile?.filename || `${design.id}.png`);
  const localPath = design.sourcePngPath || sourceDesignPath(batch.id, filename);
  if (designFile?.base64) {
    const saved = await writeSourceDesignFile(batch.id, design.id, filename, designFile.base64);
    design.sourcePngPath = saved.path;
    design.sourcePngBytes = saved.size;
    design.sourcePngStoredAt = saved.exists ? new Date().toISOString() : design.sourcePngStoredAt || null;
  } else {
    design.sourcePngPath = localPath;
  }

  let stat = null;
  try {
    stat = await fs.stat(design.sourcePngPath);
  } catch {
    const error = new Error(`Raw source design file for ${design.id} was not found locally. Cannot upload to Google Drive.`);
    error.code = 'SOURCE_PNG_MISSING';
    error.localPath = design.sourcePngPath;
    throw error;
  }
  if (!stat.isFile() || stat.size <= 0) {
    const error = new Error(`Raw source design file for ${design.id} was not found locally. Cannot upload to Google Drive.`);
    error.code = 'SOURCE_PNG_MISSING';
    error.localPath = design.sourcePngPath;
    throw error;
  }
  const buffer = await fs.readFile(design.sourcePngPath);
  return {
    designId: design.id,
    filename,
    path: design.sourcePngPath,
    exists: true,
    size: stat.size,
    buffer
  };
}

function getDriveMode() {
  const mode = String(process.env.GOOGLE_DRIVE_AUTH_MODE || 'mock').trim().toLowerCase();
  if (mode === 'service_account') return 'service_account';
  if (mode === 'oauth' || mode === 'oauth_user') return 'oauth';
  return 'mock';
}

// Any non-mock mode talks to the real Google Drive API and shares the same
// folder-scan / create / upload implementations; only the auth client differs.
function isRemoteDriveMode() {
  const mode = getDriveMode();
  return mode === 'service_account' || mode === 'oauth';
}

function getDriveAdapterLabel() {
  const mode = getDriveMode();
  if (mode === 'service_account') return 'Service Account Drive adapter';
  if (mode === 'oauth') return 'OAuth user Drive adapter';
  return 'Local mock Drive adapter';
}

function serviceAccountKeyPath() {
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './google-service-account.json';
  return path.isAbsolute(configured) ? configured : path.join(__dirname, configured);
}

function publicServiceAccountKeyPath() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './google-service-account.json';
}

async function readServiceAccountClientEmail() {
  try {
    const raw = await fs.readFile(serviceAccountKeyPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.client_email || null;
  } catch {
    return null;
  }
}

function userFriendlyDriveError(error) {
  const message = String(error?.message || error || 'Google Drive request failed.');
  const status = error?.code || error?.response?.status;
  // Pull the structured Google reason so we never mislabel a non-permission 403
  // (e.g. storageQuotaExceeded) as an access problem.
  const reasons = (error?.errors || error?.response?.data?.error?.errors || [])
    .map(item => item?.reason)
    .filter(Boolean);
  const reason = reasons[0] || '';
  if (message.includes('ENOENT')) return 'Google Drive credentials were not found. Check GOOGLE_SERVICE_ACCOUNT_KEY_PATH.';
  if (message.includes('private_key') || message.includes('JSON')) return 'Google Drive credentials are invalid. Check the service account JSON file.';
  // OAuth refresh-token failure: the stored Google Drive grant expired or was
  // revoked. This is not a folder-permission problem — the fix is to reconnect.
  // (If the Google Cloud OAuth app is still in "Testing" status, refresh tokens
  // expire every 7 days; publish the app to stop the weekly recurrence.)
  if (reason === 'invalid_grant' || /invalid_grant|token has been expired or revoked/i.test(message)) {
    return 'Google Drive session expired — reconnect Drive in Preply (Configure → Google Drive) to grant a fresh token. If this keeps happening weekly, publish the Google Cloud OAuth app (Testing status expires refresh tokens after 7 days).';
  }
  // Service-account-owned files in a personal (My Drive) folder cannot store
  // bytes — the SA has no Drive storage quota. This is NOT a permission issue.
  if (reason === 'storageQuotaExceeded' || /storage quota/i.test(message)) {
    return 'Google Drive rejected the upload: the service account has no storage quota for this folder. The target folder lives in a personal My Drive, where files uploaded by a service account cannot be stored. Move the store folder into a Google Shared Drive, or switch this store to OAuth user upload.';
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
    return 'Google Drive rate limit hit. Wait a moment and use Retry Failed Drive Uploads.';
  }
  if (status === 404) return 'Invalid Google Drive folder ID, or the service account does not have access to this folder.';
  // Only treat a 403 as an access problem when Google actually says so.
  if (status === 403 && (reason === 'insufficientFilePermissions' || reason === 'forbidden' || !reason)) {
    return 'Google Drive upload failed because the service account lacks access to the upload target folder.';
  }
  if (status === 403) return `Google Drive rejected the request (403 ${reason}). ${message}`;
  return message;
}

function driveApiErrorDetails(error) {
  if (error?.googleError) return error.googleError;
  const errors = error?.errors || error?.response?.data?.error?.errors || error?.response?.data?.error || null;
  const normalizedErrors = Array.isArray(errors) ? errors : errors ? [errors] : [];
  return {
    code: error?.code || error?.response?.status || null,
    message: error?.message || String(error || ''),
    errors,
    reasons: normalizedErrors.map(item => item?.reason).filter(Boolean),
    domains: normalizedErrors.map(item => item?.domain).filter(Boolean)
  };
}

function buildDriveUploadFailure({ store, sku, phase, folderId, error }) {
  const raw = userFriendlyDriveError(error);
  const storeName = store?.name || 'store';
  if (phase === 'parent_access') {
    return `Parent store folder inaccessible for ${storeName}. ${raw}`;
  }
  if (phase === 'folder_missing') {
    return `SKU folder created but its folder ID is missing for ${storeName} / ${sku}.`;
  }
  if (phase === 'multiple_folders') {
    return `Multiple SKU folders found for ${storeName} / ${sku}. Retry could not choose a safe target.`;
  }
  if (phase === 'folder_access') {
    return `SKU folder ${folderId || sku} is not accessible for ${storeName} / ${sku}. ${raw}`;
  }
  if (phase === 'upload') {
    return `SKU folder created but upload failed for ${storeName} / ${sku}. Target folder ID: ${folderId || 'missing'}. ${raw}`;
  }
  return raw;
}

function driveFailureError({ store, sku, phase, folderId, error, operation = null }) {
  const wrapped = new Error(buildDriveUploadFailure({ store, sku, phase, folderId, error }));
  wrapped.googleError = driveApiErrorDetails(error);
  wrapped.operation = operation;
  wrapped.targetFolderId = folderId || null;
  return wrapped;
}

async function getServiceAccountDriveClient() {
  if (cachedDriveClient) return cachedDriveClient;
  const keyFile = serviceAccountKeyPath();
  if (!fsSync.existsSync(keyFile)) {
    throw new Error('Google Drive credentials were not found. Check GOOGLE_SERVICE_ACCOUNT_KEY_PATH.');
  }
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: [DRIVE_SCOPE]
  });
  const authClient = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: authClient });
  cachedDriveClient = {
    drive,
    clientEmail: await readServiceAccountClientEmail(),
    keyPath: publicServiceAccountKeyPath(),
    scopes: [DRIVE_SCOPE],
    instanceId: `service-account-drive-${++driveClientInstanceSeq}`
  };
  console.log(`[Drive auth] instance=${cachedDriveClient.instanceId} clientEmail=${cachedDriveClient.clientEmail || 'unknown'} keyPath=${cachedDriveClient.keyPath} scopes=${cachedDriveClient.scopes.join(',')}`);
  return cachedDriveClient;
}

function __setServiceAccountDriveClientForTests(client) {
  cachedDriveClient = client;
}

function __clearServiceAccountDriveClientForTests() {
  cachedDriveClient = null;
}

function __setOAuthDriveClientForTests(client) {
  cachedOAuthDriveClient = client;
}

function __clearOAuthDriveClientForTests() {
  cachedOAuthDriveClient = null;
}

// ---- OAuth user upload -------------------------------------------------------

function loadOAuthClientConfig() {
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, redirectUri: OAUTH_REDIRECT_URI, source: 'env' };
  }
  if (fsSync.existsSync(OAUTH_CLIENT_FILE)) {
    try {
      const parsed = JSON.parse(fsSync.readFileSync(OAUTH_CLIENT_FILE, 'utf8'));
      const block = parsed.web || parsed.installed || parsed;
      if (block?.client_id && block?.client_secret) {
        const redirectUri = (Array.isArray(block.redirect_uris) && block.redirect_uris[0]) || OAUTH_REDIRECT_URI;
        return { clientId: block.client_id, clientSecret: block.client_secret, redirectUri, source: 'file' };
      }
    } catch {
      // fall through to "not configured"
    }
  }
  return null;
}

function createOAuth2Client() {
  const config = loadOAuthClientConfig();
  if (!config) return null;
  const client = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
  return client;
}

async function readOAuthToken() {
  try {
    const raw = await fs.readFile(OAUTH_TOKEN_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeOAuthToken(token) {
  await fs.mkdir(path.dirname(OAUTH_TOKEN_FILE), { recursive: true });
  await writeJsonFile(OAUTH_TOKEN_FILE, token);
  cachedOAuthDriveClient = null;
}

function buildOAuthConsentUrl() {
  const client = createOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [DRIVE_SCOPE]
  });
}

async function exchangeOAuthCode(code) {
  const client = createOAuth2Client();
  if (!client) throw new Error('OAuth client is not configured. Add google-oauth-client.json or GOOGLE_OAUTH_CLIENT_ID/SECRET.');
  const { tokens } = await client.getToken(code);
  const existing = await readOAuthToken();
  // Google only returns refresh_token on the first consent; preserve it on refresh.
  const refresh_token = tokens.refresh_token || existing?.refresh_token;
  if (!refresh_token) throw new Error('Google did not return a refresh token. Revoke prior access and reconnect with prompt=consent.');
  client.setCredentials({ ...tokens, refresh_token });
  let email = null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    email = (await oauth2.userinfo.get()).data.email || null;
  } catch {
    // userinfo scope not granted; email is optional metadata
  }
  const stored = { refresh_token, scope: tokens.scope || DRIVE_SCOPE, connected_email: email, connected_at: new Date().toISOString() };
  await writeOAuthToken(stored);
  return stored;
}

async function getOAuthDriveClient() {
  if (cachedOAuthDriveClient) return cachedOAuthDriveClient;
  const client = createOAuth2Client();
  if (!client) throw new Error('OAuth client is not configured. Add google-oauth-client.json (from Google Cloud Console) or set GOOGLE_OAUTH_CLIENT_ID/SECRET.');
  const token = await readOAuthToken();
  if (!token?.refresh_token) throw new Error('Google Drive is not connected. Open the Connect Google Drive link to authorize uploads as your user.');
  client.setCredentials({ refresh_token: token.refresh_token });
  const drive = google.drive({ version: 'v3', auth: client });
  cachedOAuthDriveClient = {
    drive,
    clientEmail: token.connected_email || 'oauth-user',
    keyPath: fsSync.existsSync(OAUTH_CLIENT_FILE) ? 'google-oauth-client.json' : 'env:GOOGLE_OAUTH_CLIENT_ID',
    scopes: [DRIVE_SCOPE],
    instanceId: `oauth-user-drive-${++driveClientInstanceSeq}`
  };
  console.log(`[Drive auth] instance=${cachedOAuthDriveClient.instanceId} oauthUser=${cachedOAuthDriveClient.clientEmail} scopes=${cachedOAuthDriveClient.scopes.join(',')}`);
  return cachedOAuthDriveClient;
}

// Returns whichever real-Drive client matches the active mode. All folder/scan/
// upload helpers use this so OAuth and service-account modes share one code path.
async function getRemoteDriveClient() {
  return getDriveMode() === 'oauth' ? getOAuthDriveClient() : getServiceAccountDriveClient();
}

async function getOAuthStatus() {
  const config = loadOAuthClientConfig();
  const token = await readOAuthToken();
  return {
    client_configured: Boolean(config),
    client_source: config?.source || null,
    redirect_uri: config?.redirectUri || OAUTH_REDIRECT_URI,
    connected: Boolean(token?.refresh_token),
    connected_email: token?.connected_email || null,
    connected_at: token?.connected_at || null
  };
}

async function getDriveStatus() {
  const mode = getDriveMode();
  const base = {
    mode,
    adapterLabel: getDriveAdapterLabel(),
    configured: mode === 'mock',
    clientEmail: null,
    keyPath: mode === 'service_account' ? publicServiceAccountKeyPath() : null,
    error: ''
  };
  if (mode === 'mock') return base;
  if (mode === 'oauth') {
    const oauth = await getOAuthStatus();
    base.oauth = oauth;
    base.clientEmail = oauth.connected_email;
    base.configured = oauth.client_configured && oauth.connected;
    if (!oauth.client_configured) base.error = 'OAuth client is not configured. Add google-oauth-client.json (from Google Cloud Console) or set GOOGLE_OAUTH_CLIENT_ID/SECRET.';
    else if (!oauth.connected) base.error = 'Google Drive is not connected. Open Connect Google Drive to authorize uploads as your user.';
    cachedDriveStatus = base;
    return base;
  }
  const keyFile = serviceAccountKeyPath();
  base.clientEmail = await readServiceAccountClientEmail();
  base.configured = fsSync.existsSync(keyFile) && Boolean(base.clientEmail);
  if (!fsSync.existsSync(keyFile)) base.error = 'Google Drive credentials were not found. Check GOOGLE_SERVICE_ACCOUNT_KEY_PATH.';
  else if (!base.clientEmail) base.error = 'Google Drive credentials are invalid. Missing client_email.';
  cachedDriveStatus = base;
  return base;
}

function logDriveScan(store, scan) {
  console.log(`[Drive] mode=${getDriveMode()} adapter="${getDriveAdapterLabel()}"`);
  if (getDriveMode() === 'service_account') {
    console.log(`[Drive] keyPath=${publicServiceAccountKeyPath()} clientEmail=${scan.serviceAccountEmail || 'unknown'}`);
  }
  console.log(`[Drive] scanning store="${store.name}" folderId=${store.skuRootFolderId}`);
  console.log(`[Drive] store="${store.name}" skuFolders=${scan.folderCount} latest=${scan.latestSku || 'none'}`);
}

function driveRootIdForStore(store) {
  return store.skuRootFolderId || `mock-drive-${safeId(store.id || store.name, 'store')}`;
}

function normalizeStore(store, index = 0) {
  const id = safeId(store.id || store.code || `store-${index + 1}`, `store-${index + 1}`);
  const name = String(store.name || `Store ${index + 1}`).trim();
  const code = String(store.code || store.storeCode || storeCodeFromName(name)).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'ST';
  const skuPrefix = String(store.skuPrefix || store.sku_prefix || code || 'ST').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'ST';
  const skuRootFolderId = String(store.skuRootFolderId || store.sku_root_folder_id || `mock-drive-${id}`).trim();
  return {
    id,
    name,
    storeName: name,
    code,
    storeCode: code,
    skuPrefix,
    sku_prefix: skuPrefix,
    latestSkuNumber: Math.max(0, Number.parseInt(store.latestSkuNumber, 10) || 0),
    // A store with no active flag stays INACTIVE. Defaulting to active let
    // seed/demo stores with placeholder Drive IDs sneak into production SKU
    // reservation and fail whole batches; activation must be an explicit
    // operator action in store settings.
    active: Boolean(store.active ?? store.active_status ?? false),
    active_status: Boolean(store.active ?? store.active_status ?? false),
    logoDir: String(store.logoDir || store.id || '').trim(),
    logoFile: store.logoFile || null,
    logoUrl: store.logoUrl || store.store_logo || null,
    store_logo: store.logoUrl || store.store_logo || null,
    driveConnectionLabel: getDriveAdapterLabel(),
    google_drive_connection_label: getDriveAdapterLabel(),
    skuRootFolderId,
    sku_root_folder_id: skuRootFolderId,
    latestDetectedSku: store.latestDetectedSku || null,
    latestDetectedNumber: Number.isFinite(Number(store.latestDetectedNumber)) ? Number(store.latestDetectedNumber) : null,
    nextSkuPreview: store.nextSkuPreview || null,
    lastSkuScanAt: store.lastSkuScanAt || null,
    skuScanStatus: store.skuScanStatus || 'not_scanned',
    skuScanError: store.skuScanError || '',
    notes: String(store.notes || ''),
    store_folder: String(store.store_folder || '').trim().replace(/[^A-Za-z0-9_-]/g, '') || null
  };
}

async function inferStoreSeed() {
  const entries = await fs.readdir(STORE_LOGOS_DIR, { withFileTypes: true }).catch(() => []);
  const assets = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const shopDir = path.join(STORE_LOGOS_DIR, entry.name);
    const files = await fs.readdir(shopDir, { withFileTypes: true }).catch(() => []);
    const logo = files
      .filter(file => file.isFile() && ACCEPTED_IMAGES.has(path.extname(file.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
    assets.push({
      name: entry.name,
      filename: logo?.name || null,
      url: logo ? `/store-logos/${encodeURIComponent(entry.name)}/${encodeURIComponent(logo.name)}` : null
    });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name));
  return assets.slice(0, 8).map((asset, index) => {
    const name = titleCaseFromSlug(asset.name).replace(/\s+/g, '');
    const code = storeCodeFromName(name);
    return {
      id: asset.name,
      name,
      storeName: name,
      code,
      storeCode: code,
      skuPrefix: code,
      sku_prefix: code,
      latestSkuNumber: 0,
      // Seeded stores start inactive: they carry placeholder mock-drive IDs,
      // and an operator must configure a real Drive folder before activating.
      active: false,
      active_status: false,
      logoDir: asset.name,
      logoFile: asset.filename,
      logoUrl: asset.url,
      store_logo: asset.url,
      driveConnectionLabel: getDriveAdapterLabel(),
      google_drive_connection_label: getDriveAdapterLabel(),
      skuRootFolderId: `mock-drive-${safeId(asset.name)}`,
      sku_root_folder_id: `mock-drive-${safeId(asset.name)}`,
      latestDetectedSku: null,
      latestDetectedNumber: null,
      nextSkuPreview: null,
      lastSkuScanAt: null,
      skuScanStatus: 'not_scanned',
      skuScanError: '',
      notes: index >= 8 ? 'Inactive by default because Preply allows up to 8 active stores.' : ''
    };
  });
}

async function ensureDataFiles() {
  try {
    await fs.access(STORES_FILE);
  } catch {
    await writeJsonFile(STORES_FILE, await inferStoreSeed());
  }
  try {
    await fs.access(BATCHES_FILE);
  } catch {
    await writeJsonFile(BATCHES_FILE, []);
  }
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await writeJsonFile(SETTINGS_FILE, {
      minimumSelectedMockups: 1,
      createdAt: new Date().toISOString(),
      appName: 'Preply'
    });
  }
  try {
    await fs.access(SKU_LEDGER_FILE);
  } catch {
    await writeJsonFile(SKU_LEDGER_FILE, []);
  }
  try {
    await fs.access(MOCKUP_PRESETS_FILE);
  } catch {
    await writeJsonFile(MOCKUP_PRESETS_FILE, []);
  }
}

async function readStores() {
  await ensureDataFiles();
  const stores = await readJsonFileStrict(STORES_FILE, []);
  const assets = await getStoreLogos();
  return stores.map((store, index) => {
    const normalized = normalizeStore(store, index);
    const asset = assets.find(item => item.name === store.logoDir) || assets.find(item => item.name === store.id);
    return {
      ...normalized,
      logoFile: asset?.filename || normalized.logoFile || null,
      logoUrl: asset?.url || normalized.logoUrl || null,
      store_logo: asset?.url || normalized.logoUrl || null
    };
  });
}

// Activation gate: a store may only be active if it is actually export-ready.
// An INACTIVE store can be saved with any incomplete config (a placeholder
// Drive id, no folder, no logo) — the gate only inspects active stores. In mock
// mode a placeholder mock-drive-* id is allowed (tests/local); in any remote
// mode (service_account/oauth) it is rejected because it cannot receive real
// uploads. `raw` is the pre-normalized payload so a missing skuPrefix is caught
// (normalizeStore always backfills one from the code/name).
function activeStoreReadinessError(store, raw, assets) {
  const missing = [];
  const rawPrefix = String(raw?.skuPrefix ?? raw?.sku_prefix ?? '').trim();
  if (!rawPrefix) missing.push('a SKU prefix');

  const folderId = String(store.skuRootFolderId || '');
  if (!folderId) {
    missing.push('a Google Drive SKU root folder ID');
  } else if (isRemoteDriveMode() && folderId.startsWith('mock-drive-')) {
    missing.push(`a real Google Drive SKU root folder ID (still using placeholder "${folderId}")`);
  }

  if (!store.store_folder) missing.push('a Batchly folder (Store_A–H)');

  const assetUrl = (assets.find(item => item.name === store.logoDir) || assets.find(item => item.name === store.id))?.url || null;
  if (!assetUrl && !store.logoUrl) missing.push('a store logo');

  return missing.length ? `${store.name || store.id}: needs ${missing.join(', ')} before it can be active.` : null;
}

// Diagnostics (Drive tests, SKU scans) only update scan metadata — they never
// change activation state, so they must not run the activation gate. Before
// this helper, one legacy store that was active with an invalid folder made
// saveStores throw on EVERY diagnostic call (including inside catch blocks),
// surfacing as a 500 instead of the real Drive result.
async function patchStoreScanState(storeId, patch) {
  const stores = await readStores();
  const store = stores.find(item => item.id === storeId);
  if (!store) return null;
  Object.assign(store, patch);
  await writeJsonFile(STORES_FILE, stores.map(item => normalizeStore(item)));
  return store;
}

async function saveStores(stores) {
  const input = Array.isArray(stores) ? stores : [];
  const clean = input.map(store => normalizeStore(store));
  if (clean.filter(store => store.active).length > 8) throw new Error('Preply supports up to 8 active stores.');
  const foldersSeen = new Set();
  for (const store of clean) {
    if (!store.store_folder) continue;
    if (foldersSeen.has(store.store_folder)) throw new Error(`Duplicate Batchly folder "${store.store_folder}". Each store needs a unique folder assignment.`);
    foldersSeen.add(store.store_folder);
  }
  // Block activation of any store that is not export-ready. Inactive stores are
  // never inspected, so incomplete inactive stores still save fine.
  const assets = await getStoreLogos();
  const activationErrors = [];
  clean.forEach((store, index) => {
    if (!store.active) return;
    const error = activeStoreReadinessError(store, input[index] || {}, assets);
    if (error) activationErrors.push(error);
  });
  if (activationErrors.length) {
    const error = new Error(`Cannot activate ${activationErrors.length} store${activationErrors.length === 1 ? '' : 's'}: ${activationErrors.join(' ')}`);
    error.statusCode = 400;
    throw error;
  }
  await writeJsonFile(STORES_FILE, clean);
  return readStores();
}

// -- Drive throughput helpers ----------------------------------------------------
// Sequential Drive round-trips dominated export time (30 designs x 6 stores =
// thousands of serial calls). Uploads are independent per file/SKU, so a small
// concurrent pool cuts wall time ~4-5x while staying far under Drive's rate
// limits. Retries cover the transient hangs/resets that froze exports mid-way.
const DRIVE_UPLOAD_CONCURRENCY = 5;

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

function isTransientDriveError(error) {
  const status = Number(error?.code || error?.response?.status || 0);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|EAI_AGAIN/i.test(String(error?.message || ''));
}

async function withDriveRetry(fn, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientDriveError(error)) throw error;
      console.warn(`[Drive retry] ${label} attempt ${attempt} failed (${error.message}); retrying...`);
      await new Promise(resolve => setTimeout(resolve, 800 * attempt));
    }
  }
  throw lastError;
}

// -- Post-export Batchly notification -------------------------------------------
// After a drive-mode handoff lands in the pending-batches folder, Preply pings
// Batchly's service-token scan endpoint so the batch is scanned and visible in
// Batchly's Batches page with zero operator steps. Free-tier Batchly may be
// asleep: retry through the cold start (~60s) before giving up. A failure here
// is NON-fatal — the batch is already durable in Drive; Batchly's own manual
// scan remains the fallback.
const BATCHLY_BASE_URL = (process.env.BATCHLY_BASE_URL || 'http://localhost:3030').replace(/\/$/, '');

async function notifyBatchlyScan({ batchFolderName, autoImport = false, quick = false } = {}) {
  const maxAttempts = quick ? 1 : 5;
  const perTryTimeoutMs = 20000;
  let lastError = 'unreachable';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perTryTimeoutMs);
    try {
      const response = await fetch(`${BATCHLY_BASE_URL}/api/internal/batches/scan-pending`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${createServiceToken({ svc: 'preply', aud: 'batchly' })}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchFolderName: batchFolderName || null, autoImport }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) {
        const batches = Array.isArray(body.batches) ? body.batches : [];
        const batch = body.batch || (batchFolderName
          ? batches.find(item => item.name === batchFolderName) || null
          : null);
        return { ok: true, attempts: attempt, woke: attempt > 1, batches_count: batches.length, batch };
      }
      // A definitive application-level refusal (Drive not connected on the
      // Batchly side, pending folder unset) will not improve with retries.
      if (response.status === 409) {
        return { ok: false, attempts: attempt, error: body.error || 'BATCHLY_REFUSED' };
      }
      lastError = body.error || `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.name === 'AbortError' ? 'timed out' : error.message;
    } finally {
      clearTimeout(timer);
    }
    if (quick) break;
    // Cold-start pacing: give the instance time to boot between attempts.
    await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 3000 : 8000));
  }
  return { ok: false, attempts: maxAttempts, error: `Batchly unreachable after ${maxAttempts} attempts (${lastError})` };
}

// -- Hub store-config sync (Phase: hub source of truth) -------------------------
// The inQueue hub pushes its full store configuration here. Preply maps the
// hub-owned fields onto its own store records (keyed by store_folder) and
// applies them through saveStores(), so every existing invariant — ≤8 active,
// unique store_folder, the activation gate — enforces itself. Fields the hub
// does not own (logos, SKU-scan state) are merge-preserved.

const HUB_SYNC_SLOT_RE = /^Store_[A-F]$/;
// Hub-owned fields, in hub payload vocabulary → mapped Preply fields.
const HUB_OWNED_FIELDS = ['displayName', 'enabled', 'skuPrefix', 'driveFolderId', 'notes'];

async function readHubConfigState() {
  return readJsonFile(HUB_CONFIG_STATE_FILE, { lastAppliedVersion: null, appliedAt: null });
}

async function writeHubConfigState(state) {
  await writeJsonFile(HUB_CONFIG_STATE_FILE, state);
}

function hubFieldFromPreply(store, field) {
  switch (field) {
    case 'displayName': return store?.name || '';
    case 'enabled': return store?.active === true;
    case 'skuPrefix': return store?.skuPrefix || '';
    case 'driveFolderId': return store?.skuRootFolderId || '';
    case 'notes': return store?.notes || '';
    default: return undefined;
  }
}

// Merge one hub store into the matching Preply record (or a fresh record when
// the slot has never existed here). Only hub-owned fields change.
function mapHubStoreToPreply(existing, hubStore) {
  const base = existing || {
    id: `${hubStore.slot.toLowerCase()}-hub`,
    latestSkuNumber: 0,
  };
  return {
    ...base,
    name: hubStore.displayName || base.name || hubStore.slot,
    storeName: hubStore.displayName || base.name || hubStore.slot,
    active: hubStore.enabled === true,
    active_status: hubStore.enabled === true,
    code: hubStore.skuPrefix || '',
    storeCode: hubStore.skuPrefix || '',
    skuPrefix: hubStore.skuPrefix || '',
    sku_prefix: hubStore.skuPrefix || '',
    skuRootFolderId: hubStore.driveFolderId || '',
    sku_root_folder_id: hubStore.driveFolderId || '',
    notes: hubStore.notes || '',
    store_folder: hubStore.slot,
  };
}

// Field-level diff between current stores.json and an incoming hub payload.
// Computed in BOTH modes: dry-run returns it instead of writing; apply returns
// it as a record of what changed.
function computeHubConfigDiff(currentStores, payload) {
  const diff = [];
  for (const hubStore of payload.stores) {
    const existing = currentStores.find(s => s.store_folder === hubStore.slot) || null;
    for (const field of HUB_OWNED_FIELDS) {
      const current = hubFieldFromPreply(existing, field);
      const incoming = field === 'enabled' ? hubStore[field] === true : (hubStore[field] || '');
      if (current !== incoming) diff.push({ slot: hubStore.slot, field, current, incoming });
    }
  }
  return diff;
}

function validateHubSyncPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'expected a JSON object';
  if (!Number.isInteger(payload.configVersion) || payload.configVersion < 0) return 'configVersion must be a non-negative integer';
  if (!Array.isArray(payload.stores)) return 'stores must be an array';
  for (const store of payload.stores) {
    if (!store || typeof store !== 'object' || !HUB_SYNC_SLOT_RE.test(store.slot || '')) {
      return `invalid store slot: ${store?.slot}`;
    }
  }
  return null;
}

async function backupStoresFile() {
  await fs.mkdir(STORES_BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(STORES_BACKUP_DIR, `stores-${stamp}.json`);
  await fs.copyFile(STORES_FILE, target).catch(() => {});
  // Keep the 10 most recent backups.
  const entries = (await fs.readdir(STORES_BACKUP_DIR).catch(() => []))
    .filter(name => /^stores-.*\.json$/.test(name))
    .sort();
  for (const name of entries.slice(0, Math.max(0, entries.length - 10))) {
    await fs.rm(path.join(STORES_BACKUP_DIR, name)).catch(() => {});
  }
  return target;
}

async function applyHubConfigSync(payload) {
  const invalid = validateHubSyncPayload(payload);
  if (invalid) return { applied: false, mode: getStoreConfigSource(), error: `invalid payload: ${invalid}` };

  const hubState = await readHubConfigState();
  if (hubState.lastAppliedVersion !== null && payload.configVersion < hubState.lastAppliedVersion) {
    return { applied: false, mode: getStoreConfigSource(), error: 'stale', appliedVersion: hubState.lastAppliedVersion };
  }

  const currentStores = await readStores();
  const diff = computeHubConfigDiff(currentStores, payload);

  if (getStoreConfigSource() !== 'hub') {
    // Feature flag off: validate + report what WOULD change, write nothing.
    return { applied: false, mode: 'dry-run', diff, appliedVersion: hubState.lastAppliedVersion };
  }

  // Build the full stores array. Match each hub slot to an existing record by
  // store_folder first, then by display name (case-insensitive) — legacy
  // auto-seeded records have no store_folder, and matching by name lets the
  // hub adopt them (keeping their logo and SKU-scan history) instead of
  // spawning a logo-less duplicate that the activation gate would reject.
  const claimed = new Set();
  const matchFor = (hubStore) => {
    let found = currentStores.find(s => !claimed.has(s) && s.store_folder === hubStore.slot);
    if (!found && hubStore.displayName) {
      const wanted = String(hubStore.displayName).trim().toLowerCase();
      found = currentStores.find(s => !claimed.has(s) && String(s.name || '').trim().toLowerCase() === wanted);
    }
    if (found) claimed.add(found);
    return found || null;
  };
  const mapped = payload.stores.map(hubStore => mapHubStoreToPreply(matchFor(hubStore), hubStore));
  // Hub is the source of truth for enablement in hub mode: any record the hub
  // did not claim can no longer be active. This is what breaks the legacy
  // deadlock where an unaddressable invalid-active store failed every apply.
  const leftovers = currentStores
    .filter(store => !claimed.has(store))
    .map(store => (store.active ? { ...store, active: false, active_status: false } : store));
  const next = [...mapped, ...leftovers];

  await backupStoresFile();
  try {
    await saveStores(next); // all existing invariants enforce themselves here
  } catch (error) {
    return { applied: false, mode: 'hub', diff, error: error.message };
  }
  await writeHubConfigState({ lastAppliedVersion: payload.configVersion, appliedAt: new Date().toISOString() });
  return { applied: true, mode: 'hub', appliedVersion: payload.configVersion, diff };
}

// -- Hub-proxied Drive checks (read-only, no store mutation) --------------------
// Unlike the Store Settings test-drive route, these take a bare folderId and
// never touch stores.json — the hub owns the result. Only files.get and a
// single-page files.list are ever issued: no create, no upload, no delete.

const HUB_DRIVE_FOLDER_ID_RE = /^[A-Za-z0-9_-]{4,100}$/;

// Exactly what an operator must set, on which service, to make Drive reads work.
function driveCredentialHelp(attempts) {
  return [
    'Google Drive is not configured on the Preply service, so the folder cannot be read.',
    'Set ONE of the following on the Preply (inqueue-preply) service and redeploy:',
    '  • Service account (simplest for read-only checks): upload the key as a Render Secret File and set',
    '    GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/etc/secrets/google-service-account.json',
    '    Then share the Drive folder with the service account\'s client_email (Viewer is enough).',
    '  • OAuth user (required for SKU uploads into a personal My Drive): set',
    '    GOOGLE_DRIVE_AUTH_MODE=oauth, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,',
    '    GOOGLE_OAUTH_REDIRECT_URI=<preply-url>/api/drive/oauth/callback,',
    '    then open Preply → Settings → Connect Google Drive once to store the refresh token.',
    attempts.length ? `Tried: ${attempts.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
}

// Drive client for READ-ONLY checks. Prefers the client for the active mode,
// but falls back to the other real-Drive credential if that one is not
// configured: reading a folder works with either a service account or an OAuth
// user. (Only *uploads* are credential-sensitive — a service account has no
// My Drive storage quota — so the fallback is safe for tests and scans and
// cannot change which credential real uploads use.)
async function getReadOnlyDriveClient() {
  const preferOAuth = getDriveMode() === 'oauth';
  const candidates = preferOAuth
    ? [['oauth', getOAuthDriveClient], ['service_account', getServiceAccountDriveClient]]
    : [['service_account', getServiceAccountDriveClient], ['oauth', getOAuthDriveClient]];
  const attempts = [];
  for (const [source, factory] of candidates) {
    try {
      const client = await factory();
      return { drive: client.drive, source, clientEmail: client.clientEmail };
    } catch (error) {
      attempts.push(`${source}: ${error.message}`);
    }
  }
  const error = new Error(driveCredentialHelp(attempts));
  error.code = 'DRIVE_NOT_CONFIGURED';
  throw error;
}

async function driveTestFolder(folderId) {
  if (!HUB_DRIVE_FOLDER_ID_RE.test(String(folderId || ''))) {
    return { ok: false, code: 'INVALID_FOLDER_ID', detail: 'Invalid folder ID format. Paste only the folder ID from the Drive URL (the part after /folders/).' };
  }
  if (!isRemoteDriveMode()) {
    // Mock mode: the folder is a directory under data/mock-drive. Stat only —
    // a test must not create anything.
    const rootPath = path.join(MOCK_DRIVE_DIR, safeId(folderId, 'drive-root'));
    try {
      const stat = await fs.stat(rootPath);
      if (!stat.isDirectory()) return { ok: false, code: 'NOT_A_FOLDER', detail: 'not a folder' };
      return { ok: true, folder: { id: folderId, name: path.basename(rootPath) }, mode: 'mock' };
    } catch {
      return { ok: false, code: 'NOT_FOUND', detail: `mock folder not found (${folderId})`, mode: 'mock' };
    }
  }
  let client;
  try {
    client = await getReadOnlyDriveClient();
  } catch (error) {
    return { ok: false, code: error.code || 'DRIVE_NOT_CONFIGURED', detail: error.message, mode: getDriveMode() };
  }
  try {
    const response = await client.drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    if (response.data.mimeType !== GOOGLE_FOLDER_MIME) {
      return { ok: false, code: 'NOT_A_FOLDER', detail: 'That ID exists but is not a folder.' };
    }
    return {
      ok: true,
      folder: { id: response.data.id, name: response.data.name },
      mode: getDriveMode(),
      credential: client.source,
      clientEmail: client.clientEmail || null,
    };
  } catch (error) {
    return {
      ok: false,
      code: 'DRIVE_ERROR',
      detail: `${userFriendlyDriveError(error)}${client.clientEmail ? ` (checked as ${client.clientEmail})` : ''}`,
      mode: getDriveMode(),
      credential: client.source,
    };
  }
}

// Infer SKU prefix candidates from child folder names. Bounded scan: a single
// page of at most 100 folders — never a full-drive walk, never a write.
async function driveInferPrefix(folderId) {
  if (!HUB_DRIVE_FOLDER_ID_RE.test(String(folderId || ''))) {
    return { ok: false, code: 'INVALID_FOLDER_ID', detail: 'Invalid folder ID format.' };
  }
  let names = [];
  if (!isRemoteDriveMode()) {
    const rootPath = path.join(MOCK_DRIVE_DIR, safeId(folderId, 'drive-root'));
    const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => null);
    if (!entries) return { ok: false, code: 'NOT_FOUND', detail: `mock folder not found (${folderId})` };
    names = entries.filter(e => e.isDirectory()).map(e => e.name).slice(0, 100);
  } else {
    let client;
    try {
      client = await getReadOnlyDriveClient();
    } catch (error) {
      return { ok: false, code: error.code || 'DRIVE_NOT_CONFIGURED', detail: error.message };
    }
    try {
      const response = await client.drive.files.list({
        q: `'${folderId}' in parents and mimeType='${GOOGLE_FOLDER_MIME}' and trashed=false`,
        fields: 'files(name)',
        pageSize: 100,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      names = (response.data.files || []).map(f => f.name);
    } catch (error) {
      return { ok: false, code: 'DRIVE_ERROR', detail: userFriendlyDriveError(error) };
    }
  }
  const buckets = new Map();
  for (const name of names) {
    const match = /^([A-Z]{1,6})(\d+)$/.exec(String(name || '').trim());
    if (!match) continue;
    const bucket = buckets.get(match[1]) || { prefix: match[1], count: 0, maxNumber: 0, example: '' };
    bucket.count += 1;
    const num = Number(match[2]);
    if (num >= bucket.maxNumber) { bucket.maxNumber = num; bucket.example = name; }
    buckets.set(match[1], bucket);
  }
  const candidates = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  return { ok: true, candidates, scannedFolders: names.length };
}

// -- Phase 5: settings endpoints backend ---------------------------------------

// Read-only per-store readiness report for the settings UI. Mirrors the
// activation gate in activeStoreReadinessError() without writing anything.
function storeReadinessReport(store, assets = []) {
  const missing = [];
  if (!String(store.skuPrefix || '').trim()) missing.push('SKU prefix');

  const folderId = String(store.skuRootFolderId || '');
  const usesMockFolder = folderId.startsWith('mock-drive-');
  if (!folderId) {
    missing.push('Google Drive SKU root folder ID');
  } else if (isRemoteDriveMode() && usesMockFolder) {
    missing.push('real Google Drive SKU root folder ID (placeholder in use)');
  }

  if (!store.store_folder) missing.push('Batchly folder (Store_A–H)');

  const assetUrl = (assets.find(item => item.name === store.logoDir) || assets.find(item => item.name === store.id))?.url || null;
  const hasLogo = Boolean(assetUrl || store.logoUrl);
  if (!hasLogo) missing.push('store logo');

  return { ready: missing.length === 0, missing, usesMockFolder, hasLogo };
}

function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production' || env.INQUEUE_ENV === 'production';
}

// Pure production-config guardrails. `context` carries everything that is not
// an env var so the matrix stays unit-testable without touching disk:
//   { stores, driveMode, handoffMode, pendingFolderId }
function computeProductionWarnings(env = process.env, context = {}) {
  const warnings = [];
  const production = isProductionEnv(env);
  const driveMode = context.driveMode ?? getDriveMode();
  const handoffMode = context.handoffMode ?? getHandoffMode();
  const pendingFolderId = context.pendingFolderId ?? getPendingBatchesFolderId();

  if (production) {
    if (!env.INQUEUE_SESSION_SECRET || env.INQUEUE_SESSION_SECRET.length < 32) {
      warnings.push({
        level: 'error',
        code: 'SESSION_SECRET_MISSING',
        message: 'INQUEUE_SESSION_SECRET is missing or shorter than 32 characters.',
        fix: 'Set INQUEUE_SESSION_SECRET to the same 32+ character secret used by the inQueue hub.'
      });
    }
    if (!env.INQUEUE_PASSWORD_HASH && env.INQUEUE_PASSWORD) {
      warnings.push({
        level: 'error',
        code: 'PASSWORD_PLAINTEXT',
        message: 'Login uses the plaintext INQUEUE_PASSWORD fallback in production.',
        fix: 'Set INQUEUE_PASSWORD_HASH (pbkdf2) on the hub service and remove INQUEUE_PASSWORD.'
      });
    }
    if (driveMode === 'mock') {
      warnings.push({
        level: 'error',
        code: 'MOCK_DRIVE_IN_PROD',
        message: 'GOOGLE_DRIVE_AUTH_MODE is "mock" in production — no real Drive uploads can happen.',
        fix: 'Set GOOGLE_DRIVE_AUTH_MODE=oauth and connect Google Drive in Settings.'
      });
    }
    if (handoffMode === 'local') {
      warnings.push({
        level: 'warn',
        code: 'HANDOFF_MODE_LOCAL_IN_PROD',
        message: 'Batchly handoff mode is "local" — exports stay on this server instead of Drive.',
        fix: 'Switch the handoff mode to "drive" in Settings after testing the pending-batches folder.'
      });
    }
    const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI || OAUTH_REDIRECT_URI;
    if (/localhost|127\.0\.0\.1/.test(redirectUri)) {
      warnings.push({
        level: 'error',
        code: 'REDIRECT_URI_LOCALHOST',
        message: 'The Google OAuth redirect URI points at localhost in production.',
        fix: 'Set GOOGLE_OAUTH_REDIRECT_URI to the public Preply URL + /api/drive/oauth/callback and add it to the Google Cloud OAuth client.'
      });
    }
    if (!env.PREPLY_DATABASE_URL) {
      warnings.push({
        level: 'warn',
        code: 'STATE_DB_MISSING',
        message: 'PREPLY_DATABASE_URL is not set — stores, batches, the SKU ledger, and the Drive refresh token live only on local disk and are lost on every deploy unless a persistent disk is mounted at PREPLY_DATA_DIR.',
        fix: 'Set PREPLY_DATABASE_URL to a Postgres connection string (the hub\'s Render Postgres instance works — the preply_state table is namespaced), or mount a persistent disk.'
      });
    }
  }

  if ((handoffMode === 'drive' || handoffMode === 'both') && driveMode !== 'mock' && !pendingFolderId) {
    warnings.push({
      level: 'error',
      code: 'PENDING_FOLDER_MISSING',
      message: `Handoff mode is "${handoffMode}" but no pending-batches Drive folder is configured.`,
      fix: 'Save a pending-batches folder ID in Settings (or set PREPLY_PENDING_BATCHES_FOLDER_ID).'
    });
  }

  if (driveMode !== 'mock') {
    for (const store of context.stores || []) {
      if (store.active && String(store.skuRootFolderId || '').startsWith('mock-drive-')) {
        warnings.push({
          level: 'error',
          code: 'ACTIVE_STORE_MOCK_FOLDER',
          message: `Active store "${store.name || store.id}" still uses the placeholder folder "${store.skuRootFolderId}".`,
          fix: 'Open Settings, set the store’s real Google Drive SKU root folder ID, and run Test Connection.'
        });
      }
    }
  }

  return warnings;
}

// UI-facing view of the persisted app settings (never includes tokens).
async function readAppSettings() {
  const settings = await loadSettingsCache();
  return {
    pendingBatchesFolderId: describePendingBatchesFolder(),
    handoffMode: describeHandoffMode(),
    pendingFolderLastTest: settings.pendingFolderLastTest || null,
    storeDriveTests: settings.storeDriveTests || {},
    minimumSelectedMockups: settings.minimumSelectedMockups ?? 1
  };
}

// Whitelisted settings save. Only pendingBatchesFolderId and handoffMode are
// writable from the UI; everything else in settings.json is owned by other
// flows. Never touches stores.json.
async function saveAppSettings(patch = {}) {
  const current = await readJsonFile(SETTINGS_FILE, {});
  const next = { ...current };

  if ('pendingBatchesFolderId' in patch) {
    const value = String(patch.pendingBatchesFolderId ?? '').trim();
    if (value && !/^[\w-]{5,}$/.test(value)) {
      const error = new Error('That does not look like a Drive folder ID. Paste the segment after /folders/ in the folder URL.');
      error.statusCode = 400;
      error.code = 'INVALID_FOLDER_ID';
      throw error;
    }
    if (value) next.pendingBatchesFolderId = value;
    else delete next.pendingBatchesFolderId; // revert to env fallback
  }

  if ('handoffMode' in patch) {
    const mode = String(patch.handoffMode ?? '').trim().toLowerCase();
    if (mode === '') {
      delete next.handoffMode; // revert to env fallback
    } else {
      if (!HANDOFF_MODES.includes(mode)) {
        const error = new Error('Handoff mode must be one of: local, drive, both.');
        error.statusCode = 400;
        error.code = 'INVALID_HANDOFF_MODE';
        throw error;
      }
      if (mode === 'drive' || mode === 'both') {
        const effectiveFolderId = String(next.pendingBatchesFolderId || process.env.PREPLY_PENDING_BATCHES_FOLDER_ID || '').trim();
        const expectedTestId = getDriveMode() === 'mock'
          ? (effectiveFolderId || MOCK_PENDING_FOLDER_TOKEN)
          : effectiveFolderId;
        if (getDriveMode() !== 'mock' && !effectiveFolderId) {
          const error = new Error(`Cannot switch handoff mode to "${mode}": no pending-batches folder is configured. Save a folder ID first.`);
          error.statusCode = 400;
          error.code = 'PENDING_FOLDER_MISSING';
          throw error;
        }
        const lastTest = next.pendingFolderLastTest;
        if (!lastTest || !lastTest.ok || lastTest.folderId !== expectedTestId) {
          const error = new Error(`Cannot switch handoff mode to "${mode}": the pending-batches folder has not passed a test yet. Run "Test Pending Batches Folder" first.`);
          error.statusCode = 400;
          error.code = 'PENDING_FOLDER_UNTESTED';
          throw error;
        }
      }
      next.handoffMode = mode;
    }
  }

  await writeJsonFile(SETTINGS_FILE, next);
  settingsCache = next;
  return readAppSettings();
}

// Record the outcome of a per-store Drive test in settings.json (keyed by
// store id). Deliberately NOT stored in stores.json so no new code path writes
// store mappings.
async function recordStoreDriveTest(storeId, outcome) {
  const current = await readJsonFile(SETTINGS_FILE, {});
  const next = {
    ...current,
    storeDriveTests: {
      ...(current.storeDriveTests || {}),
      [storeId]: outcome
    }
  };
  await writeJsonFile(SETTINGS_FILE, next);
  settingsCache = next;
}

// Pending-batches folder test. Mock mode inspects the local mirror directory;
// remote modes do a read-only files.get + one-page files.list. The optional
// write test ({writeTest: true}, explicit UI confirm only — never from tests
// or the hub) creates one temporary folder and deletes it again.
async function testPendingBatchesFolder({ folderId = '', writeTest = false } = {}) {
  const checkedAt = new Date().toISOString();
  const mode = getDriveMode();
  const requested = String(folderId || '').trim() || getPendingBatchesFolderId();
  let result;

  if (mode === 'mock') {
    await fs.mkdir(MOCK_PENDING_BATCHES_DIR, { recursive: true });
    const entries = await fs.readdir(MOCK_PENDING_BATCHES_DIR);
    result = {
      ok: true,
      mode,
      folderId: requested || MOCK_PENDING_FOLDER_TOKEN,
      folderName: 'pending-batches (local mock)',
      sampleCount: entries.length,
      writeTested: false,
      checkedAt
    };
  } else if (!requested) {
    result = {
      ok: false,
      mode,
      folderId: '',
      error: 'No pending-batches folder ID is configured.',
      fix: 'Paste the Drive folder ID and save, or set PREPLY_PENDING_BATCHES_FOLDER_ID.',
      checkedAt
    };
  } else {
    try {
      const { drive } = await getRemoteDriveClient();
      const meta = await drive.files.get({
        fileId: requested,
        fields: 'id, name, mimeType, trashed',
        supportsAllDrives: true
      });
      if (meta.data.mimeType !== GOOGLE_FOLDER_MIME) {
        result = { ok: false, mode, folderId: requested, error: 'The ID does not point to a folder.', checkedAt };
      } else if (meta.data.trashed) {
        result = { ok: false, mode, folderId: requested, error: 'The folder is in the trash.', checkedAt };
      } else {
        const listing = await drive.files.list({
          q: `'${requested}' in parents and trashed = false`,
          fields: 'files(id)',
          pageSize: 100,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true
        });
        let writeTested = false;
        if (writeTest) {
          const probe = await drive.files.create({
            requestBody: {
              name: `preply-connection-test-${Date.now()}`,
              mimeType: GOOGLE_FOLDER_MIME,
              parents: [requested]
            },
            fields: 'id',
            supportsAllDrives: true
          });
          await drive.files.delete({ fileId: probe.data.id, supportsAllDrives: true });
          writeTested = true;
        }
        result = {
          ok: true,
          mode,
          folderId: requested,
          folderName: meta.data.name || null,
          sampleCount: listing.data.files?.length ?? 0,
          writeTested,
          checkedAt
        };
      }
    } catch (error) {
      result = {
        ok: false,
        mode,
        folderId: requested,
        error: userFriendlyDriveError(error).message || error.message,
        checkedAt
      };
    }
  }

  const current = await readJsonFile(SETTINGS_FILE, {});
  const next = { ...current, pendingFolderLastTest: result };
  await writeJsonFile(SETTINGS_FILE, next);
  settingsCache = next;
  return result;
}

// Redacted settings/connection aggregate for the Preply settings UI and the
// inQueue hub Connections tab. Booleans, names, and timestamps only — never
// token values.
async function getSettingsStatus() {
  const [driveStatus, oauth, stores, assets, settings] = await Promise.all([
    getDriveStatus(),
    getOAuthStatus(),
    readStores(),
    getStoreLogos(),
    loadSettingsCache()
  ]);
  const pendingFolder = describePendingBatchesFolder();
  const handoffMode = describeHandoffMode();
  const driveMode = getDriveMode();

  const hubConfigState = await readHubConfigState();
  return {
    app: 'preply',
    production: isProductionEnv(),
    // Where store config comes from: 'hub' = pushed by the inQueue hub,
    // 'local' = edited here (hub sync dry-runs only).
    configSource: getStoreConfigSource(),
    hubConfig: {
      lastAppliedVersion: hubConfigState.lastAppliedVersion,
      appliedAt: hubConfigState.appliedAt,
    },
    warnings: computeProductionWarnings(process.env, {
      stores,
      driveMode,
      handoffMode: handoffMode.value,
      pendingFolderId: pendingFolder.value
    }),
    drive: {
      mode: driveMode,
      adapterLabel: driveStatus.adapterLabel,
      configured: driveStatus.configured,
      connected: driveMode === 'oauth' ? Boolean(oauth.connected) : driveStatus.configured,
      email: oauth.connected_email || driveStatus.clientEmail || null,
      connectedAt: oauth.connected_at || null,
      error: driveStatus.error || null
    },
    handoffMode,
    pendingFolder: {
      configured: Boolean(pendingFolder.value) || driveMode === 'mock',
      value: pendingFolder.value || null,
      source: pendingFolder.source,
      lastTest: settings.pendingFolderLastTest || null
    },
    stores: stores.map(store => ({
      id: store.id,
      name: store.name,
      active: Boolean(store.active),
      store_folder: store.store_folder,
      skuPrefix: store.skuPrefix,
      ...storeReadinessReport(store, assets),
      lastDriveTest: settings.storeDriveTests?.[store.id] || null
    }))
  };
}

async function readBatches() {
  await ensureDataFiles();
  return readJsonFileStrict(BATCHES_FILE, []);
}

async function saveBatches(batches) {
  await writeJsonFile(BATCHES_FILE, batches);
}

function makeBatchId(existing) {
  const datePart = new Date().toISOString().slice(0, 10);
  const count = existing.filter(batch => String(batch.id || '').startsWith(`BATCH-${datePart}`)).length + 1;
  return `BATCH-${datePart}-${String(count).padStart(3, '0')}`;
}

function isReservationActive(batch) {
  return ['Draft', 'Intake In Progress', 'Intake Complete', 'Production In Progress', 'Ready To Export'].includes(batch.status);
}

async function readMockupPresets() {
  await ensureDataFiles();
  return readJsonFile(MOCKUP_PRESETS_FILE, []);
}

// Stable variation-profile keys a preset may carry. Matches the hub profile
// registry and Batchly's consumer; anything else falls back to front_sided so
// legacy presets (no design_type) keep their existing front-only behavior.
const VARIATION_PROFILE_KEYS = ['front_sided', 'double_sided'];
const DEFAULT_VARIATION_PROFILE = 'front_sided';

function normalizeMockupPreset(input, index = 0) {
  const now = new Date().toISOString();
  const selected = Array.isArray(input.selected_mockup_ids || input.selectedMockupIds)
    ? input.selected_mockup_ids || input.selectedMockupIds
    : [];
  const designType = VARIATION_PROFILE_KEYS.includes(input.design_type)
    ? input.design_type
    : DEFAULT_VARIATION_PROFILE;
  return {
    preset_id: safeId(input.preset_id || input.id || input.presetName || `preset-${index + 1}`, `preset-${index + 1}`),
    preset_name: String(input.preset_name || input.name || `Mockup Preset ${index + 1}`).trim(),
    selected_mockup_ids: [...new Set(selected.map(item => String(item)).filter(Boolean))],
    is_default: Boolean(input.is_default || input.isDefault),
    design_type: designType,
    created_at: input.created_at || input.createdAt || now,
    updated_at: now,
    notes: String(input.notes || '')
  };
}

async function saveMockupPresets(presets) {
  const clean = Array.isArray(presets) ? presets.map(normalizeMockupPreset) : [];
  const defaultId = clean.find(preset => preset.is_default)?.preset_id;
  if (defaultId) clean.forEach(preset => { preset.is_default = preset.preset_id === defaultId; });
  await writeJsonFile(MOCKUP_PRESETS_FILE, clean);
  return clean;
}

function skuFolderPattern(prefix) {
  return new RegExp(`^${String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
}

async function mockDriveRootPath(store) {
  const rootId = driveRootIdForStore(store);
  const rootPath = path.join(MOCK_DRIVE_DIR, safeId(rootId, 'drive-root'));
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}

async function scanMockStoreSkuFolders(store) {
  const startedAt = new Date().toISOString();
  if (!store.skuRootFolderId) throw new Error(`${store.name} needs a Google Drive SKU root folder ID.`);
  const rootPath = await mockDriveRootPath(store);
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
  const pattern = skuFolderPattern(store.skuPrefix);
  const folders = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map(entry => {
      const match = entry.name.match(pattern);
      return match ? {
        name: entry.name,
        id: `mock_folder_${safeId(store.skuRootFolderId)}_${entry.name}`,
        number: Number(match[1])
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
  const latest = folders[folders.length - 1] || null;
  return {
    adapter: 'local-mock-drive',
    driveMode: 'mock',
    adapterLabel: getDriveAdapterLabel(),
    serviceAccountEmail: null,
    scannedAt: new Date().toISOString(),
    startedAt,
    storeId: store.id,
    storeName: store.name,
    storeCode: store.code,
    skuPrefix: store.skuPrefix,
    skuRootFolderId: store.skuRootFolderId,
    status: 'completed',
    folderCount: folders.length,
    latestNumber: latest?.number || 0,
    latestSku: latest?.name || null,
    nextSku: `${store.skuPrefix}${(latest?.number || 0) + 1}`,
    folders
  };
}

async function listServiceAccountChildFolders(store) {
  const { drive, clientEmail } = await getRemoteDriveClient();
  const folderId = store.skuRootFolderId;
  const folders = [];
  let pageToken;
  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='${GOOGLE_FOLDER_MIME}' and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, createdTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    folders.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return { folders, clientEmail };
}

async function getServiceAccountFolderInfo(store) {
  const { drive, clientEmail } = await getRemoteDriveClient();
  const response = await drive.files.get({
    fileId: store.skuRootFolderId,
    fields: 'id, name, mimeType',
    supportsAllDrives: true
  });
  const folder = response.data;
  if (folder.mimeType !== GOOGLE_FOLDER_MIME) throw new Error('Invalid Google Drive folder ID.');
  return { folder, clientEmail };
}

async function scanServiceAccountStoreSkuFolders(store) {
  const startedAt = new Date().toISOString();
  if (!store.skuRootFolderId) throw new Error(`${store.name} needs a Google Drive SKU root folder ID.`);
  try {
    const { folders: driveFolders, clientEmail } = await listServiceAccountChildFolders(store);
    const pattern = skuFolderPattern(store.skuPrefix);
    const folders = driveFolders
      .filter(folder => folder.name && !folder.name.startsWith('.') && !folder.name.startsWith('_'))
      .map(folder => {
        const match = folder.name.match(pattern);
        return match ? {
          name: folder.name,
          id: folder.id,
          number: Number(match[1]),
          createdTime: folder.createdTime || null
        } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.number - b.number);
    const latest = folders[folders.length - 1] || null;
    return {
      adapter: 'service-account-drive',
      driveMode: 'service_account',
      adapterLabel: getDriveAdapterLabel(),
      serviceAccountEmail: clientEmail,
      scannedAt: new Date().toISOString(),
      startedAt,
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      skuPrefix: store.skuPrefix,
      skuRootFolderId: store.skuRootFolderId,
      status: 'completed',
      folderCount: folders.length,
      latestNumber: latest?.number || 0,
      latestSku: latest?.name || null,
      nextSku: `${store.skuPrefix}${(latest?.number || 0) + 1}`,
      folders
    };
  } catch (error) {
    throw new Error(userFriendlyDriveError(error));
  }
}

async function scanStoreSkuFolders(store) {
  if (isRemoteDriveMode()) {
    const folderId = String(store.skuRootFolderId || '');
    if (folderId.startsWith('mock-drive-')) {
      throw new Error(`Store "${store.name}" has a placeholder Drive folder ID (${folderId}). Set a real Google Drive folder ID or deactivate this store.`);
    }
  }
  const scan = isRemoteDriveMode()
    ? await scanServiceAccountStoreSkuFolders(store)
    : await scanMockStoreSkuFolders(store);
  logDriveScan(store, scan);
  return scan;
}

async function testDriveConnection(store) {
  if (!store.skuRootFolderId) throw new Error(`${store.name} needs a Google Drive SKU root folder ID.`);
  if (getDriveMode() === 'mock') {
    const rootPath = await mockDriveRootPath(store);
    const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => []);
    return {
      mode: 'mock',
      adapterLabel: getDriveAdapterLabel(),
      configured: true,
      clientEmail: null,
      folderId: store.skuRootFolderId,
      folderName: path.basename(rootPath),
      childFolderCount: entries.filter(entry => entry.isDirectory()).length,
      message: `Connected. Folder: ${path.basename(rootPath)}. Found ${entries.filter(entry => entry.isDirectory()).length} child folders.`
    };
  }
  try {
    const { folder, clientEmail } = await getServiceAccountFolderInfo(store);
    const { folders } = await listServiceAccountChildFolders(store);
    return {
      mode: 'service_account',
      adapterLabel: getDriveAdapterLabel(),
      configured: true,
      clientEmail,
      folderId: folder.id,
      folderName: folder.name,
      childFolderCount: folders.length,
      message: `Connected. Folder: ${folder.name}. Found ${folders.length} child folders.`
    };
  } catch (error) {
    throw new Error(userFriendlyDriveError(error));
  }
}

async function getLatestSkuFromDrive(store) {
  return scanStoreSkuFolders(store);
}

// Serialize the scan->reserve->save critical section: two operators creating
// batches at the same moment both scanned the same "latest" Drive SKU and
// reserved identical numbers. Single-process server, so an in-process promise
// chain is a complete fix.
let skuReservationChain = Promise.resolve();
function withSkuReservationLock(fn) {
  const run = skuReservationChain.then(fn, fn);
  skuReservationChain = run.then(() => {}, () => {});
  return run;
}

// Highest SKU number each store has RESERVED in still-live batches. Drive
// scanning only sees folders that exist after export — without this floor, a
// second batch created before the first exports would re-issue its numbers
// (previously this was only detected, throwing "Duplicate reserved SKUs" and
// stranding the operator; now the new batch simply starts past them).
function outstandingSkuFloors(batches, excludeId = null) {
  const floors = new Map();
  batches
    .filter(batch => batch.id !== excludeId && isReservationActive(batch))
    .forEach(batch => {
      Object.values(batch.reservedSkus || {}).forEach(byStore => {
        Object.values(byStore || {}).forEach(entry => {
          const num = Number.parseInt(String(entry.sku || '').replace(/^\D+/, ''), 10);
          if (!Number.isFinite(num)) return;
          if (num > (floors.get(entry.storeId) || 0)) floors.set(entry.storeId, num);
        });
      });
    });
  return floors;
}

async function reserveSkusFromDrive(designIds, stores, floors = new Map()) {
  const activeStores = stores.filter(store => store.active).slice(0, 8);
  const storeScans = [];
  for (const store of activeStores) {
    // Name the failing store so a single bad store never surfaces as a vague
    // whole-batch error. Throwing here means no partial reservation is built.
    let scan;
    try {
      scan = await getLatestSkuFromDrive(store);
    } catch (error) {
      const wrapped = new Error(`SKU reservation failed for ${store.name} (Batchly folder ${store.store_folder || 'unassigned'}): ${error.message}`);
      wrapped.statusCode = error.statusCode || 400;
      wrapped.storeId = store.id;
      wrapped.storeName = store.name;
      throw wrapped;
    }
    storeScans.push(scan);
  }
  const effectiveBase = (store, scan) =>
    Math.max(Number(scan?.latestNumber || 0), Number(floors.get(store.id) || 0));
  const reservedSkus = Object.fromEntries(designIds.map((designId, designIndex) => [
    designId,
    Object.fromEntries(activeStores.map(store => {
      const scan = storeScans.find(item => item.storeId === store.id);
      const nextNumber = effectiveBase(store, scan) + designIndex + 1;
      return [
        store.id,
        {
          storeId: store.id,
          storeName: store.name,
          storeCode: store.code,
          sku: `${store.skuPrefix}${nextNumber}`,
          skuSource: 'google_drive',
          skuRootFolderId: store.skuRootFolderId
        }
      ];
    }))
  ]));
  const ranges = Object.fromEntries(activeStores.map(store => {
    const scan = storeScans.find(item => item.storeId === store.id);
    const startNumber = effectiveBase(store, scan) + 1;
    const endNumber = startNumber + designIds.length - 1;
    return [store.id, {
      storeId: store.id,
      storeName: store.name,
      storeCode: store.code,
      skuPrefix: store.skuPrefix,
      latestFound: scan?.latestSku || null,
      latestNumber: scan?.latestNumber || 0,
      reservedStart: `${store.skuPrefix}${startNumber}`,
      reservedEnd: `${store.skuPrefix}${endNumber}`,
      reservedCount: designIds.length,
      scannedAt: scan?.scannedAt || null,
      skuRootFolderId: store.skuRootFolderId
    }];
  }));
  return {
    source: 'google_drive',
    adapter: getDriveMode() === 'oauth' ? 'oauth-user-drive' : getDriveMode() === 'service_account' ? 'service-account-drive' : 'local-mock-drive',
    driveMode: getDriveMode(),
    adapterLabel: getDriveAdapterLabel(),
    scannedAt: new Date().toISOString(),
    storeScans,
    ranges,
    reservedSkus
  };
}

async function rescanForSkuConflicts(batch, stores) {
  const scans = [];
  const conflicts = [];
  for (const storeSnapshot of batch.activeStores || []) {
    const store = stores.find(item => item.id === storeSnapshot.id) || storeSnapshot;
    const scan = await scanStoreSkuFolders(store);
    scans.push(scan);
    const existing = new Set(scan.folders.map(folder => folder.name));
    for (const design of batch.designs || []) {
      const sku = batch.reservedSkus?.[design.id]?.[store.id]?.sku;
      if (sku && existing.has(sku)) {
        const currentStatus = batch.driveExportStatus?.[store.id]?.[sku];
        const knownFolderId = currentStatus?.folder_id || currentStatus?.folderId || null;
        const matchingFolder = scan.folders.find(folder => folder.name === sku && folder.id === knownFolderId);
        if (matchingFolder) continue;
        conflicts.push({
          storeId: store.id,
          storeName: store.name,
          sku,
          designId: design.id,
          message: `SKU conflict detected: ${sku} already exists in ${store.name} Drive. Refresh SKU assignments before exporting.`
        });
      }
    }
  }
  return { scannedAt: new Date().toISOString(), scans, conflicts };
}

async function createSkuFolder(store, sku) {
  if (isRemoteDriveMode()) return createServiceAccountSkuFolder(store, sku);
  const rootPath = await mockDriveRootPath(store);
  const folderPath = path.join(rootPath, sku);
  if (fsSync.existsSync(folderPath)) throw new Error(`${sku} already exists in ${store.name} Drive.`);
  await fs.mkdir(folderPath, { recursive: false });
  return {
    id: `mock_folder_${safeId(store.skuRootFolderId)}_${sku}`,
    name: sku,
    path: folderPath
  };
}

async function findExistingSkuFolders(store, sku) {
  if (isRemoteDriveMode()) return findExistingServiceAccountSkuFolders(store, sku);
  const rootPath = await mockDriveRootPath(store);
  const folderPath = path.join(rootPath, sku);
  if (!fsSync.existsSync(folderPath)) return [];
  return [{
    id: `mock_folder_${safeId(store.skuRootFolderId)}_${sku}`,
    name: sku,
    path: folderPath
  }];
}

async function getExistingSkuFolder(store, sku) {
  const folders = await findExistingSkuFolders(store, sku);
  return folders[0] || null;
}

async function uploadDesignToSkuFolder(store, sku, sourcePng, targetFolder = null) {
  if (isRemoteDriveMode()) return uploadDesignToServiceAccountSkuFolder(store, sku, sourcePng, targetFolder);
  const rootPath = await mockDriveRootPath(store);
  const folderPath = targetFolder?.path || path.join(rootPath, sku);
  const filename = safeFilename(sourcePng.filename || `${sourcePng.designId || sku}.png`);
  const data = sourcePng.buffer || Buffer.alloc(0);
  if (!data.length) throw new Error(`Raw source design file for ${sourcePng.designId || sku} was not found locally. Cannot upload to Google Drive.`);
  await fs.mkdir(folderPath, { recursive: true });
  await fs.writeFile(path.join(folderPath, filename), data);
  return {
    id: `mock_file_${safeId(store.skuRootFolderId)}_${sku}_${safeId(filename)}`,
    name: filename,
    size: data.length
  };
}

async function createServiceAccountSkuFolder(store, sku) {
  try {
    const { drive, clientEmail, instanceId, keyPath, scopes } = await getRemoteDriveClient();
    console.log(`[Drive folder create] operation=create SKU folder clientInstance=${instanceId} clientEmail=${clientEmail || 'unknown'} keyPath=${keyPath} scopes=${(scopes || []).join(',')} store="${store.name}" storeFolder="${store.store_folder || ''}" sku=${sku} parent=${store.skuRootFolderId}`);
    const response = await drive.files.create({
      requestBody: {
        name: sku,
        mimeType: GOOGLE_FOLDER_MIME,
        parents: [store.skuRootFolderId]
      },
      fields: 'id, name',
      supportsAllDrives: true
    });
    if (!response.data.id) {
      throw new Error(buildDriveUploadFailure({ store, sku, phase: 'folder_missing' }));
    }
    return {
      id: response.data.id,
      name: response.data.name,
      createdByClientEmail: clientEmail,
      createdByClientInstance: instanceId
    };
  } catch (error) {
    throw new Error(userFriendlyDriveError(error));
  }
}

async function findExistingServiceAccountSkuFolders(store, sku) {
  const scan = await scanServiceAccountStoreSkuFolders(store);
  return scan.folders
    .filter(item => item.name === sku)
    .sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')))
    .map(folder => ({ id: folder.id, name: folder.name, createdTime: folder.createdTime || null }));
}

async function getExistingServiceAccountSkuFolder(store, sku) {
  const folders = await findExistingServiceAccountSkuFolders(store, sku);
  return folders[0] || null;
}

async function verifyServiceAccountFolderAccess(folderId, context = {}) {
  const { drive, clientEmail, instanceId, keyPath, scopes } = await getRemoteDriveClient();
  const fields = 'id, name, mimeType, parents, ownedByMe, capabilities(canAddChildren, canEdit), permissions(id, type, role, emailAddress, domain, deleted)';
  const response = await drive.files.get({
    fileId: folderId,
    fields,
    supportsAllDrives: true
  });
  const folder = response.data || {};
  console.log('[Drive target folder get]', JSON.stringify({
    operation: 'verify upload target folder',
    clientInstance: instanceId,
    clientEmail,
    keyPath,
    scopes,
    store: context.storeName || null,
    storeFolder: context.storeFolder || null,
    sku: context.sku || null,
    targetFolderId: folderId,
    supportsAllDrives: true,
    requestedFields: fields,
    result: {
      id: folder.id,
      name: folder.name,
      mimeType: folder.mimeType,
      parents: folder.parents || [],
      ownedByMe: folder.ownedByMe,
      capabilities: folder.capabilities || null,
      permissions: folder.permissions || null
    }
  }));
  if (folder.mimeType !== GOOGLE_FOLDER_MIME) throw new Error('Target ID is not a Google Drive folder.');
  if (folder.capabilities?.canAddChildren === false) throw new Error(`Google Drive target folder ${folderId} does not allow adding children.`);
  return {
    ...folder,
    verifiedByClientEmail: clientEmail,
    verifiedByClientInstance: instanceId,
    requestedFields: fields
  };
}

async function uploadDesignToServiceAccountSkuFolder(store, sku, sourcePng, targetFolder = null) {
  try {
    const folder = targetFolder || await getExistingServiceAccountSkuFolder(store, sku);
    if (!folder?.id) throw new Error(buildDriveUploadFailure({ store, sku, phase: 'folder_missing' }));
    const { drive, clientEmail, instanceId, keyPath, scopes } = await getRemoteDriveClient();
    const filename = safeFilename(sourcePng.filename || `${sourcePng.designId || sku}.png`);
    const data = sourcePng.buffer || Buffer.alloc(0);
    if (!data.length) throw new Error(`Raw source design file for ${sourcePng.designId || sku} was not found locally. Cannot upload to Google Drive.`);
    let targetFolderInfo = folder.targetFolderInfo || null;
    try {
      targetFolderInfo = targetFolderInfo || await verifyServiceAccountFolderAccess(folder.id, {
        storeName: store.name,
        storeFolder: store.store_folder || null,
        sku
      });
    } catch (error) {
      console.error('[Drive upload folder access failed]', JSON.stringify({
        operation: 'verify upload target folder',
        clientInstance: instanceId,
        clientEmail,
        keyPath,
        scopes,
        store: store.name,
        sku,
        folderId: folder.id,
        localRawDesignPath: sourcePng.path || null,
        localRawDesignSize: sourcePng.size || 0,
        googleError: driveApiErrorDetails(error)
      }));
      throw driveFailureError({ store, sku, phase: 'folder_access', folderId: folder.id, error, operation: 'verify upload target folder' });
    }
    let response;
    const uploadRequestMetadata = {
      name: filename,
      parents: [folder.id]
    };
    console.log('[Drive upload request]', JSON.stringify({
      operation: 'upload source PNG',
      clientInstance: instanceId,
      clientEmail,
      keyPath,
      scopes,
      store: store.name,
      storeFolder: store.store_folder || null,
      sku,
      targetFolderId: folder.id,
      targetFolder: {
        id: targetFolderInfo?.id,
        name: targetFolderInfo?.name,
        mimeType: targetFolderInfo?.mimeType,
        parents: targetFolderInfo?.parents || [],
        ownedByMe: targetFolderInfo?.ownedByMe,
        capabilities: targetFolderInfo?.capabilities || null
      },
      localRawDesignPath: sourcePng.path || null,
      localRawDesignExists: Boolean(sourcePng.exists),
      localRawDesignSize: sourcePng.size || 0,
      requestBody: uploadRequestMetadata,
      mediaMimeType: 'image/png',
      supportsAllDrives: true
    }));
    try {
      response = await drive.files.create({
        requestBody: uploadRequestMetadata,
        media: {
          mimeType: 'image/png',
          body: Readable.from(data)
        },
        fields: 'id, name, size',
        supportsAllDrives: true
      });
    } catch (error) {
      console.error('[Drive upload API failed]', JSON.stringify({
        operation: 'upload source PNG',
        clientInstance: instanceId,
        clientEmail,
        keyPath,
        scopes,
        store: store.name,
        sku,
        folderId: folder.id,
        filename,
        requestBody: uploadRequestMetadata,
        mediaMimeType: 'image/png',
        supportsAllDrives: true,
        localRawDesignPath: sourcePng.path || null,
        localRawDesignExists: Boolean(sourcePng.exists),
        localRawDesignSize: sourcePng.size || 0,
        googleError: driveApiErrorDetails(error)
      }));
      throw error;
    }
    return {
      id: response.data.id,
      name: response.data.name,
      size: Number(response.data.size || data.length),
      folderId: folder.id,
      uploadedByClientEmail: clientEmail,
      uploadedByClientInstance: instanceId,
      uploadRequestMetadata,
      targetFolderInfo
    };
  } catch (error) {
    if (String(error.message || '').includes('SKU folder')) throw error;
    if (String(error.message || '').includes('Raw source design file')) throw error;
    throw driveFailureError({ store, sku, phase: 'upload', folderId: targetFolder?.id, error, operation: 'upload source PNG' });
  }
}

async function dryRunBatchExport(batch, stores) {
  const conflictCheck = await rescanForSkuConflicts(batch, stores);
  const wouldCreate = [];
  const wouldUpload = [];
  for (const storeSnapshot of batch.activeStores || []) {
    const store = stores.find(s => s.id === storeSnapshot.id) || storeSnapshot;
    for (const design of batch.designs || []) {
      const sku = batch.reservedSkus?.[design.id]?.[store.id]?.sku;
      if (!sku) continue;
      wouldCreate.push({ storeId: store.id, storeName: store.name, storeCode: store.code, sku, designId: design.id });
      wouldUpload.push({ storeId: store.id, storeName: store.name, storeCode: store.code, sku, designId: design.id, designFile: design.filename || `${design.id}.png` });
    }
  }
  return {
    dry_run: true,
    batch_id: batch.id,
    drive_mode: getDriveMode(),
    adapter_label: getDriveAdapterLabel(),
    hasConflicts: conflictCheck.conflicts.length > 0,
    conflicts: conflictCheck.conflicts,
    conflict_check: conflictCheck,
    wouldCreate,
    wouldUpload,
    message: conflictCheck.conflicts.length
      ? `Dry run blocked: ${conflictCheck.conflicts.length} SKU conflict(s) detected. Fix before real export.`
      : `Dry run OK. Would create ${wouldCreate.length} SKU folder(s) and upload ${wouldUpload.length} design file(s) to Drive.`,
    checkedAt: new Date().toISOString()
  };
}

async function resolveSkuFolderForExport(store, sku, currentStatus = {}, options = {}) {
  const warnings = [];
  if (isRemoteDriveMode()) {
    try {
      await getServiceAccountFolderInfo(store);
    } catch (error) {
      throw new Error(buildDriveUploadFailure({ store, sku, phase: 'parent_access', error }));
    }
  }

  const knownFolderId = currentStatus?.folder_id || currentStatus?.folderId || null;
  const existingFolders = await findExistingSkuFolders(store, sku);
  const knownFolder = knownFolderId
    ? existingFolders.find(folder => folder.id === knownFolderId)
    : null;
  if (knownFolder) {
    return {
      folder: knownFolder,
      created: false,
      reused: true,
      warnings,
      reason: 'current_batch_folder'
    };
  }

  if (existingFolders.length > 1) {
    const sorted = [...existingFolders].sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
    if (!options.retryOnly) {
      throw new Error(buildDriveUploadFailure({ store, sku, phase: 'multiple_folders' }));
    }
    warnings.push(`Multiple ${sku} folders found in ${store.name}; retry used the newest accessible folder.`);
    return {
      folder: sorted[0],
      created: false,
      reused: true,
      warnings,
      reason: 'newest_existing_folder'
    };
  }

  if (existingFolders.length === 1) {
    if (!options.retryOnly) {
      throw new Error(`SKU conflict detected: ${sku} already exists in ${store.name} Drive. Refresh SKU assignments before exporting.`);
    }
    return {
      folder: existingFolders[0],
      created: false,
      reused: true,
      warnings,
      reason: 'existing_retry_folder'
    };
  }

  const folder = await createSkuFolder(store, sku);
  if (!folder?.id) throw new Error(buildDriveUploadFailure({ store, sku, phase: 'folder_missing' }));
  return {
    folder,
    created: true,
    reused: false,
    warnings,
    reason: 'created'
  };
}

async function exportDesignsToStoreDrives(batch, stores, designFiles = [], options = {}) {
  const exportStartedAt = new Date().toISOString();
  console.log(`LIVE EXPORT PATH EXECUTING — batch=${batch.id} mode=${getDriveMode()} retryOnly=${Boolean(options.retryOnly)} designFiles=${designFiles.length}`);
  const fileByDesign = new Map(designFiles.map(file => [file.designId, file]));
  await persistBatchSourceDesigns(batch, designFiles);
  const conflictCheck = await rescanForSkuConflicts(batch, stores);
  const report = {
    batch_id: batch.id,
    drive_mode: getDriveMode(),
    adapter: getDriveMode() === 'oauth' ? 'oauth-user-drive' : getDriveMode() === 'service_account' ? 'service-account-drive' : 'local-mock-drive',
    adapter_label: getDriveAdapterLabel(),
    service_account_email: (await getDriveStatus()).clientEmail,
    export_started_at: exportStartedAt,
    export_completed_at: null,
    status: 'conflict_check',
    original_drive_scan_snapshot: batch.driveScanSnapshot || null,
    conflict_checks: conflictCheck,
    final_drive_scan_snapshot: null,
    stores: [],
    failures: [],
    export_state: {
      sku_reserved: true,
      folder_created: false,
      source_png_uploaded: false,
      batch_zip_exported: Boolean(batch.exportInfo?.batch_zip_exported || batch.status === 'Exported')
    }
  };

  if (conflictCheck.conflicts.length && !options.retryOnly) {
    report.status = 'conflict';
    report.export_completed_at = new Date().toISOString();
    report.failures = conflictCheck.conflicts;
    await writeJsonFile(DRIVE_EXPORT_REPORT_FILE, report);
    return report;
  }

  for (const storeSnapshot of batch.activeStores || []) {
    const store = stores.find(item => item.id === storeSnapshot.id) || storeSnapshot;
    const storeResult = {
      store_id: store.id,
      store_name: store.name,
      store_code: store.code,
      sku_root_folder_id: store.skuRootFolderId,
      status: 'pending',
      items: []
    };
    report.stores.push(storeResult);
    const exportTasks = [];
    for (const design of batch.designs || []) {
      const sku = batch.reservedSkus?.[design.id]?.[store.id]?.sku;
      if (!sku) continue;
      const item = {
        design_id: design.id,
        sku,
        sku_reserved: true,
        parent_folder_id: store.skuRootFolderId,
        folder_id: null,
        final_upload_target_folder_id: null,
        folder_created: false,
        folder_reused: false,
        source_png_uploaded: false,
        local_raw_design_path: design.sourcePngPath || sourceDesignPath(batch.id, design.filename || `${design.id}.png`),
        local_raw_design_exists: false,
        local_raw_design_size: 0,
        uploaded_file_id: null,
        uploaded_file_name: null,
        status: 'pending',
        error: '',
        warnings: []
      };
      storeResult.items.push(item);
      const previousStatus = batch.driveExportStatus?.[store.id]?.[sku];
      if (options.retryOnly && previousStatus && !['failed', 'pending'].includes(previousStatus.status || 'failed')) {
        Object.assign(item, previousStatus);
        item.status = previousStatus.status || 'completed';
        continue;
      }
      exportTasks.push({ design, sku, item, previousStatus });
    }

    // Each SKU's folder-resolve/verify/upload chain is independent — run a
    // bounded pool instead of one long serial chain of Drive round-trips.
    await mapWithConcurrency(exportTasks, DRIVE_UPLOAD_CONCURRENCY - 1, async ({ design, sku, item, previousStatus }) => {
      try {
        item.status = 'creating_folder';
        const folderResult = await resolveSkuFolderForExport(store, sku, previousStatus, options);
        const { folder } = folderResult;
        item.folder_id = folder.id;
        item.final_upload_target_folder_id = folder.id;
        item.folder_created = folderResult.created;
        item.folder_reused = folderResult.reused;
        item.folder_resolution = folderResult.reason;
        item.folder_created_by_client_email = folder.createdByClientEmail || null;
        item.folder_created_by_client_instance = folder.createdByClientInstance || null;
        item.warnings = folderResult.warnings;
        if (item.folder_created) report.export_state.folder_created = true;
        if (isRemoteDriveMode()) {
          const targetFolderInfo = await verifyServiceAccountFolderAccess(folder.id, {
            storeName: store.name,
            storeFolder: store.store_folder || null,
            sku
          });
          folder.targetFolderInfo = targetFolderInfo;
          item.target_folder_get_result = {
            id: targetFolderInfo.id,
            name: targetFolderInfo.name,
            mimeType: targetFolderInfo.mimeType,
            parents: targetFolderInfo.parents || [],
            ownedByMe: targetFolderInfo.ownedByMe,
            capabilities: targetFolderInfo.capabilities || null,
            permissions: targetFolderInfo.permissions || null,
            verifiedByClientEmail: targetFolderInfo.verifiedByClientEmail,
            verifiedByClientInstance: targetFolderInfo.verifiedByClientInstance
          };
        }
        const sourcePng = await resolveLocalSourcePng(batch, design, fileByDesign.get(design.id));
        item.local_raw_design_path = sourcePng.path;
        item.local_raw_design_exists = sourcePng.exists;
        item.local_raw_design_size = sourcePng.size;
        console.log(`[Drive source upload] batch=${batch.id} store="${store.name}" storeFolder="${store.store_folder || ''}" design=${design.id} sku=${sku} parent=${store.skuRootFolderId} skuFolder=${folder.id} uploadTarget=${folder.id} localRaw="${sourcePng.path}" localExists=${sourcePng.exists} localSize=${sourcePng.size}`);
        item.status = 'uploading_design';
        const upload = await withDriveRetry(() => uploadDesignToSkuFolder(store, sku, sourcePng, folder), `source upload ${sku}`);
        item.uploaded_file_id = upload.id;
        item.uploaded_file_name = upload.name;
        item.upload_request_metadata = upload.uploadRequestMetadata || null;
        item.uploaded_by_client_email = upload.uploadedByClientEmail || null;
        item.uploaded_by_client_instance = upload.uploadedByClientInstance || null;
        item.source_png_uploaded = true;
        item.status = 'completed';
        report.export_state.source_png_uploaded = true;
        console.log(`[Drive source upload complete] batch=${batch.id} store="${store.name}" storeFolder="${store.store_folder || ''}" design=${design.id} sku=${sku} parent=${store.skuRootFolderId} skuFolder=${folder.id} uploadTarget=${folder.id} localRaw="${sourcePng.path}" localSize=${sourcePng.size} uploadedDriveFile=${item.uploaded_file_id} uploadedName="${item.uploaded_file_name}"`);
      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        item.local_raw_design_path = error.localPath || item.local_raw_design_path;
        if (error.code === 'SOURCE_PNG_MISSING') {
          item.local_raw_design_exists = false;
          item.local_raw_design_size = 0;
        }
        report.failures.push({
          storeName: store.name,
          store_name: store.name,
          storeFolder: store.store_folder || null,
          sku,
          designId: design.id,
          parentFolderId: store.skuRootFolderId,
          folderId: item.folder_id,
          finalUploadTargetFolderId: item.final_upload_target_folder_id,
          localRawDesignPath: item.local_raw_design_path,
          localRawDesignExists: item.local_raw_design_exists,
          localRawDesignSize: item.local_raw_design_size,
          status: item.status,
          operation: error.operation || null,
          error: error.message,
          message: error.message,
          googleError: driveApiErrorDetails(error),
          targetFolderGetResult: item.target_folder_get_result || null
        });
        console.error('[Drive source upload failed]', JSON.stringify({
          batchId: batch.id,
          store: store.name,
          storeFolder: store.store_folder || null,
          designId: design.id,
          sku,
          parentFolderId: store.skuRootFolderId,
          skuFolderId: item.folder_id,
          finalUploadTargetFolderId: item.final_upload_target_folder_id,
          localRawDesignPath: item.local_raw_design_path,
          localRawDesignExists: item.local_raw_design_exists,
          localRawDesignSize: item.local_raw_design_size,
          error: error.message,
          googleError: driveApiErrorDetails(error)
        }));
      }
    });
    storeResult.status = storeResult.items.every(item => item.status === 'completed') ? 'completed' : 'failed';
  }

  const finalCheck = await rescanForSkuConflicts(batch, stores);
  report.final_drive_scan_snapshot = finalCheck;

  // Verify-after-write: "completed" is only earned when every expected
  // (design x active store) SKU produced a folder id and an uploaded file id.
  // A report that did no work (e.g. empty activeStores) must not read as
  // success — that exact gap let an export appear successful with zero
  // Drive writes.
  const expectedItems = [];
  for (const storeSnapshot of batch.activeStores || []) {
    for (const design of batch.designs || []) {
      const sku = batch.reservedSkus?.[design.id]?.[storeSnapshot.id]?.sku;
      if (sku) expectedItems.push({ storeId: storeSnapshot.id, designId: design.id, sku });
    }
  }
  const completedItems = report.stores.flatMap(storeResult => storeResult.items).filter(
    item => item.status === 'completed' && item.folder_id && item.uploaded_file_id
  );
  const verificationProblems = [];
  if (expectedItems.length === 0) {
    verificationProblems.push('No (design x active store) SKU items were expected — activeStores or reservedSkus is empty. Nothing was exported to Drive.');
  }
  for (const expected of expectedItems) {
    const match = report.stores
      .find(storeResult => storeResult.store_id === expected.storeId)?.items
      .find(item => item.design_id === expected.designId && item.sku === expected.sku);
    if (!match) {
      verificationProblems.push(`Missing export item for ${expected.sku} (${expected.designId}) — it was never attempted.`);
    } else if (match.status !== 'completed' || !match.folder_id || !match.uploaded_file_id) {
      verificationProblems.push(`SKU ${expected.sku} (${expected.designId}) incomplete: status=${match.status} folder=${match.folder_id || 'missing'} file=${match.uploaded_file_id || 'missing'}${match.error ? ` — ${match.error}` : ''}`);
    }
  }
  report.verification = {
    expected_items: expectedItems.length,
    completed_items: completedItems.length,
    folders_verified: completedItems.length,
    files_uploaded: completedItems.length,
    problems: verificationProblems,
    ok: verificationProblems.length === 0 && report.failures.length === 0
  };
  for (const problem of verificationProblems) {
    if (!report.failures.some(failure => failure.message === problem)) {
      report.failures.push({ status: 'failed', error: problem, message: problem });
    }
  }

  report.status = report.verification.ok ? 'completed' : 'failed';
  report.export_completed_at = new Date().toISOString();
  await writeJsonFile(DRIVE_EXPORT_REPORT_FILE, report);
  console.log(`[Drive export verification] batch=${batch.id} ok=${report.verification.ok} expected=${expectedItems.length} completed=${completedItems.length}${verificationProblems.length ? ` problems=${JSON.stringify(verificationProblems)}` : ''}`);
  return report;
}

function reserveSkus(stores, designIds, driveScanSnapshot = null) {
  const activeStores = stores.filter(store => store.active).slice(0, 8);
  return Object.fromEntries(designIds.map((designId, designIndex) => [
    designId,
    Object.fromEntries(activeStores.map(store => [
      store.id,
      {
        storeId: store.id,
        storeName: store.name,
        storeCode: store.code,
        sku: `${store.skuPrefix}${Number(driveScanSnapshot?.ranges?.[store.id]?.latestNumber ?? store.latestSkuNumber) + designIndex + 1}`,
        skuSource: driveScanSnapshot ? 'google_drive' : 'local_fallback',
        skuRootFolderId: store.skuRootFolderId
      }
    ]))
  ]));
}

function collectReservedSkus(batches, excludeId = null) {
  const reserved = new Set();
  batches
    .filter(batch => batch.id !== excludeId && isReservationActive(batch))
    .forEach(batch => {
      Object.values(batch.reservedSkus || {}).forEach(byStore => {
        Object.values(byStore || {}).forEach(entry => reserved.add(`${entry.storeId}:${entry.sku}`));
      });
    });
  return reserved;
}

async function createBatch(body) {
  return withSkuReservationLock(() => createBatchLocked(body));
}

async function createBatchLocked(body) {
  const designIds = Array.isArray(body.designIds) ? body.designIds : [];
  if (!designIds.length || designIds.length > 30) throw new Error('A batch must include 1 to 30 designs.');

  const stores = await readStores();
  const activeStores = stores.filter(store => store.active).slice(0, 8);
  if (!activeStores.length) throw new Error('At least one active store is required before reserving SKUs.');

  const batches = await readBatches();
  const activeBatchCount = batches.filter(isReservationActive).length;
  activeStores.forEach(store => {
    if (!store.skuRootFolderId) throw new Error(`${store.name} needs a Google Drive SKU root folder ID before SKU reservation.`);
  });
  const driveScanSnapshot = await reserveSkusFromDrive(designIds, stores, outstandingSkuFloors(batches));
  const reservedSkus = driveScanSnapshot.reservedSkus;
  const alreadyReserved = collectReservedSkus(batches);
  const duplicates = [];
  Object.values(reservedSkus).forEach(byStore => {
    Object.values(byStore).forEach(entry => {
      if (alreadyReserved.has(`${entry.storeId}:${entry.sku}`)) duplicates.push(`${entry.storeName} ${entry.sku}`);
    });
  });
  if (duplicates.length) throw new Error(`Duplicate reserved SKUs detected: ${duplicates.join(', ')}`);

  const id = makeBatchId(batches);
  const now = new Date().toISOString();
  const batch = {
    id,
    status: 'Intake In Progress',
    createdAt: now,
    updatedAt: now,
    sourceZipName: String(body.sourceZipName || ''),
    validation: body.validation || {},
    activeStores: activeStores.map(store => ({
      id: store.id,
      name: store.name,
      code: store.code,
      skuPrefix: store.skuPrefix,
      latestSkuNumberAtReservation: store.latestSkuNumber,
      latestDriveSkuAtReservation: driveScanSnapshot.ranges[store.id]?.latestFound || null,
      skuRootFolderId: store.skuRootFolderId,
      driveConnectionLabel: store.driveConnectionLabel,
      logoUrl: store.logoUrl
    })),
    designs: designIds.map(designId => ({
      id: designId,
      filename: `${designId}.png`,
      sourcePngPath: sourceDesignPath(id, `${designId}.png`),
      sourcePngBytes: 0,
      sourcePngStoredAt: null,
      title: '',
      description: '',
      keywords: '',
      intakeComplete: false,
      productionStatus: 'Not Started',
      selectedMockups: [],
      finalImageFiles: []
    })),
    reservedSkus,
    skuSource: 'google_drive',
    driveScanSnapshot,
    driveReservedRanges: driveScanSnapshot.ranges,
    driveExportStatus: {},
    driveExportReport: null,
    exportState: {
      sku_reserved: true,
      folder_created: false,
      source_png_uploaded: false,
      batch_zip_exported: false
    },
    activeMockupPresetId: null,
    activeMockupPresetName: null,
    appliedMockupPresetToBatch: false,
    perDesignOverrides: {},
    warnings: activeBatchCount ? [`${activeBatchCount} active batch${activeBatchCount === 1 ? ' has' : 'es have'} reserved SKUs. Finish or cancel old batches before relying on final SKU numbers.`] : []
  };

  await persistBatchSourceDesigns(batch, body.designFiles || []);
  batches.push(batch);
  await saveBatches(batches);
  return batch;
}

// Recovery path for stale SKU reservations (e.g. another batch or a manual
// upload consumed a reserved SKU on Drive after this batch reserved it).
// Re-scans the real Drive store folders and reserves the next safe SKU block.
// Read-only against Drive: no folders are created, no PNGs are uploaded, and
// the batch is never marked exported here.
async function refreshBatchSkuReservation(batchId) {
  return withSkuReservationLock(() => refreshBatchSkuReservationLocked(batchId));
}

async function refreshBatchSkuReservationLocked(batchId) {
  const batches = await readBatches();
  const index = batches.findIndex(item => item.id === batchId);
  if (index < 0) {
    const error = new Error('Batch not found');
    error.statusCode = 404;
    throw error;
  }
  const batch = batches[index];
  if (batch.status === 'Exported' || batch.exportState?.batch_zip_exported) {
    const error = new Error(`${batch.id} is already exported. Its SKUs are final and cannot be re-reserved.`);
    error.statusCode = 409;
    throw error;
  }
  const designIds = (batch.designs || []).map(design => design.id);
  if (!designIds.length) throw new Error(`${batch.id} has no designs to reserve SKUs for.`);

  // Refresh against the batch's own store set, not whatever is globally
  // active now — the export contract was fixed at batch creation.
  const stores = await readStores();
  const batchStores = (batch.activeStores || []).map(snapshot => {
    const store = stores.find(item => item.id === snapshot.id);
    if (!store) throw new Error(`Store ${snapshot.name || snapshot.id} from this batch no longer exists. Cannot refresh SKUs.`);
    if (!store.active) throw new Error(`${store.name} is no longer active. Re-activate it before refreshing SKUs.`);
    if (!store.skuRootFolderId) throw new Error(`${store.name} has no Google Drive SKU root folder ID. Cannot re-scan.`);
    return store;
  });
  if (!batchStores.length) throw new Error(`${batch.id} has no active stores to reserve SKUs for.`);

  const driveScanSnapshot = await reserveSkusFromDrive(designIds, batchStores, outstandingSkuFloors(batches, batch.id));
  const newReservedSkus = driveScanSnapshot.reservedSkus;

  // Never hand out a SKU another live batch is still holding.
  const alreadyReserved = collectReservedSkus(batches, batch.id);
  const duplicates = [];
  Object.values(newReservedSkus).forEach(byStore => {
    Object.values(byStore).forEach(entry => {
      if (alreadyReserved.has(`${entry.storeId}:${entry.sku}`)) duplicates.push(`${entry.storeName} ${entry.sku}`);
    });
  });
  if (duplicates.length) {
    const error = new Error(`Cannot refresh: the next Drive SKUs are reserved by another active batch (${duplicates.join(', ')}). Finish or cancel that batch first.`);
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const previousReservedSkus = batch.reservedSkus || {};
  batches[index] = {
    ...batch,
    reservedSkus: newReservedSkus,
    skuSource: 'google_drive',
    driveScanSnapshot,
    driveReservedRanges: driveScanSnapshot.ranges,
    // Clear stale per-SKU folder ids and the old failed report — they refer
    // to the abandoned reservation and must not influence the next export.
    driveExportStatus: {},
    driveExportReport: null,
    exportState: {
      ...(batch.exportState || {}),
      sku_reserved: true,
      folder_created: false,
      source_png_uploaded: false,
      batch_zip_exported: false
    },
    activeStores: (batch.activeStores || []).map(snapshot => ({
      ...snapshot,
      latestDriveSkuAtReservation: driveScanSnapshot.ranges[snapshot.id]?.latestFound || null
    })),
    skuReservationRefreshedAt: now,
    updatedAt: now
  };
  await saveBatches(batches);
  return { batch: batches[index], previousReservedSkus };
}

async function updateBatch(id, patch) {
  const batches = await readBatches();
  const index = batches.findIndex(batch => batch.id === id);
  if (index < 0) throw new Error('Batch not found');
  batches[index] = {
    ...batches[index],
    ...patch,
    id: batches[index].id,
    updatedAt: new Date().toISOString()
  };
  await saveBatches(batches);
  return batches[index];
}

async function cancelBatch(id) {
  return updateBatch(id, { status: 'Canceled' });
}

async function commitExportedBatch(id, exportInfo = {}) {
  const batches = await readBatches();
  const index = batches.findIndex(batch => batch.id === id);
  if (index < 0) throw new Error('Batch not found');
  const batch = batches[index];
  if (batch.status === 'Exported') return batch;

  const ledger = await readJsonFile(SKU_LEDGER_FILE, []);
  const committedAt = new Date().toISOString();
  ledger.push({
    batchId: batch.id,
    source: 'google_drive',
    event: 'exported',
    designCount: batch.designs?.length || 0,
    committedAt
  });
  await writeJsonFile(SKU_LEDGER_FILE, ledger);
  batches[index] = {
    ...batch,
    status: 'Exported',
    exportedAt: committedAt,
    exportInfo,
    exportState: {
      ...(batch.exportState || {}),
      batch_zip_exported: true
    },
    updatedAt: committedAt
  };
  await saveBatches(batches);
  return batches[index];
}

// Reset/archive a batch so the workflow can start clean for the next batch.
// SAFE BY DESIGN: never touches Google Drive folders/files, OAuth tokens, store
// configs, SKU prefixes, parent folder IDs, or placement/mockup presets. It only
// archives the batch record (releasing any SKU reservation) and optionally prunes
// the local temporary source-PNG cache for a fully-exported batch.
async function resetBatchWorkflow(id, options = {}) {
  const batches = await readBatches();
  const index = batches.findIndex(batch => batch.id === id);
  if (index < 0) throw new Error('Batch not found');
  const batch = batches[index];

  const driveReport = batch.driveExportReport;
  const driveComplete = driveReport?.status === 'completed';
  const exported = batch.status === 'Exported';
  // "Incomplete" means a Drive export actually ran and left failures or an
  // unfinished status. A batch with no Drive report (Drive not used) is fine to
  // reset without force.
  const driveIncomplete = Boolean(driveReport?.failures?.length) || Boolean(driveReport && driveReport.status !== 'completed');

  // Guard: a partial/failed Drive upload keeps its state unless the caller forces it,
  // so the user can still Retry Failed Drive Uploads.
  if (driveIncomplete && !options.force) {
    return {
      ok: false,
      requiresForce: true,
      reason: 'drive_upload_incomplete',
      message: 'Google Drive upload is incomplete. Clearing this batch may make retry harder.'
    };
  }

  const now = new Date().toISOString();
  // Exported batches are archived (kept for the ledger/history); a forced reset of a
  // non-exported batch is canceled so its reserved SKUs are released. Neither status
  // is "active", so collectReservedSkus/isReservationActive stop counting it.
  const newStatus = exported ? 'Exported' : 'Canceled';
  batches[index] = {
    ...batch,
    status: newStatus,
    archived: true,
    archivedAt: now,
    workflowActive: false,
    updatedAt: now
  };
  await saveBatches(batches);

  // Only prune the local source-PNG cache once the bytes are safely in Drive (or forced).
  let sourceCacheRemoved = false;
  if (driveComplete || options.force) {
    try {
      await fs.rm(path.join(SOURCE_DESIGNS_DIR, safeId(batch.id, 'batch')), { recursive: true, force: true });
      sourceCacheRemoved = true;
    } catch {
      // non-fatal
    }
  }

  return {
    ok: true,
    batch_id: batch.id,
    archived: true,
    status: newStatus,
    source_cache_removed: sourceCacheRemoved,
    drive_untouched: true
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 250_000_000) req.destroy(new Error('Request body too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// Raw binary body reader for per-design source uploads: no base64 (+33%
// payload) and no giant-JSON parse — a 30-design batch as one base64 JSON
// body previously meant hundreds of MB through JSON.parse on a 512MB dyno.
function readRawBody(req, maxBytes = 80 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) req.destroy(new Error('Request body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isSafeName(name) {
  return typeof name === 'string' && name.trim() && !name.includes('/') && !name.includes('\\') && !name.includes('..');
}

function normalizePreset(input) {
  if (!input || typeof input !== 'object') return null;
  const preset = {
    type: 'stbz-preset-v3',
    mode: 'blank-mockup-visible-artwork',
    center: {
      x: Number(input.center?.x),
      y: Number(input.center?.y)
    },
    box: {
      width: Number(input.box?.width),
      height: Number(input.box?.height)
    },
    rotationDeg: Number(input.rotationDeg || 0),
    savedAt: new Date().toISOString()
  };

  const values = [preset.center.x, preset.center.y, preset.box.width, preset.box.height, preset.rotationDeg];
  if (!values.every(Number.isFinite)) return null;
  if (preset.center.x < 0 || preset.center.x > 1 || preset.center.y < 0 || preset.center.y > 1) return null;
  if (preset.box.width <= 0 || preset.box.width > 1.5 || preset.box.height <= 0 || preset.box.height > 1.5) return null;
  if (preset.rotationDeg < -180 || preset.rotationDeg > 180) return null;
  return preset;
}


function normalizeStampPlacement(input) {
  if (!input || typeof input !== 'object') return null;
  const placement = {
    center: {
      x: Number(input.center?.x),
      y: Number(input.center?.y)
    },
    box: {
      width: Number(input.box?.width),
      height: Number(input.box?.height)
    },
    rotationDeg: Number(input.rotationDeg || 0)
  };
  const values = [placement.center.x, placement.center.y, placement.box.width, placement.box.height, placement.rotationDeg];
  if (!values.every(Number.isFinite)) return null;
  if (placement.center.x < -0.5 || placement.center.x > 1.5 || placement.center.y < -0.5 || placement.center.y > 1.5) return null;
  if (placement.box.width <= 0 || placement.box.width > 1.5 || placement.box.height <= 0 || placement.box.height > 1.5) return null;
  if (placement.rotationDeg < -180 || placement.rotationDeg > 180) return null;
  return placement;
}

function normalizeStampPreset(input) {
  if (!input || typeof input !== 'object') return null;
  const storeLogo = normalizeStampPlacement(input.storeLogo);
  const freeShipping = normalizeStampPlacement(input.freeShipping);
  if (!storeLogo || !freeShipping) return null;
  return {
    type: 'stbz-stamp-preset-v1',
    mode: 'logo-and-free-shipping-stamps',
    storeLogo,
    freeShipping,
    savedAt: new Date().toISOString()
  };
}

async function saveBlankPreset(filename, preset) {
  if (!isSafeName(filename)) throw new Error('Unsafe filename');
  if (!MOCKUP_IMAGES.has(path.extname(filename).toLowerCase())) throw new Error('Unsupported mockup image type');

  const mockupPath = path.join(BLANK_MOCKUPS_DIR, filename);
  const blankReal = await fs.realpath(BLANK_MOCKUPS_DIR);
  const mockupReal = await fs.realpath(mockupPath);
  if (!mockupReal.startsWith(blankReal)) throw new Error('Bad mockup path');

  const configPath = path.join(BLANK_MOCKUPS_DIR, 'placement.json');
  const config = await readJsonFile(configPath, {});
  config[filename] = preset;
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config[filename];
}


async function saveStampPreset(filename, preset) {
  if (!isSafeName(filename)) throw new Error('Unsafe filename');
  if (!MOCKUP_IMAGES.has(path.extname(filename).toLowerCase())) throw new Error('Unsupported mockup image type');

  const mockupPath = path.join(BLANK_MOCKUPS_DIR, filename);
  const blankReal = await fs.realpath(BLANK_MOCKUPS_DIR);
  const mockupReal = await fs.realpath(mockupPath);
  if (!mockupReal.startsWith(blankReal)) throw new Error('Bad mockup path');

  const configPath = path.join(BLANK_MOCKUPS_DIR, 'stamp-placement.json');
  const config = await readJsonFile(configPath, {});
  config[filename] = preset;
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config[filename];
}

async function getBlankMockups() {
  await ensureDirs();
  const config = await readJsonFile(path.join(BLANK_MOCKUPS_DIR, 'placement.json'), {});
  const stampConfig = await readJsonFile(path.join(BLANK_MOCKUPS_DIR, 'stamp-placement.json'), {});
  const entries = await fs.readdir(BLANK_MOCKUPS_DIR, { withFileTypes: true });
  return entries
    .filter(file => file.isFile() && MOCKUP_IMAGES.has(path.extname(file.name).toLowerCase()))
    .map(file => ({
      id: file.name,
      filename: file.name,
      name: path.basename(file.name, path.extname(file.name)),
      url: `/blank-mockups/${encodeURIComponent(file.name)}`,
      placement: config[file.name] || config.default || null,
      stampPlacement: stampConfig[file.name] || stampConfig.default || null
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
}

async function getStoreLogos() {
  await ensureDirs();
  const entries = await fs.readdir(STORE_LOGOS_DIR, { withFileTypes: true });
  const stores = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const shopDir = path.join(STORE_LOGOS_DIR, entry.name);
    const files = await fs.readdir(shopDir, { withFileTypes: true });
    const logo = files
      .filter(file => file.isFile() && ACCEPTED_IMAGES.has(path.extname(file.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
    stores.push({
      name: entry.name,
      hasLogo: Boolean(logo),
      filename: logo?.name || null,
      url: logo ? `/store-logos/${encodeURIComponent(entry.name)}/${encodeURIComponent(logo.name)}` : null
    });
  }

  return stores.sort((a, b) => a.name.localeCompare(b.name));
}

async function getAppState() {
  const [blankMockups, stores, freeShipping, batches, settings, skuLedger, mockupPresets, driveExportReport, driveStatus] = await Promise.all([
    getBlankMockups(),
    readStores(),
    getFreeShippingLogo(),
    readBatches(),
    readJsonFile(SETTINGS_FILE, {}),
    readJsonFile(SKU_LEDGER_FILE, []),
    readMockupPresets(),
    readJsonFile(DRIVE_EXPORT_REPORT_FILE, null),
    getDriveStatus()
  ]);
  return { blankMockups, stores, freeShipping, batches, settings, skuLedger, mockupPresets, driveExportReport, driveStatus };
}

async function getFreeShippingLogo() {
  await ensureDirs();
  const entries = await fs.readdir(FREE_SHIPPING_DIR, { withFileTypes: true });
  const logo = entries
    .filter(file => file.isFile() && ACCEPTED_IMAGES.has(path.extname(file.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
  if (!logo) return null;
  return {
    filename: logo.name,
    url: `/free-shipping/${encodeURIComponent(logo.name)}`
  };
}

async function serveFile(res, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return send(res, 404, 'Not found');
    const stream = fsSync.createReadStream(filePath);
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-store'
    });
    stream.pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
}

// Batchly install root (parent of workspace/downloads). Used to refuse the
// handoff — rather than create a stray tree — when Batchly is not present.
const BATCHLY_ROOT = path.join(__dirname, '..', 'batchly');

// A batch id must be a single, safe path segment (preserving case, so folder
// names stay identical to what Batchly matches on). No slashes, no dot-dot.
function isSafeBatchId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}

// Splits a relative export path (e.g. "Store_A/D001/CU1_1.jpg") into safe
// segments, or returns null if any segment is empty, "."/".." or contains a
// character outside the allowlist. This is the real path-traversal guard —
// the old per-char sanitizer left ".." intact because "." was allowed.
function safeRelativeSegments(relPath) {
  const parts = String(relPath || '').split('/').filter(part => part.length);
  if (!parts.length) return null;
  for (const part of parts) {
    if (part === '.' || part === '..') return null;
    if (!/^[A-Za-z0-9._-]+$/.test(part)) return null;
  }
  return parts;
}

function isInside(rootDir, targetPath) {
  const rel = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Writes manifest + files into rootDir/batchId ATOMICALLY and VERIFIABLY:
// everything is written to a temp sibling dir first; only after every file
// succeeds is the temp dir swapped into place. On any failure the temp dir is
// removed and any pre-existing target is left untouched — so a partial batch
// folder is never visible. Path traversal is rejected up front (nothing is
// written) and re-checked per file as defense in depth.
async function writeBatchFilesAtomic(rootDir, batchId, manifest, files) {
  const targetPath = path.join(rootDir, batchId);
  const failed = [];
  const plan = [];
  for (const file of files) {
    const segs = safeRelativeSegments(file.path);
    if (!segs) {
      failed.push({ path: file.path ?? null, error: 'Unsafe or invalid path (rejected)' });
      continue;
    }
    plan.push({ segs, base64: String(file.base64 || '') });
  }
  // Any unsafe path fails the whole handoff without writing anything.
  if (failed.length) {
    return { ok: false, targetPath, filesWritten: 0, failed, reason: 'unsafe_path' };
  }
  if (!isSafeBatchId(batchId) || !isInside(rootDir, targetPath)) {
    return { ok: false, targetPath, filesWritten: 0, failed: [{ path: '(batch)', error: 'Unsafe batch target path' }], reason: 'unsafe_batch_id' };
  }

  const tmpDir = path.join(rootDir, `.tmp-${batchId}-${process.pid}-${Date.now()}`);
  let filesWritten = 0;
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    if (manifest) await fs.writeFile(path.join(tmpDir, 'batch_manifest.csv'), manifest, 'utf8');
    for (const item of plan) {
      const filePath = path.join(tmpDir, ...item.segs);
      if (!isInside(tmpDir, filePath)) throw new Error(`Path escapes target: ${item.segs.join('/')}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, Buffer.from(item.base64, 'base64'));
      filesWritten += 1;
    }
    // Swap into place: replace any prior target (verified inside root), then rename.
    await fs.rm(targetPath, { recursive: true, force: true });
    await fs.rename(tmpDir, targetPath);
    return { ok: true, targetPath, filesWritten, failed: [] };
  } catch (error) {
    // Roll back: never leave a partial temp dir behind; the existing target
    // (if any) was not touched because removal happens only after all writes.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, targetPath, filesWritten: 0, failed: [{ path: '(batch)', error: error.message }], reason: 'write_failed' };
  }
}

// -- Phase 3: chunked staging + Drive pending-batches upload -----------------

async function ensureHandoffStagingRoot() {
  await fs.mkdir(HANDOFF_STAGING_DIR, { recursive: true });
}

function stagingDirFor(handoffId) {
  if (!/^[A-Za-z0-9._-]+$/.test(handoffId)) throw new Error(`Unsafe handoff id: ${handoffId}`);
  return path.join(HANDOFF_STAGING_DIR, handoffId);
}

async function pruneStaleHandoffStaging(maxAgeMs = 24 * 60 * 60 * 1000) {
  await ensureHandoffStagingRoot();
  const now = Date.now();
  const entries = await fs.readdir(HANDOFF_STAGING_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(HANDOFF_STAGING_DIR, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && (now - stat.mtimeMs) > maxAgeMs) {
      await fs.rm(full, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function startHandoff(batchId) {
  await ensureHandoffStagingRoot();
  await pruneStaleHandoffStaging();
  const handoffId = `${batchId}-${process.pid}-${Date.now()}`;
  if (!isSafeBatchId(batchId)) throw new Error(`Unsafe batch id: ${batchId}`);
  const dir = stagingDirFor(handoffId);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  return { handoffId, stagingDir: dir, mode: getHandoffMode() };
}

// Write a chunk of {path, base64} files into the handoff staging dir. Each
// relative path is checked with safeRelativeSegments so nothing can escape.
async function appendHandoffFiles(handoffId, files) {
  const dir = stagingDirFor(handoffId);
  await fs.access(dir).catch(() => { throw new Error(`Unknown handoff id: ${handoffId}`); });
  const written = [];
  for (const file of files || []) {
    const segs = safeRelativeSegments(file.path);
    if (!segs) throw new Error(`Rejected unsafe path: ${file.path}`);
    const abs = path.join(dir, ...segs);
    if (!isInside(dir, abs)) throw new Error(`Path escapes staging: ${file.path}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const data = Buffer.from(String(file.base64 || ''), 'base64');
    if (!data.length) throw new Error(`Empty file body for ${file.path}`);
    await fs.writeFile(abs, data);
    written.push({ path: segs.join('/'), size: data.length });
  }
  return written;
}

async function countStagedFiles(dir) {
  let count = 0;
  const walk = async d => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) count += 1;
    }
  };
  await walk(dir);
  return count;
}

async function collectStagedRelativePaths(dir) {
  const paths = [];
  const walk = async (d, prefix) => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p, rel);
      else if (e.isFile()) paths.push(rel);
    }
  };
  await walk(dir, '');
  return paths.sort();
}

// Atomically move the staging dir into BATCHLY_DOWNLOADS_DIR/<batchId>. Uses
// the same swap pattern as writeBatchFilesAtomic so a partial local tree can
// never be visible.
async function commitLocalHandoff(stagingDir, batchId) {
  if (!isSafeBatchId(batchId)) throw new Error(`Unsafe batch id: ${batchId}`);
  await fs.mkdir(BATCHLY_DOWNLOADS_DIR, { recursive: true });
  const target = path.join(BATCHLY_DOWNLOADS_DIR, batchId);
  if (!isInside(BATCHLY_DOWNLOADS_DIR, target)) throw new Error('Target escapes downloads root');
  await fs.rm(target, { recursive: true, force: true });
  // Copy (not rename) so the staging dir survives for the parallel Drive
  // upload path when mode=both. Cleanup happens at the end of finalize.
  await copyTree(stagingDir, target);
  return { target };
}

async function copyTree(src, dst) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dst, { recursive: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyTree(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

// Mock Drive: mirror the staged tree into MOCK_PENDING_BATCHES_DIR/<batchId>
// so end-to-end tests can validate the Drive path without hitting Google.
async function uploadTreeToMockPending(stagingDir, batchId) {
  await fs.mkdir(MOCK_PENDING_BATCHES_DIR, { recursive: true });
  const target = path.join(MOCK_PENDING_BATCHES_DIR, batchId);
  await fs.rm(target, { recursive: true, force: true });
  await copyTree(stagingDir, target);
  const paths = await collectStagedRelativePaths(target);
  return {
    adapter: 'mock',
    batchFolderId: `mock-pending-${safeId(batchId, 'batch')}`,
    batchFolderName: batchId,
    parentFolderId: getPendingBatchesFolderId() || `mock-pending-parent`,
    uploaded: paths.map(p => ({ path: p, id: `mock-file-${safeId(p)}`, size: 0 })),
    files_created: paths.length,
    folders_created: new Set(paths.map(p => path.dirname(p)).filter(d => d !== '.')).size + 1,
    verified: true
  };
}

// Real Drive: upload the staged tree under PREPLY_PENDING_BATCHES_FOLDER_ID,
// then verify every expected file has an ID. Fails loud on any missing file.
async function uploadTreeToPendingDrive(stagingDir, batchId) {
  const pendingId = getPendingBatchesFolderId();
  if (!pendingId) {
    const err = new Error('PREPLY_PENDING_BATCHES_FOLDER_ID is not set. Cannot upload to Drive pending-batches folder.');
    err.code = 'PENDING_FOLDER_MISSING';
    throw err;
  }
  const { drive, clientEmail, instanceId } = await getRemoteDriveClient();

  async function createFolder(name, parent) {
    const r = await drive.files.create({
      requestBody: { name, mimeType: GOOGLE_FOLDER_MIME, parents: [parent] },
      fields: 'id, name',
      supportsAllDrives: true
    });
    if (!r.data.id) throw new Error(`Drive folder create returned no id for ${name}`);
    return { id: r.data.id, name: r.data.name };
  }
  async function uploadFile(absPath, name, parent) {
    const buf = await fs.readFile(absPath);
    const r = await drive.files.create({
      requestBody: { name, parents: [parent] },
      media: { mimeType: mimeFromPath(name), body: Readable.from(buf) },
      fields: 'id, name, size',
      supportsAllDrives: true
    });
    if (!r.data.id) throw new Error(`Drive file upload returned no id for ${name}`);
    return { id: r.data.id, name: r.data.name, size: Number(r.data.size || buf.length) };
  }

  async function listDriveChildren(parentId) {
    const children = [];
    let pageToken;
    do {
      const r = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
      });
      children.push(...(r.data.files || []));
      pageToken = r.data.nextPageToken || null;
    } while (pageToken);
    return children;
  }

  // Retry-aware: a previous partial upload left a same-named batch folder.
  // Reuse it (and skip files that already landed, matched by path + size)
  // instead of creating a duplicate folder that would show up in Batchly as a
  // second batch. Fresh exports behave exactly as before.
  const existingFolders = new Map(); // rel -> drive folder id
  const existingFiles = new Map();   // rel -> { id, size }
  let batchFolder = null;
  const priorSiblings = await listDriveChildren(pendingId);
  const prior = priorSiblings.find(f => f.name === batchId && f.mimeType === GOOGLE_FOLDER_MIME);
  if (prior) {
    batchFolder = { id: prior.id, name: prior.name };
    const walkExisting = async (folderId, relPrefix) => {
      const children = await listDriveChildren(folderId);
      for (const child of children) {
        const rel = relPrefix ? `${relPrefix}/${child.name}` : child.name;
        if (child.mimeType === GOOGLE_FOLDER_MIME) existingFolders.set(rel, child.id);
        else existingFiles.set(rel, { id: child.id, size: Number(child.size || 0) });
      }
      // Sibling subfolders are independent — list them a few at a time
      // instead of one serial round trip per folder.
      const subfolders = children.filter(c => c.mimeType === GOOGLE_FOLDER_MIME);
      await mapWithConcurrency(subfolders, 4, (child) =>
        walkExisting(child.id, relPrefix ? `${relPrefix}/${child.name}` : child.name));
    };
    await walkExisting(prior.id, '');
    console.log(`[Drive pending] reusing existing batch folder ${prior.id} (${existingFiles.size} files already uploaded)`);
  } else {
    batchFolder = await createFolder(batchId, pendingId);
  }
  const uploaded = [];
  let foldersCreated = prior ? 0 : 1;

  // Phase 1: create the folders (sibling folders in parallel — with stores ×
  // designs the tree used to cost one serial round trip per folder) while
  // collecting every file into a flat plan. Phase 2: upload the (many) files
  // concurrently.
  const uploadPlan = [];
  async function walkAndPlan(localDir, driveParent, relPrefix) {
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      uploadPlan.push({ abs: path.join(localDir, e.name), name: e.name, parent: driveParent, rel });
    }
    const dirs = entries.filter(e => e.isDirectory());
    await mapWithConcurrency(dirs, 4, async (e) => {
      const abs = path.join(localDir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      let subId = existingFolders.get(rel);
      if (!subId) {
        const sub = await withDriveRetry(() => createFolder(e.name, driveParent), `create folder ${rel}`);
        foldersCreated += 1;
        subId = sub.id;
      }
      await walkAndPlan(abs, subId, rel);
    });
  }

  await walkAndPlan(stagingDir, batchFolder.id, '');
  await mapWithConcurrency(uploadPlan, DRIVE_UPLOAD_CONCURRENCY, async (file) => {
    const already = existingFiles.get(file.rel);
    if (already) {
      const stat = await fs.stat(file.abs).catch(() => null);
      if (stat && already.size === stat.size) {
        uploaded.push({ path: file.rel, id: already.id, size: already.size, reused: true });
        return;
      }
      // Size mismatch = partial/stale upload: replace it so the batch is clean.
      await withDriveRetry(() => drive.files.delete({ fileId: already.id, supportsAllDrives: true }), `delete stale ${file.rel}`).catch(() => {});
    }
    const info = await withDriveRetry(() => uploadFile(file.abs, file.name, file.parent), `upload ${file.rel}`);
    uploaded.push({ path: file.rel, id: info.id, size: info.size });
  });

  // Verify: every path we intended to upload must have an id.
  const expected = await collectStagedRelativePaths(stagingDir);
  const uploadedSet = new Set(uploaded.map(u => u.path));
  const missing = expected.filter(p => !uploadedSet.has(p));
  if (missing.length) {
    throw new Error(`Drive pending-batch upload missed ${missing.length} file(s): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
  }

  console.log(`[Drive pending] upload ok batch=${batchId} folder=${batchFolder.id} clientInstance=${instanceId} clientEmail=${clientEmail || 'unknown'} files=${uploaded.length}`);
  return {
    adapter: getDriveMode() === 'oauth' ? 'oauth-user-drive' : 'service-account-drive',
    batchFolderId: batchFolder.id,
    batchFolderName: batchFolder.name,
    parentFolderId: pendingId,
    uploaded,
    files_created: uploaded.length,
    folders_created: foldersCreated,
    verified: true
  };
}

function mimeFromPath(name) {
  const ext = String(name || '').toLowerCase();
  if (ext.endsWith('.csv')) return 'text/csv';
  if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) return 'image/jpeg';
  if (ext.endsWith('.png')) return 'image/png';
  if (ext.endsWith('.webp')) return 'image/webp';
  if (ext.endsWith('.json')) return 'application/json';
  if (ext.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

// Test seams (mirrors the pattern used for Drive client mocks).
let _driveTreeUploader = null;
function __setDrivePendingUploaderForTests(fn) { _driveTreeUploader = fn; }
function __clearDrivePendingUploaderForTests() { _driveTreeUploader = null; }
async function performDrivePendingUpload(stagingDir, batchId) {
  if (_driveTreeUploader) return _driveTreeUploader(stagingDir, batchId);
  if (getDriveMode() === 'mock') return uploadTreeToMockPending(stagingDir, batchId);
  return uploadTreeToPendingDrive(stagingDir, batchId);
}

// Finalize: verify staging matches expected paths, write the manifest, then
// commit to the selected destinations. On any failure, staging is preserved
// so a retry can complete the export without re-uploading the JPEGs.
async function finalizeHandoff({ handoffId, batchId, manifest, expectedPaths, mode }) {
  const dir = stagingDirFor(handoffId);
  await fs.access(dir).catch(() => { throw new Error(`Unknown handoff id: ${handoffId}`); });

  // Manifest goes at the staging root before any commit.
  if (!manifest || typeof manifest !== 'string') throw new Error('Manifest is missing.');
  await fs.writeFile(path.join(dir, 'batch_manifest.csv'), manifest, 'utf8');

  // Cross-check what got staged with the client-declared expected set.
  const stagedPaths = await collectStagedRelativePaths(dir);
  const staged = new Set(stagedPaths);
  if (Array.isArray(expectedPaths) && expectedPaths.length) {
    const missing = expectedPaths.filter(p => !staged.has(p) && p !== 'batch_manifest.csv');
    const extra   = stagedPaths.filter(p => !expectedPaths.includes(p) && p !== 'batch_manifest.csv');
    if (missing.length || extra.length) {
      throw new Error(`Handoff staging did not match manifest expectations: missing=${missing.length}, extra=${extra.length}. First missing: ${missing[0] || 'n/a'}. First extra: ${extra[0] || 'n/a'}.`);
    }
  }

  const activeMode = ['local', 'drive', 'both'].includes(mode) ? mode : getHandoffMode();
  const result = { mode: activeMode, batchId, handoffId, staged_file_count: stagedPaths.length, local: null, drive: null };

  if (activeMode === 'local' || activeMode === 'both') {
    try {
      const local = await commitLocalHandoff(dir, batchId);
      result.local = { ok: true, target: local.target, files_written: stagedPaths.length };
    } catch (error) {
      result.local = { ok: false, error: error.message };
    }
  }

  if (activeMode === 'drive' || activeMode === 'both') {
    try {
      const drive = await performDrivePendingUpload(dir, batchId);
      result.drive = { ok: true, ...drive };
    } catch (error) {
      result.drive = { ok: false, error: error.message, code: error.code || null };
    }
  }

  const localOk = activeMode === 'drive' ? true : result.local?.ok === true;
  const driveOk = activeMode === 'local' ? true : result.drive?.ok === true;
  result.ok = localOk && driveOk;

  // Clean up staging only on complete success; partial failures keep it so a
  // retry doesn't re-render every JPEG in the browser.
  if (result.ok) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = url.pathname;

    // ---- Auth gate (before every route) ---------------------------------
    // Public: /login helper, /api/login (delegated to hub), /api/logout,
    // /api/auth/status, /config.js, Google Drive OAuth callback.
    if (pathname === '/config.js') {
      return send(res, 200, `window.INQUEUE_CONFIG = ${JSON.stringify({ hubUrl: INQUEUE_HUB_URL })};\n`, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookieHeader());
      return json(res, 200, { ok: true });
    }
    if (pathname === '/api/auth/status') {
      const session = getSessionFromRequest(req) || getToolSessionFromRequest(req, 'preply');
      return json(res, 200, { authenticated: Boolean(session), username: session?.u || null });
    }
    // SSO callback — the hub bounces the browser here with a ticket. Verify it
    // for this tool, set a first-party browser-session cookie, continue to
    // `next`. Handled before the gate because the ticket IS the credential.
    if (pathname === '/auth/sso/callback' && req.method === 'GET') {
      const ticket = url.searchParams.get('ticket') || '';
      const payload = verifySsoTicket(ticket, 'preply');
      if (!payload) {
        // Malformed / expired / wrong-tool → restart launch to re-mint a ticket.
        res.writeHead(302, { Location: buildToolLaunchRedirect('preply', '/', INQUEUE_HUB_URL) });
        return res.end();
      }
      res.writeHead(302, {
        'Set-Cookie': newToolSessionCookieHeader('preply', payload.u),
        Location: sanitizeNextPath(payload.next) || '/',
      });
      return res.end();
    }
    // ---- Internal service endpoints (hub → Preply, Bearer service token) --
    // Server-to-server only: authenticated by a short-lived HMAC token signed
    // with the shared INQUEUE_SESSION_SECRET (aud=preply), never by cookies.
    if (pathname.startsWith('/api/internal/')) {
      if (!getServiceAuthFromRequest(req, 'preply')) {
        return json(res, 401, { error: 'BAD_SERVICE_TOKEN' });
      }
      if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const body = await readJsonBody(req).catch(() => null);
      if (body === null) return json(res, 400, { error: 'INVALID_JSON' });
      if (pathname === '/api/internal/config-sync') {
        return json(res, 200, await applyHubConfigSync(body));
      }
      if (pathname === '/api/internal/drive/test-folder') {
        return json(res, 200, await driveTestFolder(body.folderId));
      }
      if (pathname === '/api/internal/drive/infer-prefix') {
        return json(res, 200, await driveInferPrefix(body.folderId));
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    }

    if (!isPublicPath(pathname, PREPLY_AUTH_EXEMPT_PREFIXES)) {
      // Accept the hub's shared cookie (same-origin/local dev) OR this tool's
      // first-party SSO session (the only cookie present cross-origin on Render).
      if (!getSessionFromRequest(req) && !getToolSessionFromRequest(req, 'preply')) {
        if (pathname.startsWith('/api/')) return json(res, 401, { error: 'UNAUTHENTICATED' });
        const currentPath = req.url;
        res.writeHead(302, { Location: buildToolLaunchRedirect('preply', currentPath, INQUEUE_HUB_URL) });
        return res.end();
      }
    }

    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, name: 'Preply', port: PORT });
    }

    // Ready Mockups stamp-only workflow (logo library + placement). Isolated from
    // batches, SKUs, and Drive.
    if (pathname.startsWith('/api/ready-stamp/')) {
      return handleReadyStampApi(req, res, pathname);
    }

    if (pathname === '/api/assets') {
      const [blankMockups, stores, freeShipping] = await Promise.all([
        getBlankMockups(),
        getStoreLogos(),
        getFreeShippingLogo()
      ]);
      return json(res, 200, { blankMockups, stores, freeShipping });
    }

    if (pathname === '/api/state') {
      return json(res, 200, await getAppState());
    }

    if (pathname === '/api/drive/status') {
      return json(res, 200, await getDriveStatus());
    }

    // OAuth user-upload: connection status for the UI.
    if (pathname === '/api/drive/oauth/status') {
      return json(res, 200, await getOAuthStatus());
    }

    // Returns the Google consent URL so the UI can open it in a new tab.
    if (pathname === '/api/drive/oauth/url') {
      const consentUrl = buildOAuthConsentUrl();
      if (!consentUrl) {
        return json(res, 400, { ok: false, error: 'OAuth client is not configured. Add google-oauth-client.json (from Google Cloud Console) or set GOOGLE_OAUTH_CLIENT_ID/SECRET, then restart Preply.' });
      }
      return json(res, 200, { ok: true, url: consentUrl, redirect_uri: OAUTH_REDIRECT_URI });
    }

    // Google redirects the user's browser here after consent.
    if (pathname === '/api/drive/oauth/callback') {
      const code = url.searchParams.get('code');
      const oauthError = url.searchParams.get('error');
      if (oauthError) {
        return send(res, 400, `<html><body style="font-family:sans-serif;background:#0a0b0d;color:#f08a8a;padding:40px"><h2>Google Drive connection canceled</h2><p>${oauthError}</p><p>You can close this tab and try Connect Google Drive again.</p></body></html>`, { 'Content-Type': 'text/html' });
      }
      if (!code) {
        return send(res, 400, '<html><body style="font-family:sans-serif;padding:40px">Missing authorization code.</body></html>', { 'Content-Type': 'text/html' });
      }
      try {
        const stored = await exchangeOAuthCode(code);
        console.log(`[Drive OAuth] connected user=${stored.connected_email || 'unknown'} at=${stored.connected_at}`);
        return send(res, 200, `<html><body style="font-family:sans-serif;background:#0a0b0d;color:#7dd7a6;padding:40px"><h2>Google Drive connected ✓</h2><p>Authorized as <strong>${stored.connected_email || 'your Google account'}</strong>. Source-design PNGs will now upload to Drive.</p><p>You can close this tab and return to Preply.</p></body></html>`, { 'Content-Type': 'text/html' });
      } catch (error) {
        console.error('[Drive OAuth callback failed]', error.message);
        return send(res, 500, `<html><body style="font-family:sans-serif;background:#0a0b0d;color:#f08a8a;padding:40px"><h2>Connection failed</h2><p>${error.message}</p></body></html>`, { 'Content-Type': 'text/html' });
      }
    }

    // Disconnect: forget the stored refresh token (disk AND durable copy).
    if (pathname === '/api/drive/oauth/disconnect' && req.method === 'POST') {
      await removeJsonFile(OAUTH_TOKEN_FILE);
      cachedOAuthDriveClient = null;
      return json(res, 200, { ok: true });
    }

    // -- Phase 5: app settings (pending-batches folder + handoff mode) --------
    if (pathname === '/api/settings' && req.method === 'GET') {
      return json(res, 200, await readAppSettings());
    }

    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const settings = await saveAppSettings(body);
        return json(res, 200, { ok: true, ...settings });
      } catch (error) {
        return json(res, error.statusCode || 400, { ok: false, error: error.message, code: error.code || null });
      }
    }

    if (pathname === '/api/settings/test-pending-folder' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await testPendingBatchesFolder({
        folderId: body.folderId,
        writeTest: body.writeTest === true
      });
      return json(res, 200, result);
    }

    if (pathname === '/api/settings/status' && req.method === 'GET') {
      return json(res, 200, await getSettingsStatus());
    }

    if (pathname === '/api/stores' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const stores = await saveStores(body.stores);
        return json(res, 200, { ok: true, stores });
      } catch (error) {
        return json(res, error.statusCode || 400, { ok: false, error: error.message });
      }
    }

    if (pathname === '/api/mockup-presets' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const presets = await saveMockupPresets(body.presets || []);
      return json(res, 200, { ok: true, presets });
    }

    const storeTestDriveMatch = pathname.match(/^\/api\/stores\/([^/]+)\/test-drive$/);
    if (storeTestDriveMatch && req.method === 'POST') {
      const stores = await readStores();
      const store = stores.find(item => item.id === storeTestDriveMatch[1]);
      if (!store) return json(res, 404, { error: 'Store not found' });
      try {
        const result = await testDriveConnection(store);
        const updated = await patchStoreScanState(store.id, {
          driveConnectionLabel: result.adapterLabel,
          google_drive_connection_label: result.adapterLabel,
          skuScanStatus: 'connection_ok',
          skuScanError: ''
        });
        await recordStoreDriveTest(store.id, { ok: true, checkedAt: new Date().toISOString(), error: null });
        return json(res, 200, { ok: true, result, store: updated });
      } catch (error) {
        const updated = await patchStoreScanState(store.id, {
          driveConnectionLabel: getDriveAdapterLabel(),
          google_drive_connection_label: getDriveAdapterLabel(),
          skuScanStatus: 'failed',
          skuScanError: error.message,
          lastSkuScanAt: new Date().toISOString()
        });
        await recordStoreDriveTest(store.id, { ok: false, checkedAt: new Date().toISOString(), error: error.message });
        return json(res, 400, { ok: false, error: error.message, store: updated || store });
      }
    }

    const driveScanMatch = pathname.match(/^\/api\/drive\/stores\/([^/]+)\/scan$/) || pathname.match(/^\/api\/stores\/([^/]+)\/scan-sku$/);
    if (driveScanMatch && req.method === 'POST') {
      const stores = await readStores();
      const store = stores.find(item => item.id === driveScanMatch[1]);
      if (!store) return json(res, 404, { error: 'Store not found' });
      try {
        const scan = await scanStoreSkuFolders(store);
        const updated = await patchStoreScanState(store.id, {
          latestDetectedSku: scan.latestSku,
          latestDetectedNumber: scan.latestNumber,
          nextSkuPreview: scan.nextSku,
          lastSkuScanAt: scan.scannedAt,
          skuScanStatus: 'completed',
          skuScanError: '',
          driveConnectionLabel: scan.adapterLabel,
          google_drive_connection_label: scan.adapterLabel
        });
        return json(res, 200, { ok: true, scan, store: updated });
      } catch (error) {
        const updated = await patchStoreScanState(store.id, {
          driveConnectionLabel: getDriveAdapterLabel(),
          google_drive_connection_label: getDriveAdapterLabel(),
          skuScanStatus: 'failed',
          skuScanError: error.message,
          lastSkuScanAt: new Date().toISOString()
        });
        return json(res, 400, { ok: false, error: error.message, store: updated || store });
      }
    }

    const driveConflictMatch = pathname.match(/^\/api\/batches\/([^/]+)\/drive-conflicts$/) || pathname.match(/^\/api\/batches\/([^/]+)\/rescan-drive-conflicts$/);
    if (driveConflictMatch && req.method === 'POST') {
      const batches = await readBatches();
      const batch = batches.find(item => item.id === driveConflictMatch[1]);
      if (!batch) return json(res, 404, { error: 'Batch not found' });
      const result = await rescanForSkuConflicts(batch, await readStores());
      return json(res, 200, { ok: true, result });
    }

    const skuRefreshMatch = pathname.match(/^\/api\/batches\/([^/]+)\/refresh-sku-reservation$/);
    if (skuRefreshMatch && req.method === 'POST') {
      try {
        const result = await refreshBatchSkuReservation(skuRefreshMatch[1]);
        return json(res, 200, { ok: true, ...result });
      } catch (error) {
        return json(res, error.statusCode || 400, { ok: false, error: error.message });
      }
    }

    const driveExportMatch = pathname.match(/^\/api\/batches\/([^/]+)\/drive-export$/) || pathname.match(/^\/api\/batches\/([^/]+)\/export-drive$/) || pathname.match(/^\/api\/batches\/([^/]+)\/retry-drive-failures$/);
    if (driveExportMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const batches = await readBatches();
      const index = batches.findIndex(item => item.id === driveExportMatch[1]);
      if (index < 0) return json(res, 404, { error: 'Batch not found' });
      const report = await exportDesignsToStoreDrives(batches[index], await readStores(), body.designFiles || [], { retryOnly: Boolean(body.retryOnly) || pathname.endsWith('/retry-drive-failures') });
      batches[index] = {
        ...batches[index],
        driveExportReport: report,
        driveExportStatus: Object.fromEntries((report.stores || []).map(store => [
          store.store_id,
          Object.fromEntries((store.items || []).map(item => [item.sku, item]))
        ])),
        exportState: {
          ...(batches[index].exportState || {}),
          ...(report.export_state || {}),
          batch_zip_exported: Boolean(batches[index].exportInfo?.batch_zip_exported || batches[index].status === 'Exported')
        },
        updatedAt: new Date().toISOString()
      };
      if (report.status === 'completed') batches[index].driveExportCompletedAt = report.export_completed_at;
      await saveBatches(batches);
      return json(res, report.status === 'conflict' ? 409 : 200, { ok: report.status === 'completed', report });
    }

    // ---- Phase 3: chunked handoff (start / files / finalize) --------------
    const handoffStartMatch = pathname.match(/^\/api\/batches\/([^/]+)\/handoff\/start$/);
    if (handoffStartMatch && req.method === 'POST') {
      const batchId = handoffStartMatch[1];
      if (!isSafeBatchId(batchId)) return json(res, 400, { ok: false, error: `Unsafe batch id: ${batchId}` });
      try {
        const { handoffId, mode } = await startHandoff(batchId);
        return json(res, 200, {
          ok: true,
          handoffId,
          mode,
          pending_folder_id: getPendingBatchesFolderId() || null,
          chunk_max_bytes: HANDOFF_CHUNK_MAX_BYTES,
        });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }

    const handoffFilesMatch = pathname.match(/^\/api\/batches\/([^/]+)\/handoff\/files$/);
    if (handoffFilesMatch && req.method === 'POST') {
      const batchId = handoffFilesMatch[1];
      if (!isSafeBatchId(batchId)) return json(res, 400, { ok: false, error: `Unsafe batch id: ${batchId}` });
      const body = await readJsonBody(req);
      const { handoffId, files } = body || {};
      if (!handoffId || !Array.isArray(files) || !files.length) {
        return json(res, 400, { ok: false, error: 'handoffId and non-empty files[] are required.' });
      }
      try {
        const written = await appendHandoffFiles(handoffId, files);
        const total = await countStagedFiles(stagingDirFor(handoffId));
        return json(res, 200, { ok: true, written, staged_file_count: total });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }

    const handoffFinalizeMatch = pathname.match(/^\/api\/batches\/([^/]+)\/handoff\/finalize$/);
    if (handoffFinalizeMatch && req.method === 'POST') {
      const batchId = handoffFinalizeMatch[1];
      if (!isSafeBatchId(batchId)) return json(res, 400, { ok: false, error: `Unsafe batch id: ${batchId}` });
      const body = await readJsonBody(req);
      const { handoffId, manifest, expectedPaths, mode } = body || {};
      if (!handoffId || !manifest) return json(res, 400, { ok: false, error: 'handoffId and manifest are required.' });
      try {
        const report = await finalizeHandoff({ handoffId, batchId, manifest, expectedPaths, mode });
        return json(res, report.ok ? 200 : 500, { ok: report.ok, report });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }

    const batchWriteMatch = pathname.match(/^\/api\/batches\/([^/]+)\/write-batch-files$/);
    if (batchWriteMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const batchId = batchWriteMatch[1];
      const { manifest, files = [] } = body;
      if (!manifest && !files.length) return json(res, 400, { ok: false, batchlyWritten: false, error: 'No manifest or files provided.' });
      if (!isSafeBatchId(batchId)) return json(res, 400, { ok: false, batchlyWritten: false, error: `Unsafe batch id: ${batchId}` });

      // Preply-local mock-drive copy (atomic; informational).
      const preplyResult = await writeBatchFilesAtomic(BATCH_EXPORTS_DIR, batchId, manifest, files);

      // Batchly handoff (atomic + verified). Refuse — rather than create a stray
      // tree — if Batchly is not installed; the client blocks Exported on false.
      let batchly;
      if (!fsSync.existsSync(BATCHLY_ROOT)) {
        batchly = { ok: false, targetPath: path.join(BATCHLY_DOWNLOADS_DIR, batchId), filesWritten: 0, failed: [{ path: '(batchly)', error: 'Batchly workspace not found; handoff skipped.' }], reason: 'batchly_missing' };
      } else {
        batchly = await writeBatchFilesAtomic(BATCHLY_DOWNLOADS_DIR, batchId, manifest, files);
      }

      return json(res, batchly.ok ? 200 : 500, {
        ok: batchly.ok,
        batchId,
        batchlyWritten: batchly.ok,
        targetPath: batchly.targetPath,
        filesWritten: batchly.filesWritten,
        written: preplyResult.filesWritten,
        failed: batchly.failed,
        reason: batchly.ok ? null : batchly.reason
      });
    }

    if (pathname === '/api/batches' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const batch = await createBatch(body);
        return json(res, 200, { ok: true, batch });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }

    if (pathname === '/api/batches/clear-old' && req.method === 'POST') {
      const batches = await readBatches();
      const now = new Date().toISOString();
      const updated = batches.map(b => {
        if (['Canceled', 'Exported'].includes(b.status)) return b;
        return { ...b, status: 'Canceled', canceledAt: now, updatedAt: now, cancelReason: 'Cleared by user' };
      });
      await saveBatches(updated);
      const cleared = updated.filter(b => b.cancelReason === 'Cleared by user').length;
      return json(res, 200, { ok: true, cleared, batches: updated });
    }

    const batchUpdateMatch = pathname.match(/^\/api\/batches\/([^/]+)$/);
    if (batchUpdateMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const batch = await updateBatch(batchUpdateMatch[1], body.batch || body);
      return json(res, 200, { ok: true, batch });
    }

    const batchDryRunMatch = pathname.match(/^\/api\/batches\/([^/]+)\/dry-run$/);
    if (batchDryRunMatch && req.method === 'POST') {
      const batches = await readBatches();
      const batch = batches.find(b => b.id === batchDryRunMatch[1]);
      if (!batch) return json(res, 404, { error: 'Batch not found' });
      try {
        const report = await dryRunBatchExport(batch, await readStores());
        return json(res, 200, { ok: true, report });
      } catch (error) {
        return json(res, 500, { ok: false, error: error.message });
      }
    }

    const batchCancelMatch = pathname.match(/^\/api\/batches\/([^/]+)\/cancel$/);
    if (batchCancelMatch && req.method === 'POST') {
      const batch = await cancelBatch(batchCancelMatch[1]);
      return json(res, 200, { ok: true, batch });
    }

    // Per-design binary source uploads. Replaces the giant base64-JSON
    // designFiles payloads on batch create AND export (each design travels
    // once, raw, and in parallel from the client).
    const sourceDesignMatch = pathname.match(/^\/api\/batches\/([^/]+)\/source-designs\/([^/]+)$/);
    if (sourceDesignMatch && req.method === 'PUT') {
      const batches = await readBatches();
      const batch = batches.find(item => item.id === sourceDesignMatch[1]);
      if (!batch) return json(res, 404, { ok: false, error: 'Batch not found' });
      const design = (batch.designs || []).find(item => item.id === sourceDesignMatch[2]);
      if (!design) return json(res, 404, { ok: false, error: 'Design not found' });
      const filename = safeFilename(design.filename || `${design.id}.png`);
      const data = await readRawBody(req);
      if (!data.length) return json(res, 400, { ok: false, error: 'Empty body' });
      const target = sourceDesignPath(batch.id, filename);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
      design.sourcePngPath = target;
      design.sourcePngBytes = data.length;
      design.sourcePngStoredAt = new Date().toISOString();
      await saveBatches(batches);
      return json(res, 200, { ok: true, designId: design.id, size: data.length });
    }

    const sourceStatusMatch = pathname.match(/^\/api\/batches\/([^/]+)\/source-designs$/);
    if (sourceStatusMatch && req.method === 'GET') {
      const batches = await readBatches();
      const batch = batches.find(item => item.id === sourceStatusMatch[1]);
      if (!batch) return json(res, 404, { ok: false, error: 'Batch not found' });
      const designs = await Promise.all((batch.designs || []).map(async design => {
        const filename = safeFilename(design.filename || `${design.id}.png`);
        const target = design.sourcePngPath || sourceDesignPath(batch.id, filename);
        const stat = await fs.stat(target).catch(() => null);
        return { designId: design.id, exists: Boolean(stat), size: stat?.size || 0 };
      }));
      return json(res, 200, { ok: true, designs });
    }

    // Soft lock: each browser session claims the batch it has open with a
    // 60s heartbeat. A second session opening the same batch gets a conflict
    // warning (saves are last-writer-wins) instead of silently clobbering a
    // teammate's work. Claims expire after 2 minutes without a heartbeat.
    const batchClaimMatch = pathname.match(/^\/api\/batches\/([^/]+)\/claim$/);
    if (batchClaimMatch && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const clientId = String(body.clientId || '').slice(0, 64);
      if (!clientId) return json(res, 400, { ok: false, error: 'clientId required' });
      const batches = await readBatches();
      const batch = batches.find(item => item.id === batchClaimMatch[1]);
      if (!batch) return json(res, 404, { ok: false, error: 'Batch not found' });
      const now = Date.now();
      const holder = batch.activeEditor || null;
      const holderFresh = holder && (now - new Date(holder.at || 0).getTime()) < 120000;
      if (holderFresh && holder.clientId !== clientId) {
        return json(res, 200, { ok: true, conflict: true, holder: { at: holder.at } });
      }
      batch.activeEditor = { clientId, at: new Date(now).toISOString() };
      await saveBatches(batches);
      return json(res, 200, { ok: true, conflict: false });
    }

    const notifyBatchlyMatch = pathname.match(/^\/api\/batches\/([^/]+)\/notify-batchly$/);
    if (notifyBatchlyMatch && req.method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await notifyBatchlyScan({
        batchFolderName: body.batchFolderName || null,
        autoImport: body.autoImport !== false,
        quick: body.quick === true,
      });
      return json(res, 200, result);
    }

    const batchExportMatch = pathname.match(/^\/api\/batches\/([^/]+)\/exported$/);
    if (batchExportMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const batch = await commitExportedBatch(batchExportMatch[1], body.exportInfo || {});
      return json(res, 200, { ok: true, batch });
    }

    const batchResetMatch = pathname.match(/^\/api\/batches\/([^/]+)\/reset$/);
    if (batchResetMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      const batches = await readBatches();
      if (!batches.some(b => b.id === batchResetMatch[1])) return json(res, 404, { ok: false, error: 'Batch not found' });
      const result = await resetBatchWorkflow(batchResetMatch[1], { force: Boolean(body.force) });
      return json(res, result.ok ? 200 : 409, result);
    }

    if (pathname === '/api/presets' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const preset = normalizePreset(body.preset);
      if (!preset) return json(res, 400, { error: 'Invalid preset data' });
      const saved = await saveBlankPreset(body.filename, preset);
      return json(res, 200, { ok: true, preset: saved });
    }

    if (pathname === '/api/stamp-presets' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const preset = normalizeStampPreset(body.preset);
      if (!preset) return json(res, 400, { error: 'Invalid stamp preset data' });
      const saved = await saveStampPreset(body.filename, preset);
      return json(res, 200, { ok: true, preset: saved });
    }

    if (pathname.startsWith('/blank-mockups/')) {
      const relative = pathname.replace('/blank-mockups/', '');
      const filePath = safeJoin(BLANK_MOCKUPS_DIR, relative);
      if (!filePath) return send(res, 400, 'Bad path');
      return serveFile(res, filePath);
    }

    if (pathname.startsWith('/store-logos/')) {
      const relative = pathname.replace('/store-logos/', '');
      const filePath = safeJoin(STORE_LOGOS_DIR, relative);
      if (!filePath) return send(res, 400, 'Bad path');
      return serveFile(res, filePath);
    }

    if (pathname.startsWith('/free-shipping/')) {
      const relative = pathname.replace('/free-shipping/', '');
      const filePath = safeJoin(FREE_SHIPPING_DIR, relative);
      if (!filePath) return send(res, 400, 'Bad path');
      return serveFile(res, filePath);
    }

    if (pathname === '/vendor/jszip.min.js') {
      return serveFile(res, path.join(__dirname, 'node_modules', 'jszip', 'dist', 'jszip.min.js'));
    }

    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/ready-mockups') pathname = '/ready-mockups.html';
    const staticPath = safeJoin(PUBLIC_DIR, pathname);
    if (!staticPath) return send(res, 400, 'Bad path');
    return serveFile(res, staticPath);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: 'Server error', details: error.message });
  }
});

async function startServer() {
  await ensureDirs();
  await loadSettingsCache();
  for (const w of computeProductionWarnings(process.env, { stores: await readStores().catch(() => []) })) {
    console.warn(`[preply config ${w.level === 'error' ? 'ERROR' : 'WARN'}] ${w.code}: ${w.message} Fix: ${w.fix}`);
  }
  server.listen(PORT, async () => {
    console.log('============================================================');
    console.log('PREPLY PRODUCTION DRIVE EXPORT FIX ACTIVE');
    console.log('============================================================');
    console.log(`Preply is running at http://localhost:${PORT}`);
    console.log(`Add blank mockups inside: ${BLANK_MOCKUPS_DIR}`);
    console.log(`Add store logos inside: ${STORE_LOGOS_DIR}/<Shop Name>/logo.png`);
    console.log(`Add free shipping logo inside: ${FREE_SHIPPING_DIR}`);
    console.log('[Drive export fix] source-png-upload-v3-quota-aware');
    const driveStatus = await getDriveStatus();
    console.log(`[Drive] mode=${driveStatus.mode} adapter="${driveStatus.adapterLabel}" configured=${driveStatus.configured}`);
    if (driveStatus.mode === 'service_account') {
      console.log(`[Drive] keyPath=${driveStatus.keyPath} clientEmail=${driveStatus.clientEmail || 'unknown'}`);
    }
  });
}

// Pull durable state from Postgres BEFORE anything reads the data files.
// Deliberately not caught: with PREPLY_DATABASE_URL set, serving from blank
// disk state instead of the durable copy would masquerade as data loss.
// Without the env var this is a no-op (dev/tests are disk-only, as before).
await hydrateDurableState();

// Hydrate the settings cache on import so getHandoffMode()/
// getPendingBatchesFolderId() see persisted values even when the module is
// used as a library (tests import server.js without calling startServer).
await loadSettingsCache().catch(() => {});

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await startServer();
}

export {
  outstandingSkuFloors,
  withSkuReservationLock,
  patchStoreScanState,
  createBatch,
  createServiceAccountSkuFolder,
  commitExportedBatch,
  resetBatchWorkflow,
  exportDesignsToStoreDrives,
  dryRunBatchExport,
  uploadDesignToServiceAccountSkuFolder,
  uploadDesignToSkuFolder,
  verifyServiceAccountFolderAccess,
  rescanForSkuConflicts,
  refreshBatchSkuReservation,
  scanServiceAccountStoreSkuFolders,
  saveStores,
  reserveSkusFromDrive,
  activeStoreReadinessError,
  writeBatchFilesAtomic,
  isSafeBatchId,
  safeRelativeSegments,
  BATCH_EXPORTS_DIR,
  BATCHLY_DOWNLOADS_DIR,
  getDriveMode,
  isRemoteDriveMode,
  getDriveAdapterLabel,
  userFriendlyDriveError,
  loadOAuthClientConfig,
  buildOAuthConsentUrl,
  getOAuthStatus,
  readStores,
  readBatches,
  saveBatches,
  readJsonFile,
  writeJsonFile,
  BATCHES_FILE,
  DRIVE_EXPORT_REPORT_FILE,
  SOURCE_DESIGNS_DIR,
  MOCK_DRIVE_DIR,
  __setServiceAccountDriveClientForTests,
  __clearServiceAccountDriveClientForTests,
  __setOAuthDriveClientForTests,
  __clearOAuthDriveClientForTests,
  // Phase 3 exports
  startHandoff,
  appendHandoffFiles,
  finalizeHandoff,
  uploadTreeToMockPending,
  uploadTreeToPendingDrive,
  collectStagedRelativePaths,
  getHandoffMode,
  getPendingBatchesFolderId,
  HANDOFF_STAGING_DIR,
  MOCK_PENDING_BATCHES_DIR,
  __setDrivePendingUploaderForTests,
  __clearDrivePendingUploaderForTests,
  // Phase 5 exports
  server,
  SETTINGS_FILE,
  STORES_FILE,
  loadSettingsCache,
  readAppSettings,
  saveAppSettings,
  testPendingBatchesFolder,
  getSettingsStatus,
  storeReadinessReport,
  computeProductionWarnings,
  isProductionEnv,
  describeHandoffMode,
  describePendingBatchesFolder,
  // Hub store-config sync exports
  applyHubConfigSync,
  computeHubConfigDiff,
  driveTestFolder,
  driveInferPrefix,
  getReadOnlyDriveClient,
  getStoreConfigSource,
  HUB_CONFIG_STATE_FILE,
  STORES_BACKUP_DIR,
  // Durable-state exports
  DURABLE_STATE_FILES,
  removeJsonFile,
  __setStateStoreForTests,
  // Variation-profile (mockup preset design_type) exports
  normalizeMockupPreset,
  VARIATION_PROFILE_KEYS,
  DEFAULT_VARIATION_PROFILE,
};
