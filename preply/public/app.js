const state = {
  blankMockups: [],
  stores: [],
  freeShipping: null,
  settings: { minimumSelectedMockups: 1 },
  batches: [],
  mockupPresets: [],
  driveExportReport: null,
  driveStatus: { mode: 'mock', adapterLabel: 'Local mock Drive adapter', configured: true, clientEmail: null },
  batch: null,
  uploadedDesigns: [],
  zipValidation: null,
  csvMetadata: new Map(),
  intakeEditMode: null,
  activePage: 'upload',
  currentIntakeIndex: 0,
  currentProductionIndex: 0,
  designImage: null,
  designBounds: null,
  rendered: [],
  previewCache: new Map(),
  selected: new Set(),
  editingIndex: null,
  editorTab: 'placement',
  editorActiveLayer: 'design',
  editorInteraction: null,
  calibrationEntry: null,
  activeStampTarget: 'storeLogo',
  stampInteraction: null,
  previewMode: null,
  workflowCompleted: new Set(),
  toastTimer: null,
  persistTimer: null
};

const els = {
  navTabs: [...document.querySelectorAll('.nav-tab')],
  pages: {
    upload: document.getElementById('uploadPage'),
    intake: document.getElementById('intakePage'),
    mockup: document.getElementById('mockupPage'),
    stamp: document.getElementById('stampPage'),
    export: document.getElementById('exportPage'),
    settings: document.getElementById('settingsPage')
  },
  designCount: document.getElementById('designCount'),
  activeStoreCount: document.getElementById('activeStoreCount'),
  readyCount: document.getElementById('readyCount'),
  refreshAssetsBtn: document.getElementById('refreshAssetsBtn'),
  zipInput: document.getElementById('zipInput'),
  zipUploadZone: document.getElementById('zipUploadZone'),
  zipUploadLabel: document.getElementById('zipUploadLabel'),
  createBatchBtn: document.getElementById('createBatchBtn'),
  cancelBatchBtn: document.getElementById('cancelBatchBtn'),
  uploadSummary: document.getElementById('uploadSummary'),
  validationReport: document.getElementById('validationReport'),
  intakeList: document.getElementById('intakeList'),
  intakePreview: document.getElementById('intakePreview'),
  titleDescription: document.getElementById('titleDescription'),
  keywordsInput: document.getElementById('keywordsInput'),
  keywordMeta: document.getElementById('keywordMeta'),
  skuPreview: document.getElementById('skuPreview'),
  csvSourceBadge: document.getElementById('csvSourceBadge'),
  editMetadataBtn: document.getElementById('editMetadataBtn'),
  prevIntakeBtn: document.getElementById('prevIntakeBtn'),
  nextIntakeBtn: document.getElementById('nextIntakeBtn'),
  continueProductionBtn: document.getElementById('continueProductionBtn'),
  productionList: document.getElementById('productionList'),
  productionTitle: document.getElementById('productionTitle'),
  productionSubtitle: document.getElementById('productionSubtitle'),
  statusText: document.getElementById('statusText'),
  renderBtn: document.getElementById('renderBtn'),
  selectAllBtn: document.getElementById('selectAllBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  copyPreviousBtn: document.getElementById('copyPreviousBtn'),
  markReadyBtn: document.getElementById('markReadyBtn'),
  moveToStampingBtn: document.getElementById('moveToStampingBtn'),
  moveToStampingTopBtn: document.getElementById('moveToStampingTopBtn'),
  selectPresetBtn: document.getElementById('selectPresetBtn'),
  previewAllBtn: document.getElementById('previewAllBtn'),
  saveSelectionPresetBtn: document.getElementById('saveSelectionPresetBtn'),
  applyPresetBtn: document.getElementById('applyPresetBtn'),
  batchPresetBtn: document.getElementById('batchPresetBtn'),
  applyRemainingPresetBtn: document.getElementById('applyRemainingPresetBtn'),
  revertPresetBtn: document.getElementById('revertPresetBtn'),
  activePresetName: document.getElementById('activePresetName'),
  presetSelectionStatus: document.getElementById('presetSelectionStatus'),
  mockupGrid: document.getElementById('mockupGrid'),
  runStampBtn: document.getElementById('runStampBtn'),
  stampEmptyState: document.getElementById('stampEmptyState'),
  stampWorkspace: document.getElementById('stampWorkspace'),
  stampStoreList: document.getElementById('stampStoreList'),
  stampDesignList: document.getElementById('stampDesignList'),
  stampPreviewGrid: document.getElementById('stampPreviewGrid'),
  stampPreviewTitle: document.getElementById('stampPreviewTitle'),
  stampPreviewSubtitle: document.getElementById('stampPreviewSubtitle'),
  dryRunBtn: document.getElementById('dryRunBtn'),
  dryRunReport: document.getElementById('dryRunReport'),
  exportZipBtn: document.getElementById('exportZipBtn'),
  exportSummary: document.getElementById('exportSummary'),
  exportReport: document.getElementById('exportReport'),
  driveExportReport: document.getElementById('driveExportReport'),
  retryDriveBtn: document.getElementById('retryDriveBtn'),
  refreshSkuBtn: document.getElementById('refreshSkuBtn'),
  clearOldBatchesBtn: document.getElementById('clearOldBatchesBtn'),
  manifestPreview: document.getElementById('manifestPreview'),
  batchMetricsRow: document.getElementById('batchMetricsRow'),
  exportSuccessBanner: document.getElementById('exportSuccessBanner'),
  resetBatchBtn: document.getElementById('resetBatchBtn'),
  driveOAuthBanner: document.getElementById('driveOAuthBanner'),
  driveOAuthTitle: document.getElementById('driveOAuthTitle'),
  driveOAuthMessage: document.getElementById('driveOAuthMessage'),
  connectDriveBtn: document.getElementById('connectDriveBtn'),
  disconnectDriveBtn: document.getElementById('disconnectDriveBtn'),
  folderBrowserPanel: document.getElementById('folderBrowserPanel'),
  folderTreeRoot: document.getElementById('folderTreeRoot'),
  filePreviewArea: document.getElementById('filePreviewArea'),
  storeSettingsList: document.getElementById('storeSettingsList'),
  settingsWarnings: document.getElementById('settingsWarnings'),
  connectionSettingsGrid: document.getElementById('connectionSettingsGrid'),
  refreshConnectionsBtn: document.getElementById('refreshConnectionsBtn'),
  mockupPresetList: document.getElementById('mockupPresetList'),
  newPresetBtn: document.getElementById('newPresetBtn'),
  workflowProgressStrip: document.getElementById('workflowProgressStrip'),
  stampProgressPanel: document.getElementById('stampProgressPanel'),
  stampProgressGrid: document.getElementById('stampProgressGrid'),
  stampDirectory: document.getElementById('stampDirectory'),
  stampDirectoryTree: document.getElementById('stampDirectoryTree'),
  layerDesignBtn: document.getElementById('layerDesignBtn'),
  layerStoreLogoBtn: document.getElementById('layerStoreLogoBtn'),
  layerShippingBtn: document.getElementById('layerShippingBtn'),
  editorDesignControls: document.getElementById('editorDesignControls'),
  editorLogoControls: document.getElementById('editorLogoControls'),
  editorLayerHint: document.getElementById('editorLayerHint'),
  hubConfigureLink: document.getElementById('hubConfigureLink'),
  cardTemplate: document.getElementById('cardTemplate'),
  stampedCardTemplate: document.getElementById('stampedCardTemplate'),
  editDialog: document.getElementById('editDialog'),
  editorCanvas: document.getElementById('editorCanvas'),
  editorTitle: document.getElementById('editorTitle'),
  editorTabPlacement: document.getElementById('editorTabPlacement'),
  editorTabCalibration: document.getElementById('editorTabCalibration'),
  editorPlacementSection: document.getElementById('editorPlacementSection'),
  editorCalibrationSection: document.getElementById('editorCalibrationSection'),
  closeEditorBtn: document.getElementById('closeEditorBtn'),
  scaleRange: document.getElementById('scaleRange'),
  scaleValue: document.getElementById('scaleValue'),
  smallerBtn: document.getElementById('smallerBtn'),
  largerBtn: document.getElementById('largerBtn'),
  rotationValue: document.getElementById('rotationValue'),
  rotateLeftBtn: document.getElementById('rotateLeftBtn'),
  rotateRightBtn: document.getElementById('rotateRightBtn'),
  straightenBtn: document.getElementById('straightenBtn'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  saveEditorBtn: document.getElementById('saveEditorBtn'),
  downloadCurrentBtn: document.getElementById('downloadCurrentBtn'),
  stampEditorCanvas: document.getElementById('stampEditorCanvas'),
  editStoreLogoBtn: document.getElementById('editStoreLogoBtn'),
  editFreeShippingBtn: document.getElementById('editFreeShippingBtn'),
  stampScaleRange: document.getElementById('stampScaleRange'),
  stampScaleValue: document.getElementById('stampScaleValue'),
  stampSmallerBtn: document.getElementById('stampSmallerBtn'),
  stampLargerBtn: document.getElementById('stampLargerBtn'),
  stampRotationValue: document.getElementById('stampRotationValue'),
  stampRotateLeftBtn: document.getElementById('stampRotateLeftBtn'),
  stampRotateRightBtn: document.getElementById('stampRotateRightBtn'),
  stampStraightenBtn: document.getElementById('stampStraightenBtn'),
  saveStampPresetBtn: document.getElementById('saveStampPresetBtn'),
  applyStampChangesBtn: document.getElementById('applyStampChangesBtn'),
  downloadStampedCurrentBtn: document.getElementById('downloadStampedCurrentBtn'),
  toast: document.getElementById('toast')
};

function setStatus(message) {
  els.statusText.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

// Workflow step order for progress bar
const WORKFLOW_STEPS = ['upload', 'intake', 'mockup', 'stamp', 'export'];

function updateWorkflowProgress() {
  const strip = els.workflowProgressStrip;
  if (!strip) return;
  const completed = state.workflowCompleted;
  const current = state.activePage;
  WORKFLOW_STEPS.forEach((step, i) => {
    const dot = strip.querySelector(`.wf-step[data-step="${step}"]`);
    const connector = strip.querySelectorAll('.wf-connector')[i];
    if (!dot) return;
    dot.classList.remove('wf-complete', 'wf-current', 'wf-pending');
    if (completed.has(step)) dot.classList.add('wf-complete');
    else if (step === current) dot.classList.add('wf-current');
    else dot.classList.add('wf-pending');
    if (connector) connector.classList.toggle('wf-connector-filled', completed.has(step));
  });
}

function markWorkflowStep(step) {
  state.workflowCompleted.add(step);
  updateWorkflowProgress();
}

function switchPage(page) {
  state.activePage = page;
  Object.entries(els.pages).forEach(([name, node]) => node.classList.toggle('active', name === page));
  els.navTabs.forEach(button => button.classList.toggle('active', button.dataset.page === page));
  updateWorkflowProgress();
  if (page === 'export') renderCurrentBatch();
  if (page === 'stamp') renderStampPage();
  if (page === 'settings') refreshConnectionSettings();
}

function cleanName(input) {
  return String(input || 'item')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'item';
}

function escapeHtml(input) {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getImageSize(image) {
  return {
    width: image.naturalWidth || image.width || 512,
    height: image.naturalHeight || image.height || 512
  };
}

// Memoized: mockup/logo URLs are loaded once and shared across every design
// render and background preload. Failures are evicted so retries can work.
const loadImageCache = new Map();
function loadImage(src) {
  if (loadImageCache.has(src)) return loadImageCache.get(src);
  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image: ${src}`));
    image.src = src;
  });
  loadImageCache.set(src, promise);
  promise.catch(() => loadImageCache.delete(src));
  return promise;
}
// In-dialog save feedback: toasts render UNDER an open modal <dialog> (the
// dialog sits in the browser's top layer), so a toast alone is invisible while
// the editor is open. Flash the button itself instead.
function flashButton(button, label = '\u2713 Saved') {
  if (!button) return;
  const original = button.textContent;
  button.textContent = label;
  button.classList.add('btn-flash');
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('btn-flash');
    button.disabled = false;
  }, 1200);
}


function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read PNG design.'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type = 'image/png', quality = 0.94) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not encode blob.'));
    reader.readAsDataURL(blob);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// Soft-lock heartbeat: warn when a teammate has the same batch open (saves
// are last-writer-wins, so concurrent editing silently overwrites work).
const CLIENT_SESSION_ID = (() => {
  try {
    let id = localStorage.getItem('preply_client_id');
    if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('preply_client_id', id); }
    return id;
  } catch { return Math.random().toString(36).slice(2); }
})();
let batchClaimConflictShown = false;
async function claimActiveBatch() {
  if (!state.batch?.id) return;
  try {
    const res = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/claim`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: CLIENT_SESSION_ID }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.ok && body.conflict && !batchClaimConflictShown) {
      batchClaimConflictShown = true;
      showToast('Heads up: a teammate has this batch open. You may overwrite each other\u2019s changes.');
      setStatus('\u26a0\ufe0f This batch is open in another session \u2014 coordinate before editing, or your saves may overwrite each other.');
    }
    if (body.ok && !body.conflict) batchClaimConflictShown = false;
  } catch { /* heartbeat is best-effort */ }
}
setInterval(claimActiveBatch, 60000);

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

// Upload source PNGs one-per-request as raw binary, three at a time — no
// base64 inflation, no giant JSON body for the server to parse. With
// onlyMissing, designs the server already has on disk are skipped entirely.
async function uploadSourceDesigns(batchId, { onlyMissing = true, onProgress = null } = {}) {
  let pending = state.uploadedDesigns;
  if (onlyMissing) {
    const statusRes = await fetch(`/api/batches/${encodeURIComponent(batchId)}/source-designs`);
    const status = await statusRes.json().catch(() => ({}));
    if (statusRes.ok && status.ok) {
      const missing = new Set(status.designs.filter(d => !d.exists).map(d => d.designId));
      pending = state.uploadedDesigns.filter(design => missing.has(design.id));
    }
  }
  if (!pending.length) return { uploaded: 0, skipped: state.uploadedDesigns.length };
  let done = 0;
  await mapConcurrent(pending, 3, async (design) => {
    const res = await fetch(`/api/batches/${encodeURIComponent(batchId)}/source-designs/${encodeURIComponent(design.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: design.file,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `Source upload failed for ${design.id}`);
    done += 1;
    if (onProgress) onProgress(done, pending.length);
  });
  return { uploaded: done, skipped: state.uploadedDesigns.length - pending.length };
}

function detectVisibleArtworkBounds(image, includeTransparency = false) {
  const { width, height } = getImageSize(image);
  const maxScanSide = 1800;
  const ratio = Math.min(1, maxScanSide / Math.max(width, height));
  const scanW = Math.max(1, Math.round(width * ratio));
  const scanH = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = scanW;
  canvas.height = scanH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, scanW, scanH);
  ctx.drawImage(image, 0, 0, scanW, scanH);
  const pixels = ctx.getImageData(0, 0, scanW, scanH).data;
  let minX = scanW;
  let minY = scanH;
  let maxX = -1;
  let maxY = -1;
  let transparentPixels = 0;
  const alphaThreshold = 8;
  for (let y = 0; y < scanH; y += 1) {
    for (let x = 0; x < scanW; x += 1) {
      const alpha = pixels[(y * scanW + x) * 4 + 3];
      if (alpha < 250) transparentPixels += 1;
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX === -1) {
    return { x: 0, y: 0, width, height, originalWidth: width, originalHeight: height, visibleRatio: 0, hasTransparency: true };
  }
  const pad = Math.ceil(3 / ratio);
  const sourceX = clamp(Math.floor(minX / ratio) - pad, 0, width - 1);
  const sourceY = clamp(Math.floor(minY / ratio) - pad, 0, height - 1);
  const sourceMaxX = clamp(Math.ceil((maxX + 1) / ratio) + pad, sourceX + 1, width);
  const sourceMaxY = clamp(Math.ceil((maxY + 1) / ratio) + pad, sourceY + 1, height);
  const bounds = {
    x: sourceX,
    y: sourceY,
    width: sourceMaxX - sourceX,
    height: sourceMaxY - sourceY,
    originalWidth: width,
    originalHeight: height,
    visibleRatio: ((sourceMaxX - sourceX) * (sourceMaxY - sourceY)) / (width * height),
    hasTransparency: transparentPixels > 0
  };
  return includeTransparency ? bounds : bounds;
}

function normalizeKeywords(input) {
  const parts = String(input || '')
    .split(/[\n,|]+/g)
    .map(part => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const seen = new Set();
  const normalized = [];
  const duplicates = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) duplicates.push(part);
    else {
      seen.add(key);
      normalized.push(part);
    }
  }
  const warnings = [];
  if (duplicates.length) warnings.push(`Duplicate keywords: ${[...new Set(duplicates)].join(', ')}`);
  if (normalized.length > 13) warnings.push('More than 13 keywords.');
  const long = normalized.filter(keyword => keyword.length > 40);
  if (long.length) warnings.push(`Long keywords: ${long.join(', ')}`);
  return { value: normalized.join('|'), count: normalized.length, warnings };
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuote = false;
      } else { current += ch; }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { fields.push(current); current = ''; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseManifestCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const rows = lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]));
  }).filter(row => Object.values(row).some(v => v));
  return { headers, rows };
}

function activeStores() {
  return state.stores.filter(store => store.active).slice(0, 8);
}

function currentDesign() {
  return state.uploadedDesigns[state.currentProductionIndex] || null;
}

function currentIntakeDesign() {
  return state.uploadedDesigns[state.currentIntakeIndex] || null;
}

function hasSelectedMockups(design) {
  return Boolean(design && (design.selectedMockups || []).length > 0);
}

// A design is stamped for export when stamping has run for the batch and every
// active store recorded a non-error status for this design. 'warning' (e.g.
// fell back to default placement) still counts as stamped — it is not a blocker.
function isDesignStampedForActiveStores(design) {
  if (!design) return false;
  const stage = state.batch?.workflowStage;
  if (stage !== 'stamped') return false;
  const stampStatus = state.batch?.stampStatus || {};
  const stores = activeStores();
  if (!stores.length) return false;
  return stores.every(store => {
    const status = stampStatus[store.id]?.[design.id];
    return status === 'complete' || status === 'warning';
  });
}

// Readiness is now derived from actual workflow state instead of a manual
// "Mark Design Ready" click: selected mockups + stamping complete for all
// active stores.
function isDesignExportReady(design) {
  return hasSelectedMockups(design) && isDesignStampedForActiveStores(design);
}

function batchDesign(designId) {
  return state.batch?.designs?.find(design => design.id === designId) || null;
}

function defaultMockupPreset() {
  return state.mockupPresets.find(preset => preset.is_default) || null;
}

function presetById(presetId) {
  return state.mockupPresets.find(preset => preset.preset_id === presetId) || null;
}

function availableMockupIds(ids) {
  const available = new Set(state.blankMockups.map(mockup => mockup.filename));
  return [...new Set((ids || []).filter(id => available.has(id)))];
}

function updateStats() {
  els.designCount.textContent = String(state.uploadedDesigns.length || state.batch?.designs?.length || 0);
  els.activeStoreCount.textContent = String(activeStores().length);
  const ready = state.uploadedDesigns.filter(isDesignExportReady).length;
  els.readyCount.textContent = String(ready);
  els.cancelBatchBtn.disabled = !state.batch || ['Canceled', 'Exported'].includes(state.batch.status);
}

async function refreshState() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  const data = await response.json();
  state.blankMockups = data.blankMockups || [];
  state.stores = data.stores || [];
  state.freeShipping = data.freeShipping || null;
  state.settings = data.settings || state.settings;
  state.batches = data.batches || [];
  state.mockupPresets = data.mockupPresets || [];
  state.driveExportReport = data.driveExportReport || null;
  state.driveStatus = data.driveStatus || state.driveStatus;
  renderStoreSettings();
  renderMockupPresetManager();
  updateStats();
}

function reportItem(kind, title, detail = '') {
  return `<div class="report-item ${kind}"><strong>${title}</strong>${detail ? `<span>${detail}</span>` : ''}</div>`;
}

function renderValidationReport(validation) {
  els.validationReport.innerHTML = '';
  if (!validation) return;
  const html = [
    ...validation.errors.map(error => reportItem('error', error)),
    ...validation.warnings.map(warning => reportItem('warning', warning)),
    ...validation.infos.map(info => reportItem('ok', info))
  ].join('');
  els.validationReport.innerHTML = html || reportItem('ok', 'ZIP looks ready.');
  els.uploadSummary.textContent = validation.errors.length
    ? 'Fix the errors before Preply reserves SKUs.'
    : `${validation.designIds.length} valid design${validation.designIds.length === 1 ? '' : 's'} found: ${validation.designIds.join(', ')}`;
  els.createBatchBtn.disabled = Boolean(validation.errors.length || !validation.designIds.length);
  renderDriveRangeReport();
}

function renderDriveRangeReport() {
  if (!els.driveRangeReport) return;
  const ranges = state.batch?.driveReservedRanges;
  if (!ranges) {
    els.driveRangeReport.innerHTML = '';
    return;
  }
  els.driveRangeReport.innerHTML = Object.values(ranges).map(range => reportItem(
    'ok',
    `${escapeHtml(range.storeName)}: ${escapeHtml(range.reservedStart)}-${escapeHtml(range.reservedEnd)}`,
    `Latest found in Drive: ${range.latestFound || 'none'} • scanned ${range.scannedAt ? new Date(range.scannedAt).toLocaleString() : 'not scanned'}`
  )).join('');
}

async function validateZipFile(file) {
  if (!window.JSZip) throw new Error('ZIP support is not installed. Run npm install, then restart Preply.');
  els.zipUploadLabel.textContent = file.name;
  els.createBatchBtn.disabled = true;
  els.uploadSummary.textContent = 'Reading ZIP and validating manifest_input.csv...';
  const zip = await JSZip.loadAsync(file);

  const allEntries = Object.values(zip.files).filter(entry => {
    const base = entry.name.split('/').pop();
    return !entry.dir && base && !base.startsWith('.') && !entry.name.startsWith('__MACOSX/') && base !== '.DS_Store';
  });

  const errors = [];
  const warnings = [];
  const infos = [];

  // --- Parse manifest_input.csv ---
  const manifestEntry = allEntries.find(e => e.name.split('/').pop() === 'manifest_input.csv');
  let csvMap = new Map();
  let csvColumnsOk = false;

  if (!manifestEntry) {
    errors.push('manifest_input.csv is missing from the ZIP. Include manifest_input.csv with columns: design_id, design_file, title_description, keywords.');
  } else {
    const csvText = await manifestEntry.async('text');
    const { headers, rows } = parseManifestCsv(csvText);
    const required = ['design_id', 'design_file', 'title_description', 'keywords'];
    const missing = required.filter(c => !headers.includes(c));
    if (missing.length) {
      errors.push(`manifest_input.csv is missing required columns: ${missing.join(', ')}.`);
    } else {
      csvColumnsOk = true;
      const seenIds = new Set();
      for (const row of rows) {
        if (!row.design_id) { errors.push('manifest_input.csv has a row with no design_id.'); continue; }
        if (seenIds.has(row.design_id)) { errors.push(`Duplicate design_id ${row.design_id} in manifest_input.csv.`); continue; }
        seenIds.add(row.design_id);
        if (!row.title_description) errors.push(`${row.design_id}: title_description is empty in manifest_input.csv.`);
        if (!row.keywords) {
          warnings.push(`${row.design_id}: no keywords in manifest_input.csv.`);
        } else {
          const kw = normalizeKeywords(row.keywords);
          kw.warnings.forEach(w => warnings.push(`${row.design_id}: ${w}`));
        }
        csvMap.set(row.design_id, row);
      }
    }
  }

  // --- Collect PNG entries ---
  const pngEntries = [];
  const seenPng = new Set();
  for (const entry of allEntries) {
    const filename = entry.name.split('/').pop();
    if (filename === 'manifest_input.csv') continue;
    if (!filename.toLowerCase().endsWith('.png')) {
      warnings.push(`Skipping non-PNG file: ${filename}`);
      continue;
    }
    const match = filename.match(/^(D\d{3})\.png$/i);
    if (!match) { errors.push(`${filename} must be named like D001.png, D002.png, etc.`); continue; }
    const id = match[1].toUpperCase();
    if (seenPng.has(id)) { errors.push(`Duplicate design ID ${id}.`); continue; }
    seenPng.add(id);
    pngEntries.push({ id, entry, filename: `${id}.png` });
  }

  pngEntries.sort((a, b) => a.id.localeCompare(b.id));
  if (pngEntries.length > 30) errors.push('Maximum batch size is 30 PNG designs.');
  if (!pngEntries.length) errors.push('No valid D001.png style designs found in ZIP.');
  pngEntries.forEach((item, index) => {
    const expected = `D${String(index + 1).padStart(3, '0')}`;
    if (item.id !== expected) errors.push(`Missing sequence number ${expected}. Designs must start at D001 with no gaps.`);
  });

  // --- Cross-reference CSV ↔ PNG ---
  if (csvColumnsOk) {
    for (const [id] of csvMap) {
      if (!pngEntries.find(p => p.id === id)) errors.push(`${id} exists in manifest_input.csv but ${id}.png was not found in the ZIP.`);
    }
    for (const png of pngEntries) {
      if (!csvMap.has(png.id)) errors.push(`${png.filename} found in ZIP but has no row in manifest_input.csv.`);
    }
  }

  // --- Load images and detect bounds (parallel: decode dominates import time) ---
  const importItems = pngEntries.slice(0, 30);
  let decoded = 0;
  const results = await mapConcurrent(importItems, 4, async (item) => {
    const blob = await item.entry.async('blob');
    const fileLike = new File([blob], item.filename, { type: 'image/png' });
    const image = await blobToImage(fileLike);
    const bounds = detectVisibleArtworkBounds(image, true);
    decoded += 1;
    els.uploadSummary.textContent = `Analyzing designs... ${decoded} of ${importItems.length}`;
    return { item, fileLike, image, bounds };
  });
  const uploadedDesigns = [];
  for (const { item, fileLike, image, bounds } of results) {
    if (!bounds.hasTransparency) warnings.push(`${item.filename} does not appear to include transparent pixels.`);
    if (bounds.originalWidth < 1800 || bounds.originalHeight < 1800) warnings.push(`${item.filename} is ${bounds.originalWidth}×${bounds.originalHeight}; consider a larger source design.`);
    if (bounds.visibleRatio < 0.08) warnings.push(`${item.filename} has heavy transparent padding; Preply will use visible artwork bounds.`);
    infos.push(`${item.filename}: visible artwork ${bounds.width}×${bounds.height} inside ${bounds.originalWidth}×${bounds.originalHeight}.`);
    uploadedDesigns.push({ id: item.id, filename: item.filename, file: fileLike, image, bounds, title: '', description: '', keywords: '', intakeComplete: false, productionStatus: 'Not Started', selectedMockups: [], finalImageFiles: [] });
  }

  state.csvMetadata = csvMap;
  state.uploadedDesigns = uploadedDesigns;
  state.zipValidation = { designIds: uploadedDesigns.map(d => d.id), errors, warnings, infos, sourceZipName: file.name };
  renderValidationReport(state.zipValidation);
  updateStats();
}

async function createBatch() {
  if (!state.zipValidation || state.zipValidation.errors.length) return;
  els.createBatchBtn.disabled = true;
  els.createBatchBtn.textContent = 'Scanning Drive SKUs...';
  try {
    const response = await fetch('/api/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceZipName: state.zipValidation.sourceZipName,
        designIds: state.zipValidation.designIds,
        validation: state.zipValidation
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || data.details || 'Could not create batch.');
    state.batch = data.batch;
    claimActiveBatch();

    // Source PNGs travel separately: raw binary, three at a time. Much faster
    // than the old single giant base64 JSON payload, and each design uploads
    // exactly once.
    els.createBatchBtn.textContent = 'Uploading source designs...';
    await uploadSourceDesigns(state.batch.id, {
      onlyMissing: false,
      onProgress: (done, total) => { els.createBatchBtn.textContent = `Uploading source designs... ${done}/${total}`; },
    });

    // Auto-populate title/description/keywords from manifest_input.csv
    state.uploadedDesigns.forEach(design => {
      const meta = state.csvMetadata.get(design.id);
      if (meta) {
        const kw = normalizeKeywords(meta.keywords || '');
        design.title = meta.title_description || '';
        design.description = meta.title_description || '';
        design.keywords = kw.value;
        design.intakeComplete = Boolean(design.title);
      }
      const bd = batchDesign(design.id);
      if (bd) {
        Object.assign(design, {
          productionStatus: bd.productionStatus,
          selectedMockups: bd.selectedMockups,
          finalImageFiles: bd.finalImageFiles
        });
      }
    });

    // Sync CSV metadata back to batch and persist
    state.uploadedDesigns.forEach(design => syncDesignToBatch(design));
    if (state.batch && state.uploadedDesigns.every(d => d.intakeComplete)) {
      state.batch.status = 'Intake Complete';
    }
    await persistBatchNow();

    state.intakeEditMode = null;
    renderDriveRangeReport();
    state.currentIntakeIndex = 0;
    state.currentProductionIndex = 0;
    markWorkflowStep('upload');
    showToast(`SKUs reserved. Metadata loaded for ${state.batch.id}.`);
    renderIntake();
    updateStats();
    switchPage('intake');
  } catch (error) {
    els.uploadSummary.textContent = error.message;
    showToast('Batch creation failed.');
  } finally {
    els.createBatchBtn.textContent = 'Scan Drive SKUs & Continue';
    els.createBatchBtn.disabled = Boolean(state.zipValidation?.errors?.length);
  }
}

async function persistBatchNow() {
  if (!state.batch) return;
  try {
    await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch: state.batch })
    });
  } catch (error) {
    console.error(error);
  }
}

function queuePersistBatch() {
  clearTimeout(state.persistTimer);
  state.persistTimer = setTimeout(persistBatchNow, 450);
}

function syncDesignToBatch(design) {
  const target = batchDesign(design.id);
  if (!target) return;
  Object.assign(target, {
    title: design.title,
    description: design.description,
    keywords: design.keywords,
    intakeComplete: design.intakeComplete,
    productionStatus: design.productionStatus,
    selectedMockups: design.selectedMockups,
    selectionType: design.selectionType || 'manual',
    mockupPresetId: design.mockupPresetId || null,
    mockupPresetName: design.mockupPresetName || null,
    variationProfile: design.variationProfile || DEFAULT_VARIATION_PROFILE,
    finalImageFiles: design.finalImageFiles
  });
  if (state.batch) {
    state.batch.perDesignOverrides = state.batch.perDesignOverrides || {};
    if (design.selectionType === 'custom') {
      state.batch.perDesignOverrides[design.id] = {
        selection_type: 'custom',
        selected_mockup_ids: design.selectedMockups || []
      };
    } else if (state.batch.perDesignOverrides[design.id]) {
      delete state.batch.perDesignOverrides[design.id];
    }
  }
}

function drawDesignPreview(canvas, design) {
  if (!design?.image) return;
  const maxSide = 720;
  const { width, height } = getImageSize(design.image);
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(design.image, 0, 0, canvas.width, canvas.height);
}

function renderDesignList(container, activeIndex, onClick) {
  container.innerHTML = '';
  state.uploadedDesigns.forEach((design, index) => {
    const item = document.createElement('button');
    item.className = `side-item ${index === activeIndex ? 'active' : ''}`;
    const status = design.productionStatus === 'Ready' ? 'Ready' : design.intakeComplete ? 'Metadata OK' : 'Needs metadata';
    item.innerHTML = `<strong>${design.id}</strong><span>${status}</span>`;
    item.addEventListener('click', () => onClick(index));
    container.appendChild(item);
  });
}

function renderIntake() {
  if (!state.batch || !state.uploadedDesigns.length) return;
  const design = currentIntakeDesign();
  renderDesignList(els.intakeList, state.currentIntakeIndex, index => {
    if (state.intakeEditMode) saveCurrentIntake(false);
    state.currentIntakeIndex = index;
    renderIntake();
  });
  drawDesignPreview(els.intakePreview, design);

  const hasCSV = state.csvMetadata.size > 0;
  const editMode = state.intakeEditMode === design.id;

  // Populate fields
  els.titleDescription.value = design.title || '';
  els.keywordsInput.value = design.keywords ? design.keywords.replace(/\|/g, ' | ') : '';

  // Read-only when CSV is loaded and not in edit mode
  els.titleDescription.readOnly = hasCSV && !editMode;
  els.keywordsInput.readOnly = hasCSV && !editMode;

  // CSV source badge
  if (els.csvSourceBadge) {
    els.csvSourceBadge.style.display = hasCSV ? 'flex' : 'none';
    const label = els.csvSourceBadge.querySelector('.csv-source-label');
    if (label) label.textContent = editMode ? 'Editing — changes override CSV data' : 'Loaded from manifest_input.csv';
  }
  if (els.editMetadataBtn) {
    els.editMetadataBtn.textContent = editMode ? 'Lock Fields' : 'Edit Metadata';
  }

  renderKeywordMeta();
  renderSkuPreview(design.id);
  const allComplete = state.uploadedDesigns.every(item => item.intakeComplete);
  els.continueProductionBtn.disabled = !allComplete;
  updateStats();
}

function renderKeywordMeta() {
  const result = normalizeKeywords(els.keywordsInput.value);
  const warningText = result.warnings.length ? ` • ${result.warnings.join(' • ')}` : '';
  els.keywordMeta.textContent = `${result.count} keyword${result.count === 1 ? '' : 's'}${warningText}`;
  els.keywordMeta.classList.toggle('warning', Boolean(result.warnings.length));
}

function renderSkuPreview(designId) {
  const skus = state.batch?.reservedSkus?.[designId] || {};
  els.skuPreview.innerHTML = Object.values(skus).map(entry => (
    `<div class="sku-row"><span>${escapeHtml(entry.storeName)} <small>Drive</small></span><strong>${escapeHtml(entry.sku)}</strong></div>`
  )).join('');
}

function saveCurrentIntake(requireValid = false) {
  const design = currentIntakeDesign();
  if (!design) return false;
  const keywords = normalizeKeywords(els.keywordsInput.value);
  design.title = els.titleDescription.value.trim();
  design.description = design.title;
  design.keywords = keywords.value;
  design.intakeComplete = Boolean(design.title);
  syncDesignToBatch(design);
  if (state.batch) {
    state.batch.status = state.uploadedDesigns.every(item => item.intakeComplete) ? 'Intake Complete' : 'Intake In Progress';
  }
  renderKeywordMeta();
  renderDesignList(els.intakeList, state.currentIntakeIndex, index => {
    if (state.intakeEditMode) saveCurrentIntake(false);
    state.currentIntakeIndex = index;
    renderIntake();
  });
  queuePersistBatch();
  if (requireValid && !design.intakeComplete) {
    showToast('Title/description is required.');
    return false;
  }
  return true;
}

function goNextIntake() {
  if (state.intakeEditMode) saveCurrentIntake(false);
  if (state.currentIntakeIndex < state.uploadedDesigns.length - 1) {
    state.currentIntakeIndex += 1;
    renderIntake();
  } else if (state.uploadedDesigns.every(design => design.intakeComplete)) {
    startProduction();
  } else {
    showToast('Some designs have missing title/description.');
  }
}

function toggleIntakeEditMode() {
  const design = currentIntakeDesign();
  if (!design) return;
  if (state.intakeEditMode === design.id) {
    saveCurrentIntake(false);
    state.intakeEditMode = null;
  } else {
    state.intakeEditMode = design.id;
  }
  renderIntake();
}

function startProduction() {
  saveCurrentIntake(false);
  state.currentProductionIndex = Math.min(state.currentProductionIndex, state.uploadedDesigns.length - 1);
  const defaultPreset = defaultMockupPreset();
  if (defaultPreset && state.batch && !state.batch.activeMockupPresetId) {
    const useDefault = window.confirm(`Use your default mockup preset "${defaultPreset.preset_name}" for this batch?`);
    if (useDefault) applyPresetToBatch(defaultPreset, false);
  }
  if (state.batch) state.batch.status = 'Production In Progress';
  persistBatchNow();
  markWorkflowStep('intake');
  renderProduction();
  switchPage('mockup');
}

async function loadActiveDesignForProduction() {
  const design = currentDesign();
  if (!design) return;
  state.designImage = design.image;
  state.designBounds = design.bounds;
  state.selected = new Set(design.selectedMockups || []);
  state.rendered = state.previewCache.get(design.id) || [];
  if (!state.rendered.length) {
    els.mockupGrid.innerHTML = '';
  } else {
    drawGrid();
  }
}

function renderProduction() {
  renderDesignList(els.productionList, state.currentProductionIndex, index => {
    state.currentProductionIndex = index;
    renderProduction();
  });
  const design = currentDesign();
  if (!design) return;
  els.productionTitle.textContent = `${design.id} Production`;
  els.productionSubtitle.textContent = `${design.title || 'Untitled'} • ${design.productionStatus || 'Not Started'}`;
  renderPresetStatus();
  loadActiveDesignForProduction();
  updateProductionButtons();
  updateStats();
}

function defaultPlacement(mockupImage, designBounds, placementOverride = null) {
  const { width: mockW, height: mockH } = getImageSize(mockupImage);
  const sourceW = designBounds.width;
  const sourceH = designBounds.height;
  const preset = placementOverride?.type === 'stbz-preset-v3' || placementOverride?.type === 'stbz-preset-v2' ? placementOverride : null;
  let box;
  let center;
  let rotationDeg = 0;
  const scalePct = placementOverride?.scalePct || 100;
  if (preset) {
    center = { x: preset.center.x * mockW, y: preset.center.y * mockH };
    box = { width: preset.box.width * mockW, height: preset.box.height * mockH };
    rotationDeg = Number(preset.rotationDeg || 0);
  } else {
    const area = placementOverride?.area || { x: 0.5, y: 0.43, width: 0.42, height: 0.44 };
    center = { x: area.x * mockW, y: area.y * mockH };
    box = { width: area.width * mockW, height: area.height * mockH };
  }
  const fitScale = Math.min(box.width / sourceW, box.height / sourceH);
  const baseWidth = Math.round(sourceW * fitScale);
  const baseHeight = Math.round(sourceH * fitScale);
  const width = Math.round(baseWidth * (scalePct / 100));
  const height = Math.round(baseHeight * (scalePct / 100));
  return {
    baseWidth,
    baseHeight,
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2),
    width,
    height,
    scalePct,
    rotationDeg,
    area: { x: center.x / mockW, y: center.y / mockH, width: box.width / mockW, height: box.height / mockH },
    fromPreset: Boolean(preset)
  };
}

function applyScale(item, nextScalePct) {
  const centerX = item.placement.x + item.placement.width / 2;
  const centerY = item.placement.y + item.placement.height / 2;
  item.placement.width = Math.round(item.placement.baseWidth * (nextScalePct / 100));
  item.placement.height = Math.round(item.placement.baseHeight * (nextScalePct / 100));
  item.placement.x = Math.round(centerX - item.placement.width / 2);
  item.placement.y = Math.round(centerY - item.placement.height / 2);
  item.placement.scalePct = nextScalePct;
}

function centerPlacement(item) {
  const { width: mockW, height: mockH } = getImageSize(item.mockupImage);
  const area = item.placement.area || { x: 0.5, y: 0.43 };
  item.placement.x = Math.round(area.x * mockW - item.placement.width / 2);
  item.placement.y = Math.round(area.y * mockH - item.placement.height / 2);
}

function applyRotation(item, nextRotationDeg) {
  item.placement.rotationDeg = Math.round(clamp(nextRotationDeg, -45, 45));
}

function drawRotatedDesign(ctx, item) {
  if (!state.designImage || !state.designBounds) return;
  const p = item.placement;
  const b = state.designBounds;
  const centerX = p.x + p.width / 2;
  const centerY = p.y + p.height / 2;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((p.rotationDeg || 0) * Math.PI / 180);
  ctx.drawImage(state.designImage, b.x, b.y, b.width, b.height, -p.width / 2, -p.height / 2, p.width, p.height);
  ctx.restore();
}

function defaultStampPlacement(mockupImage, stampImage, role, preset = null) {
  const { width: mockW, height: mockH } = getImageSize(mockupImage);
  const { width: imgW, height: imgH } = getImageSize(stampImage);
  const saved = preset?.type === 'stbz-stamp-preset-v1' ? preset[role] : null;
  let center;
  let box;
  let rotationDeg = 0;
  if (saved) {
    center = { x: saved.center.x * mockW, y: saved.center.y * mockH };
    box = { width: saved.box.width * mockW, height: saved.box.height * mockH };
    rotationDeg = Number(saved.rotationDeg || 0);
  } else if (role === 'storeLogo') {
    box = { width: mockW * 0.18, height: mockH * 0.12 };
    center = { x: mockW - Math.round(mockW * 0.035) - box.width / 2, y: Math.round(mockH * 0.035) + box.height / 2 };
  } else {
    box = { width: mockW * 0.24, height: mockH * 0.13 };
    center = { x: Math.round(mockW * 0.035) + box.width / 2, y: mockH - Math.round(mockH * 0.035) - box.height / 2 };
  }
  const fitScale = Math.min(box.width / imgW, box.height / imgH);
  const width = Math.round(imgW * fitScale);
  const height = Math.round(imgH * fitScale);
  return { baseWidth: width, baseHeight: height, x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2), width, height, scalePct: 100, rotationDeg, role, fromPreset: Boolean(saved) };
}

function drawPlacedStamp(ctx, image, placement) {
  if (!image || !placement) return;
  const centerX = placement.x + placement.width / 2;
  const centerY = placement.y + placement.height / 2;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((placement.rotationDeg || 0) * Math.PI / 180);
  ctx.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
  ctx.restore();
}

function drawComposite(canvas, item, options = {}) {
  const { width: mockW, height: mockH } = getImageSize(item.mockupImage);
  const maxSide = options.previewMax || Math.max(mockW, mockH);
  const scale = Math.min(1, maxSide / Math.max(mockW, mockH));
  canvas.width = Math.round(mockW * scale);
  canvas.height = Math.round(mockH * scale);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.save();
  ctx.scale(scale, scale);
  ctx.drawImage(item.mockupImage, 0, 0, mockW, mockH);
  drawRotatedDesign(ctx, item);
  if (options.storeLogo || options.freeShippingLogo) {
    drawPlacedStamp(ctx, options.storeLogo, options.stampPlacements?.storeLogo);
    drawPlacedStamp(ctx, options.freeShippingLogo, options.stampPlacements?.freeShipping);
  }
  ctx.restore();
}

function selectPresetAction() {
  if (!state.mockupPresets.length) {
    showToast('No presets saved yet. Create one in the Preset bay above.');
    return;
  }
  const names = state.mockupPresets.map((p, i) => `${i + 1}. ${p.preset_name} (${p.selected_mockup_ids.length} mockups)`).join('\n');
  const answer = window.prompt(`Select a preset to apply to this batch:\n\n${names}`, '1');
  const index = Number(answer) - 1;
  const preset = state.mockupPresets[index];
  if (!preset) return;
  // Enter preset preview BEFORE applying, so the grid that applyPresetToBatch
  // redraws is already filtered to just this preset's mockups.
  state.previewMode = 'preset';
  applyPresetToBatch(preset);
  showToast(`Showing preset "${preset.preset_name}". Click "Render Mockups" to preview only these.`);
}

function previewAllAction() {
  // Clear the preset filter and return to the full mockup pool.
  state.previewMode = 'all';
  state.selected.clear();
  state.blankMockups.forEach(m => state.selected.add(m.filename));
  const design = currentDesign();
  if (design) {
    design.selectedMockups = [...state.selected];
    design.selectionType = 'manual';
    syncDesignToBatch(design);
  }
  drawGrid();
  updateProductionButtons();
  renderPresetStatus();
  showToast('Showing all mockups. Click "Render Mockups" to preview the full pool.');
}

// True only when the user has explicitly chosen "Select Preset" and that preset
// actually lists mockups. Auto-applied batch presets do not flip previewMode,
// so they never hide the pool on their own.
function isPresetPreviewActive() {
  const preset = presetById(state.batch?.activeMockupPresetId);
  return state.previewMode === 'preset'
    && Array.isArray(preset?.selected_mockup_ids)
    && preset.selected_mockup_ids.length > 0;
}

// The mockups that should be visible in the production pool/grid right now.
// In preset mode: only the mockups belonging to the active preset. Otherwise:
// the full pool. Used everywhere the production grid is drawn or rendered, so
// preset mode and all-mockups mode stay consistent.
function getVisibleMockupsForProduction() {
  if (isPresetPreviewActive()) {
    const preset = presetById(state.batch.activeMockupPresetId);
    const ids = new Set(preset.selected_mockup_ids);
    return state.blankMockups.filter(mockup => ids.has(mockup.filename));
  }
  return state.blankMockups;
}

async function renderAllBlankMockups() {
  const design = currentDesign();
  if (!design) return;
  // Rendering the full pool takes far too long — a preset is required so only
  // its mockups render. Clicking any preset card activates one.
  if (!isPresetPreviewActive()) {
    setStatus('Rendering needs a mockup preset: click a preset card in the Preset bay first.');
    showToast('Select a mockup preset first \u2014 click a preset card above.');
    return;
  }
  cancelBackgroundPreload();
  state.designImage = design.image;
  state.designBounds = design.bounds;
  design.productionStatus = 'In Progress';
  syncDesignToBatch(design);
  state.rendered = [];
  els.mockupGrid.innerHTML = '';
  const visibleMockups = getVisibleMockupsForProduction();
  const scope = isPresetPreviewActive() ? `preset "${state.batch.activeMockupPresetName || 'preset'}"` : 'all';
  setStatus(`Generating low-resolution previews for ${design.id} (${scope})...`);
  els.renderBtn.disabled = true;
  for (let index = 0; index < visibleMockups.length; index += 1) {
    const mockup = visibleMockups[index];
    const mockupImage = await loadImage(mockup.url);
    const placement = defaultPlacement(mockupImage, state.designBounds, mockup.placement);
    state.rendered.push({ mockup, mockupImage, placement });
    if (index % 8 === 0) setStatus(`Generated ${index + 1} of ${visibleMockups.length} previews...`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  state.previewCache.set(design.id, state.rendered);
  drawGrid();
  updateProductionButtons();
  queuePersistBatch();
  setStatus(`${design.id}: ${state.rendered.length} preview${state.rendered.length === 1 ? '' : 's'} ready. Select the mockups you want to export.`);
  preloadRemainingDesignPreviews();
}

// After a render, warm the preview cache for every other design in the
// background (each with its own preset) so switching designs is instant.
// One design at a time, yielding to the event loop; a new foreground render
// cancels the run and restarts it when done.
let backgroundPreloadRun = 0;
function cancelBackgroundPreload() { backgroundPreloadRun += 1; }

async function preloadRemainingDesignPreviews() {
  const runId = ++backgroundPreloadRun;
  const activeDesignId = currentDesign()?.id;
  for (const design of state.uploadedDesigns) {
    if (runId !== backgroundPreloadRun) return;
    if (design.id === activeDesignId || state.previewCache.has(design.id)) continue;
    const preset = presetById(design.mockupPresetId) || presetById(state.batch?.activeMockupPresetId);
    if (!preset?.selected_mockup_ids?.length) continue;
    const ids = new Set(preset.selected_mockup_ids);
    const mockups = state.blankMockups.filter(mockup => ids.has(mockup.filename));
    const rendered = [];
    for (const mockup of mockups) {
      if (runId !== backgroundPreloadRun) return;
      try {
        const mockupImage = await loadImage(mockup.url);
        rendered.push({ mockup, mockupImage, placement: defaultPlacement(mockupImage, design.bounds, mockup.placement) });
      } catch { /* one bad mockup never blocks the preload of the rest */ }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (runId !== backgroundPreloadRun) return;
    if (rendered.length) state.previewCache.set(design.id, rendered);
  }
}

function drawGrid() {
  els.mockupGrid.innerHTML = '';
  // While a preset is being previewed, only its mockups appear in the grid.
  // We still iterate state.rendered with its true index so card actions
  // (edit/download/update) keep pointing at the right rendered entry.
  const visibleFilenames = new Set(getVisibleMockupsForProduction().map(mockup => mockup.filename));
  state.rendered.forEach((item, index) => {
    if (!visibleFilenames.has(item.mockup.filename)) return;
    const node = els.cardTemplate.content.cloneNode(true);
    const card = node.querySelector('.mockup-card');
    card.dataset.renderedIndex = String(index);
    const canvas = node.querySelector('.mockup-canvas');
    const name = node.querySelector('.mockup-name');
    const meta = node.querySelector('.mockup-meta');
    const editBtn = node.querySelector('.edit-btn');
    const downloadBtn = node.querySelector('.download-btn');
    const checkbox = node.querySelector('.mockup-select');
    const favoriteBtn = node.querySelector('.favorite-btn');
    const selected = state.selected.has(item.mockup.filename);
    const presetSelected = isMockupFromActivePreset(item.mockup.filename);
    name.textContent = item.mockup.name;
    meta.textContent = `${item.mockupImage.width}×${item.mockupImage.height}${item.placement.fromPreset ? ' • placement preset' : ' • auto-fit'}${presetSelected ? ' • preset-selected' : ''}`;
    checkbox.checked = selected;
    card.classList.toggle('selected', selected);
    card.classList.toggle('preset-selected', presetSelected);
    favoriteBtn.textContent = selected ? '★' : '☆';
    favoriteBtn.classList.toggle('active', selected);
    drawComposite(canvas, item, { previewMax: 720 });
    checkbox.addEventListener('change', () => toggleSelected(item.mockup.filename, checkbox.checked));
    favoriteBtn.addEventListener('click', () => toggleSelected(item.mockup.filename, !state.selected.has(item.mockup.filename)));
    editBtn.addEventListener('click', () => openEditor(index));
    downloadBtn.addEventListener('click', () => downloadRendered(index));
    els.mockupGrid.appendChild(node);
  });
}

function updateRenderedCard(index) {
  const item = state.rendered[index];
  // Grid position no longer equals rendered index when a preset filter hides
  // cards, so look the card up by its stored rendered index.
  const card = els.mockupGrid.querySelector(`[data-rendered-index="${index}"]`);
  if (!item || !card) return drawGrid();
  const canvas = card.querySelector('.mockup-canvas');
  const checkbox = card.querySelector('.mockup-select');
  const favoriteBtn = card.querySelector('.favorite-btn');
  checkbox.checked = state.selected.has(item.mockup.filename);
  card.classList.toggle('selected', checkbox.checked);
  if (favoriteBtn) {
    favoriteBtn.textContent = checkbox.checked ? '★' : '☆';
    favoriteBtn.classList.toggle('active', checkbox.checked);
  }
  drawComposite(canvas, item, { previewMax: 720 });
}

function toggleSelected(filename, isSelected) {
  if (isSelected) state.selected.add(filename);
  else state.selected.delete(filename);
  const design = currentDesign();
  if (design) {
    design.selectedMockups = [...state.selected];
    if (state.batch?.activeMockupPresetId) {
      design.selectionType = 'custom';
      design.mockupPresetId = null;
      design.mockupPresetName = 'Custom selection';
    }
    syncDesignToBatch(design);
    queuePersistBatch();
  }
  updateProductionButtons();
  renderPresetStatus();
  drawGrid();
}

function isMockupFromActivePreset(filename) {
  const design = currentDesign();
  const preset = presetById(design?.mockupPresetId) || presetById(state.batch?.activeMockupPresetId);
  return Boolean(preset?.selected_mockup_ids?.includes(filename));
}

function selectedItems() {
  return state.rendered.filter(item => state.selected.has(item.mockup.filename));
}

function updateProductionButtons() {
  const design = currentDesign();
  const rendered = state.rendered.length > 0;
  const selected = state.selected.size;
  // Primary bar
  if (els.selectPresetBtn) els.selectPresetBtn.disabled = !design || !state.blankMockups.length;
  if (els.previewAllBtn) els.previewAllBtn.disabled = !design || !state.blankMockups.length;
  els.renderBtn.disabled = !design || !state.blankMockups.length;
  els.clearAllBtn.disabled = !rendered || !selected;
  // Hidden legacy buttons still maintained
  if (els.selectAllBtn) els.selectAllBtn.disabled = !rendered;
  if (els.copyPreviousBtn) els.copyPreviousBtn.disabled = !design || state.currentProductionIndex === 0;
  if (els.saveSelectionPresetBtn) els.saveSelectionPresetBtn.disabled = selected === 0;
  if (els.revertPresetBtn) els.revertPresetBtn.disabled = !design || design.selectionType !== 'custom' || !state.batch?.activeMockupPresetId;
  if (els.markReadyBtn) els.markReadyBtn.disabled = selected < (state.settings.minimumSelectedMockups || 1);
  const allHaveMockups = state.uploadedDesigns.length > 0 &&
    state.uploadedDesigns.every(d => (d.selectedMockups?.length || 0) > 0);
  [els.moveToStampingBtn, els.moveToStampingTopBtn].forEach(btn => {
    if (btn) btn.disabled = !allHaveMockups;
  });
}

function selectAllMockups() {
  state.rendered.forEach(item => state.selected.add(item.mockup.filename));
  const design = currentDesign();
  if (design) {
    design.selectedMockups = [...state.selected];
    design.selectionType = state.batch?.activeMockupPresetId ? 'custom' : 'manual';
    syncDesignToBatch(design);
  }
  drawGrid();
  updateProductionButtons();
  queuePersistBatch();
}

function clearSelection() {
  state.selected.clear();
  const design = currentDesign();
  if (design) {
    design.selectedMockups = [];
    design.selectionType = state.batch?.activeMockupPresetId ? 'custom' : 'manual';
    syncDesignToBatch(design);
  }
  drawGrid();
  updateProductionButtons();
  queuePersistBatch();
}

function copyPreviousSelection() {
  const previous = state.uploadedDesigns[state.currentProductionIndex - 1];
  if (!previous) return;
  state.selected = new Set(previous.selectedMockups || []);
  const design = currentDesign();
  design.selectedMockups = [...state.selected];
  design.selectionType = state.batch?.activeMockupPresetId ? 'custom' : 'manual';
  syncDesignToBatch(design);
  drawGrid();
  updateProductionButtons();
  queuePersistBatch();
}

function renderPresetStatus() {
  const active = presetById(state.batch?.activeMockupPresetId);
  const design = currentDesign();
  els.activePresetName.textContent = active?.preset_name || 'None';
  if (isPresetPreviewActive()) {
    const count = getVisibleMockupsForProduction().length;
    els.presetSelectionStatus.textContent =
      `Showing preset: ${active.preset_name} — ${count} mockup${count === 1 ? '' : 's'}. Click "Preview All Mockups" to show every mockup.`;
    return;
  }
  els.presetSelectionStatus.textContent = design?.selectionType === 'custom'
    ? `${design.id} uses a custom selection.`
    : active
      ? `${active.preset_name} is applied to this batch.`
      : 'Choose manually or apply a favorite preset.';
}

function applyPresetToDesign(preset, design = currentDesign(), selectionType = 'preset') {
  if (!preset || !design) return { applied: 0, missing: 0 };
  const available = availableMockupIds(preset.selected_mockup_ids);
  const missing = (preset.selected_mockup_ids || []).length - available.length;
  design.selectedMockups = available;
  design.selectionType = selectionType;
  design.mockupPresetId = preset.preset_id;
  design.mockupPresetName = preset.preset_name;
  // The design inherits the preset's variation profile (front/double-sided).
  design.variationProfile = presetDesignType(preset);
  syncDesignToBatch(design);
  if (design.id === currentDesign()?.id) {
    state.selected = new Set(available);
    drawGrid();
    updateProductionButtons();
    renderPresetStatus();
  }
  if (missing > 0) showToast(`Preset "${preset.preset_name}" skipped ${missing} missing mockup${missing === 1 ? '' : 's'}.`);
  return { applied: available.length, missing };
}

// A design's variation profile is chosen on its mockup preset and travels
// through the manifest to Batchly. Stable keys match the hub profile registry;
// display labels are for the UI only. front_sided is the default so existing
// presets/designs (no design_type) keep behaving exactly as before.
const VARIATION_PROFILES = [
  { key: 'front_sided', label: 'Front-sided' },
  { key: 'double_sided', label: 'Double-sided' },
];
const DEFAULT_VARIATION_PROFILE = 'front_sided';
function presetDesignType(preset) {
  const key = preset?.design_type;
  return VARIATION_PROFILES.some(p => p.key === key) ? key : DEFAULT_VARIATION_PROFILE;
}
function variationProfileLabel(key) {
  return (VARIATION_PROFILES.find(p => p.key === key) || VARIATION_PROFILES[0]).label;
}

function applyPresetToBatch(preset, showMessage = true) {
  if (!state.batch || !preset) return;
  // Rendering is preset-scoped: applying a preset always enters preset
  // preview, so Render Mockups only ever renders this preset's mockups.
  state.previewMode = 'preset';
  state.batch.activeMockupPresetId = preset.preset_id;
  state.batch.activeMockupPresetName = preset.preset_name;
  state.batch.appliedMockupPresetToBatch = true;
  state.batch.perDesignOverrides = {};
  state.uploadedDesigns.forEach(design => applyPresetToDesign(preset, design, 'batch_preset'));
  persistBatchNow();
  renderProduction();
  if (showMessage) showToast(`Applied ${preset.preset_name} to the batch.`);
}

function applyPresetToRemaining(preset) {
  if (!state.batch || !preset) return;
  state.batch.activeMockupPresetId = preset.preset_id;
  state.batch.activeMockupPresetName = preset.preset_name;
  state.batch.appliedMockupPresetToBatch = true;
  state.uploadedDesigns.slice(state.currentProductionIndex).forEach(design => applyPresetToDesign(preset, design, 'batch_preset'));
  persistBatchNow();
  renderProduction();
  showToast(`Applied ${preset.preset_name} to remaining designs.`);
}

function choosePreset() {
  if (!state.mockupPresets.length) {
    showToast('No favorite mockup presets saved yet.');
    return null;
  }
  const names = state.mockupPresets.map((preset, index) => `${index + 1}. ${preset.preset_name}`).join('\n');
  const answer = window.prompt(`Choose a preset number:\n${names}`, '1');
  const index = Number(answer) - 1;
  return state.mockupPresets[index] || null;
}

function saveCurrentSelectionAsPreset() {
  if (!state.selected.size) return showToast('Select mockups before saving a preset.');
  const name = window.prompt('Preset name', `Mockup Set ${state.mockupPresets.length + 1}`);
  if (!name) return;
  const now = new Date().toISOString();
  state.mockupPresets.push({
    preset_id: cleanName(name) || `preset-${Date.now()}`,
    preset_name: name.trim(),
    selected_mockup_ids: [...state.selected],
    is_default: state.mockupPresets.length === 0,
    design_type: DEFAULT_VARIATION_PROFILE,
    created_at: now,
    updated_at: now,
    notes: ''
  });
  persistMockupPresets();
  showToast('Favorite mockup preset saved.');
}

function applyPresetToCurrentDesign() {
  const preset = choosePreset();
  if (!preset) return;
  applyPresetToDesign(preset, currentDesign(), 'preset');
  persistBatchNow();
  showToast(`Applied ${preset.preset_name} to ${currentDesign().id}.`);
}

function applyChosenPresetToBatch() {
  const preset = choosePreset();
  if (preset) applyPresetToBatch(preset);
}

function applyChosenPresetToRemaining() {
  const preset = choosePreset();
  if (preset) applyPresetToRemaining(preset);
}

function revertCurrentDesignToBatchPreset() {
  const preset = presetById(state.batch?.activeMockupPresetId);
  if (!preset) return;
  applyPresetToDesign(preset, currentDesign(), 'batch_preset');
  persistBatchNow();
  showToast(`${currentDesign().id} reverted to batch preset.`);
}


function markDesignReady() {
  const design = currentDesign();
  if (!design) return;
  const skus = state.batch?.reservedSkus?.[design.id] || {};
  design.productionStatus = 'Ready';
  design.selectedMockups = [...state.selected];
  design.finalImageFiles = Object.values(skus).flatMap(entry => design.selectedMockups.map((_, index) => `${entry.sku}_${index + 1}.jpg`));
  syncDesignToBatch(design);
  if (state.batch) {
    const allReady = state.uploadedDesigns.every(item => item.productionStatus === 'Ready');
    state.batch.status = allReady ? 'Ready To Export' : 'Production In Progress';
  }
  persistBatchNow();
  renderProduction();
  if (state.currentProductionIndex < state.uploadedDesigns.length - 1) {
    state.currentProductionIndex += 1;
    renderProduction();
    showToast(`${design.id} marked ready. Moving to next design.`);
  } else {
    const allReady = state.uploadedDesigns.every(d => d.productionStatus === 'Ready');
    showToast(allReady ? 'All designs ready. Click "Move Batch to Stamping Phase" when done.' : `${design.id} marked ready.`);
  }
}

function syncEditorControls(item) {
  els.scaleRange.value = String(item.placement.scalePct);
  els.scaleValue.textContent = `${item.placement.scalePct}%`;
  els.rotationValue.textContent = `${item.placement.rotationDeg || 0}°`;
}

function getEditingItem() {
  return state.editingIndex === null ? null : state.rendered[state.editingIndex] || null;
}

function drawEditor() {
  drawUnifiedEditor();
}

function setActiveEditorLayer(layer) {
  state.editorActiveLayer = layer;
  const isDesign = layer === 'design';
  if (els.editorDesignControls) els.editorDesignControls.style.display = isDesign ? '' : 'none';
  if (els.editorLogoControls) els.editorLogoControls.style.display = isDesign ? 'none' : '';
  if (els.layerDesignBtn) {
    els.layerDesignBtn.classList.toggle('active', layer === 'design');
    els.layerDesignBtn.setAttribute('aria-pressed', String(layer === 'design'));
    els.layerStoreLogoBtn.classList.toggle('active', layer === 'storeLogo');
    els.layerStoreLogoBtn.setAttribute('aria-pressed', String(layer === 'storeLogo'));
    els.layerShippingBtn.classList.toggle('active', layer === 'freeShipping');
    els.layerShippingBtn.setAttribute('aria-pressed', String(layer === 'freeShipping'));
  }
  if (!isDesign) {
    state.activeStampTarget = layer;
    syncStampEditorControls();
  } else {
    const item = getEditingItem();
    if (item) syncEditorControls(item);
  }
  drawUnifiedEditor();
}

function getUnifiedActivePlacement() {
  if (state.editorActiveLayer === 'design') {
    return getEditingItem()?.placement || null;
  }
  return state.calibrationEntry?.stampPlacements?.[state.editorActiveLayer] || null;
}

function drawUnifiedEditor() {
  const item = getEditingItem();
  if (!item) return;
  const entry = state.calibrationEntry;
  const canvas = els.editorCanvas;
  // Draw composite: mockup + design + both logos
  drawComposite(canvas, item, {
    storeLogo: entry?.storeLogoImage || null,
    freeShippingLogo: entry?.freeShippingImage || null,
    stampPlacements: entry?.stampPlacements || null
  });
  const ctx = canvas.getContext('2d');
  // Draw subtle inactive outlines for all layers
  if (entry) {
    if (state.editorActiveLayer !== 'storeLogo' && entry.stampPlacements?.storeLogo) {
      drawInactiveOverlayBorder(ctx, entry.stampPlacements.storeLogo);
    }
    if (state.editorActiveLayer !== 'freeShipping' && entry.stampPlacements?.freeShipping) {
      drawInactiveOverlayBorder(ctx, entry.stampPlacements.freeShipping);
    }
  }
  if (state.editorActiveLayer !== 'design' && item.placement) {
    drawInactiveOverlayBorder(ctx, item.placement);
  }
  // Draw active handles
  const activePlacement = getUnifiedActivePlacement();
  if (activePlacement) drawActiveStampOverlay(ctx, activePlacement);
}

function drawInactiveOverlayBorder(ctx, placement) {
  const center = getPlacementCenter(placement);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(((placement.rotationDeg || 0) * Math.PI) / 180);
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.strokeRect(-placement.width / 2, -placement.height / 2, placement.width, placement.height);
  ctx.restore();
}

function unifiedCanvasPoint(event) {
  const canvas = els.editorCanvas;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function hitTestLayer(point, placement) {
  if (!placement) return null;
  for (const handle of getPlacementHandlePoints(placement)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 24) return { mode: 'resize' };
  }
  const local = worldToPlacementLocal(point, placement);
  if (Math.abs(local.x) <= placement.width / 2 && Math.abs(local.y) <= placement.height / 2) return { mode: 'move' };
  return null;
}

function startUnifiedPointerInteraction(event) {
  const point = unifiedCanvasPoint(event);
  const item = getEditingItem();
  if (!item) return;
  const entry = state.calibrationEntry;
  // Priority: check active layer first, then others
  const layers = [
    { name: 'design', placement: item.placement },
    { name: 'storeLogo', placement: entry?.stampPlacements?.storeLogo },
    { name: 'freeShipping', placement: entry?.stampPlacements?.freeShipping }
  ];
  // First check active layer, then others
  const ordered = [
    layers.find(l => l.name === state.editorActiveLayer),
    ...layers.filter(l => l.name !== state.editorActiveLayer)
  ].filter(Boolean);
  for (const layer of ordered) {
    if (!layer.placement) continue;
    const hit = hitTestLayer(point, layer.placement);
    if (hit) {
      if (layer.name !== state.editorActiveLayer) setActiveEditorLayer(layer.name);
      event.preventDefault();
      const local = worldToPlacementLocal(point, layer.placement);
      state.editorInteraction = {
        pointerId: event.pointerId,
        mode: hit.mode,
        startPoint: point,
        startPlacement: { ...layer.placement },
        startDistance: Math.max(1, Math.hypot(local.x, local.y))
      };
      els.editorCanvas.setPointerCapture?.(event.pointerId);
      return;
    }
  }
}

function moveUnifiedPointerInteraction(event) {
  if (!state.editorInteraction) return;
  const point = unifiedCanvasPoint(event);
  const interaction = state.editorInteraction;
  const placement = getUnifiedActivePlacement();
  if (!placement) return;
  if (interaction.mode === 'move') {
    placement.x = Math.round(interaction.startPlacement.x + (point.x - interaction.startPoint.x));
    placement.y = Math.round(interaction.startPlacement.y + (point.y - interaction.startPoint.y));
  } else {
    const currentLocal = worldToPlacementLocal(point, interaction.startPlacement);
    const distance = Math.max(1, Math.hypot(currentLocal.x, currentLocal.y));
    const nextScale = clamp(interaction.startPlacement.scalePct * (distance / interaction.startDistance), 35, 220);
    const centerX = interaction.startPlacement.x + interaction.startPlacement.width / 2;
    const centerY = interaction.startPlacement.y + interaction.startPlacement.height / 2;
    placement.width = Math.round(placement.baseWidth * (nextScale / 100));
    placement.height = Math.round(placement.baseHeight * (nextScale / 100));
    placement.x = Math.round(centerX - placement.width / 2);
    placement.y = Math.round(centerY - placement.height / 2);
    placement.scalePct = nextScale;
    if (state.editorActiveLayer === 'design') syncEditorControls(getEditingItem());
    else syncStampEditorControls();
  }
  drawUnifiedEditor();
}

function endUnifiedPointerInteraction() {
  state.editorInteraction = null;
}

function switchEditorTab(tab) {
  // Legacy: map to unified layer activation
  setActiveEditorLayer(tab === 'calibration' ? 'storeLogo' : 'design');
}

function openEditor(index, tab = 'placement') {
  state.editingIndex = index;
  const item = state.rendered[index];
  if (!item) return;
  els.editorTitle.textContent = item.mockup.name;
  // Always start loading calibration for unified editor
  const initialLayer = tab === 'calibration' ? 'storeLogo' : 'design';
  state.editorActiveLayer = initialLayer;
  // Show dialog immediately; calibration loads async
  els.editDialog.showModal();
  syncEditorControls(item);
  // Start with design layer visible, then load logos
  setActiveEditorLayer(initialLayer);
  drawUnifiedEditor();
  // Load calibration async (won't block opening)
  openCalibrationTab(item).then(() => {
    if (state.editingIndex === index) drawUnifiedEditor();
  });
}

function closeEditor() {
  state.editingIndex = null;
  state.calibrationEntry = null;
  state.stampInteraction = null;
  els.editDialog.close();
}

async function openCalibrationTab(item) {
  const northWindStore = state.stores.find(s => s.store_folder === 'Store_A');
  const storeLogoUrl = northWindStore?.logoUrl;
  const freeShippingUrl = state.freeShipping?.url;
  let storeLogoImage = null;
  let freeShippingImage = null;
  try {
    if (storeLogoUrl) storeLogoImage = await loadImage(storeLogoUrl);
    if (freeShippingUrl) freeShippingImage = await loadImage(freeShippingUrl);
  } catch (err) {
    showToast('Could not load logo images for calibration preview.');
  }
  state.calibrationEntry = {
    item,
    storeLogoImage,
    freeShippingImage,
    stampPlacements: {
      storeLogo: storeLogoImage
        ? defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement)
        : null,
      freeShipping: freeShippingImage
        ? defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
        : null
    }
  };
  state.activeStampTarget = 'storeLogo';
  syncStampEditorControls();
  drawStampEditor();
}

function nudgeCurrent(direction, amount = 4) {
  const item = getEditingItem();
  if (!item) return;
  if (direction === 'up') item.placement.y -= amount;
  if (direction === 'down') item.placement.y += amount;
  if (direction === 'left') item.placement.x -= amount;
  if (direction === 'right') item.placement.x += amount;
  if (direction === 'center') centerPlacement(item);
  drawEditor();
}

function resizeCurrent(delta) {
  const item = getEditingItem();
  if (!item) return;
  applyScale(item, clamp(item.placement.scalePct + delta, 45, 180));
  syncEditorControls(item);
  drawEditor();
}

function rotateCurrent(delta) {
  const item = getEditingItem();
  if (!item) return;
  applyRotation(item, (item.placement.rotationDeg || 0) + delta);
  syncEditorControls(item);
  drawEditor();
}

function presetFromItem(item) {
  const { width: mockW, height: mockH } = getImageSize(item.mockupImage);
  return {
    type: 'stbz-preset-v3',
    mode: 'blank-mockup-visible-artwork',
    center: { x: (item.placement.x + item.placement.width / 2) / mockW, y: (item.placement.y + item.placement.height / 2) / mockH },
    box: { width: item.placement.width / mockW, height: item.placement.height / mockH },
    rotationDeg: item.placement.rotationDeg || 0
  };
}

async function savePresetCurrent() {
  const item = getEditingItem();
  if (!item) return;
  const response = await fetch('/api/presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: item.mockup.filename, preset: presetFromItem(item) })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return showToast(data.error || 'Preset could not be saved.');
  item.mockup.placement = data.preset;
  item.placement.fromPreset = true;
  showToast('Placement preset saved.');
  flashButton(els.savePresetBtn);
}

async function downloadRendered(index) {
  const item = state.rendered[index];
  if (!item) return;
  const canvas = document.createElement('canvas');
  drawComposite(canvas, item);
  downloadBlob(await canvasToBlob(canvas), `${currentDesign().id}-${cleanName(item.mockup.name)}.png`);
}

function getStampEditingEntry() {
  return state.calibrationEntry || null;
}

function getActiveStampPlacement() {
  // Route through unified layer when in unified editor
  const layer = state.editorActiveLayer;
  if (layer === 'storeLogo' || layer === 'freeShipping') {
    return getStampEditingEntry()?.stampPlacements?.[layer] || null;
  }
  return getStampEditingEntry()?.stampPlacements?.[state.activeStampTarget] || null;
}

function syncStampTargetButtons() {
  if (els.editStoreLogoBtn) els.editStoreLogoBtn.classList.toggle('active', state.activeStampTarget === 'storeLogo');
  if (els.editFreeShippingBtn) els.editFreeShippingBtn.classList.toggle('active', state.activeStampTarget === 'freeShipping');
}

function syncStampEditorControls() {
  const placement = getActiveStampPlacement();
  if (!placement) return;
  els.stampScaleRange.value = String(placement.scalePct || 100);
  els.stampScaleValue.textContent = `${placement.scalePct || 100}%`;
  els.stampRotationValue.textContent = `${placement.rotationDeg || 0}°`;
  syncStampTargetButtons();
}

function stampCanvasPoint(event) {
  const canvas = els.stampEditorCanvas;
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height)
  };
}

function getPlacementCenter(placement) {
  return { x: placement.x + placement.width / 2, y: placement.y + placement.height / 2 };
}

function worldToPlacementLocal(point, placementLike) {
  const center = getPlacementCenter(placementLike);
  const angle = ((placementLike.rotationDeg || 0) * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: dx * Math.cos(angle) + dy * Math.sin(angle), y: -dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function getPlacementHandlePoints(placement) {
  const center = getPlacementCenter(placement);
  const angle = ((placement.rotationDeg || 0) * Math.PI) / 180;
  return [
    { x: -placement.width / 2, y: -placement.height / 2 },
    { x: placement.width / 2, y: -placement.height / 2 },
    { x: placement.width / 2, y: placement.height / 2 },
    { x: -placement.width / 2, y: placement.height / 2 }
  ].map(corner => ({
    x: center.x + corner.x * Math.cos(angle) - corner.y * Math.sin(angle),
    y: center.y + corner.x * Math.sin(angle) + corner.y * Math.cos(angle)
  }));
}

function drawActiveStampOverlay(ctx, placement) {
  if (!placement) return;
  const center = getPlacementCenter(placement);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(((placement.rotationDeg || 0) * Math.PI) / 180);
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeRect(-placement.width / 2, -placement.height / 2, placement.width, placement.height);
  ctx.restore();
  getPlacementHandlePoints(placement).forEach(handle => {
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,22,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function hitTestActiveStamp(point) {
  const placement = getActiveStampPlacement();
  if (!placement) return null;
  for (const handle of getPlacementHandlePoints(placement)) {
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= 24) return { mode: 'resize' };
  }
  const local = worldToPlacementLocal(point, placement);
  if (Math.abs(local.x) <= placement.width / 2 && Math.abs(local.y) <= placement.height / 2) return { mode: 'move' };
  return null;
}

function drawStampEditor() {
  // Now routes to unified editor
  drawUnifiedEditor();
}

function openStampEditor(renderIndex) {
  openEditor(renderIndex, 'calibration');
}

function closeStampEditor() {
  closeEditor();
}

function setActiveStampTarget(target) {
  state.activeStampTarget = target;
  syncStampEditorControls();
  drawStampEditor();
}

function applyStampScale(placement, nextScalePct) {
  const centerX = placement.x + placement.width / 2;
  const centerY = placement.y + placement.height / 2;
  placement.width = Math.round(placement.baseWidth * (nextScalePct / 100));
  placement.height = Math.round(placement.baseHeight * (nextScalePct / 100));
  placement.x = Math.round(centerX - placement.width / 2);
  placement.y = Math.round(centerY - placement.height / 2);
  placement.scalePct = nextScalePct;
}

function resizeActiveStamp(delta) {
  const placement = getActiveStampPlacement();
  if (!placement) return;
  applyStampScale(placement, clamp((placement.scalePct || 100) + delta, 35, 220));
  syncStampEditorControls();
  drawStampEditor();
}

function rotateActiveStamp(delta) {
  const placement = getActiveStampPlacement();
  if (!placement) return;
  placement.rotationDeg = Math.round(clamp((placement.rotationDeg || 0) + delta, -180, 180));
  syncStampEditorControls();
  drawStampEditor();
}

function nudgeActiveStamp(direction, amount = 4) {
  const placement = getActiveStampPlacement();
  if (!placement) return;
  if (direction === 'up') placement.y -= amount;
  if (direction === 'down') placement.y += amount;
  if (direction === 'left') placement.x -= amount;
  if (direction === 'right') placement.x += amount;
  drawStampEditor();
}

function startStampPointerInteraction(event) {
  const placement = getActiveStampPlacement();
  const hit = placement ? hitTestActiveStamp(stampCanvasPoint(event)) : null;
  if (!hit) return;
  event.preventDefault();
  const startPoint = stampCanvasPoint(event);
  const local = worldToPlacementLocal(startPoint, placement);
  state.stampInteraction = { pointerId: event.pointerId, mode: hit.mode, startPoint, startPlacement: { ...placement }, startDistance: Math.max(1, Math.hypot(local.x, local.y)) };
  els.stampEditorCanvas.setPointerCapture?.(event.pointerId);
}

function moveStampPointerInteraction(event) {
  if (!state.stampInteraction) return;
  const placement = getActiveStampPlacement();
  const point = stampCanvasPoint(event);
  const interaction = state.stampInteraction;
  if (interaction.mode === 'move') {
    placement.x = Math.round(interaction.startPlacement.x + (point.x - interaction.startPoint.x));
    placement.y = Math.round(interaction.startPlacement.y + (point.y - interaction.startPoint.y));
  } else {
    const currentLocal = worldToPlacementLocal(point, interaction.startPlacement);
    const distance = Math.max(1, Math.hypot(currentLocal.x, currentLocal.y));
    const nextScale = clamp(interaction.startPlacement.scalePct * (distance / interaction.startDistance), 35, 220);
    const centerX = interaction.startPlacement.x + interaction.startPlacement.width / 2;
    const centerY = interaction.startPlacement.y + interaction.startPlacement.height / 2;
    placement.width = Math.round(placement.baseWidth * (nextScale / 100));
    placement.height = Math.round(placement.baseHeight * (nextScale / 100));
    placement.x = Math.round(centerX - placement.width / 2);
    placement.y = Math.round(centerY - placement.height / 2);
    placement.scalePct = nextScale;
    syncStampEditorControls();
  }
  drawStampEditor();
}

function endStampPointerInteraction() {
  state.stampInteraction = null;
}

function normalizeStampPlacementForSave(entry, placement) {
  const { width: mockW, height: mockH } = getImageSize(entry.item.mockupImage);
  return {
    center: { x: (placement.x + placement.width / 2) / mockW, y: (placement.y + placement.height / 2) / mockH },
    box: { width: placement.width / mockW, height: placement.height / mockH },
    rotationDeg: placement.rotationDeg || 0
  };
}

async function saveStampPresetCurrent() {
  const entry = getStampEditingEntry();
  if (!entry) return;
  const preset = {
    type: 'stbz-stamp-preset-v1',
    mode: 'logo-and-free-shipping-stamps',
    storeLogo: normalizeStampPlacementForSave(entry, entry.stampPlacements.storeLogo),
    freeShipping: normalizeStampPlacementForSave(entry, entry.stampPlacements.freeShipping)
  };
  const response = await fetch('/api/stamp-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: entry.item.mockup.filename, preset })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) return showToast(data.error || 'Stamp preset could not be saved.');
  entry.item.mockup.stampPlacement = data.preset;
  showToast('Logo placement preset saved.');
  flashButton(els.saveStampPresetBtn);
}


// Every ACTIVE store must be fully export-ready before any Drive write or ZIP
// build: a Batchly folder (Store_A–H), a store logo (needed to stamp the
// mockups), and a reserved SKU for every design being exported. A misconfigured
// active store must BLOCK the export with an exact reason — it must never be
// silently skipped while its manifest rows are still written, which produced a
// manifest/ZIP mismatch that Batchly rejects. Inactive stores are excluded
// entirely because this only walks activeStores().
function activeStoreExportErrors() {
  const errors = [];
  const designs = state.uploadedDesigns || [];
  for (const store of activeStores()) {
    if (!store.store_folder) {
      errors.push(`${store.name}: no Batchly folder (Store_A–H) assigned. Set it in Store Settings before exporting.`);
    }
    if (!store.logoUrl) {
      errors.push(`${store.name}: no store logo. A logo is required to stamp mockups for this store.`);
    }
    for (const design of designs) {
      const sku = state.batch?.reservedSkus?.[design.id]?.[store.id]?.sku;
      if (!sku) {
        errors.push(`${store.name}: no reserved SKU for ${design.id}. Use Refresh SKU Reservation before exporting.`);
      }
    }
  }
  return errors;
}

function validateExport() {
  const errors = [];
  const warnings = [];
  if (!state.batch) errors.push('No active batch.');
  if (!activeStores().length) errors.push('No active stores.');
  activeStores().forEach(store => {
    if (!store.skuRootFolderId) errors.push(`${store.name} needs a Google Drive SKU root folder ID.`);
  });
  if (!state.freeShipping?.url) warnings.push('Shipping logo is missing.');
  state.uploadedDesigns.forEach(design => {
    if (!design.intakeComplete) errors.push(`${design.id} intake is incomplete.`);
    if (!design.selectedMockups?.length) errors.push(`${design.id} has no selected mockups.`);
    else if (!isDesignExportReady(design)) errors.push(`${design.id} is not stamped for all active stores yet.`);
  });
  // Hard store/logo/SKU contract — blocks export before Drive writes and ZIP.
  activeStoreExportErrors().forEach(error => errors.push(error));
  return { errors, warnings };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function storeLetterMap() {
  const map = new Map();
  activeStores().forEach(store => {
    if (store.store_folder) map.set(store.id, store.store_folder);
  });
  return map;
}

function manifestRows() {
  const rows = [];
  const letterMap = storeLetterMap();
  const defaultPrice = Number(state.settings?.defaultListingPrice) || 19.99;
  for (const design of state.uploadedDesigns) {
    const skus = state.batch?.reservedSkus?.[design.id] || {};
    for (const store of activeStores()) {
      const skuEntry = skus[store.id];
      const storeFolder = letterMap.get(store.id);
      // Emit a row only for a fully-configured (store × design) pair. A row is
      // never written without a real SKU and a real store_folder — validateExport()
      // blocks the export before this point if either is missing, so this keeps
      // the manifest identical to the ZIP image folders below.
      if (!skuEntry || !storeFolder) continue;
      const tags = (design.keywords || '').split('|').map(t => t.trim()).filter(Boolean).join(',');
      rows.push({
        store_folder: storeFolder,
        design_id: design.id,
        sku: skuEntry.sku,
        title: design.title,
        description: design.description,
        tags,
        price: defaultPrice,
        product_type: 'PHYSICAL',
        // Resilient to reload: prefer the design's own profile, else derive it
        // from its active mockup preset, else the front_sided default.
        variation_profile: design.variationProfile
          || presetDesignType(presetById(design.mockupPresetId))
      });
    }
  }
  return rows;
}

function generateManifestCsv() {
  const rows = manifestRows();
  const columns = ['store_folder', 'design_id', 'sku', 'title', 'description', 'tags', 'price', 'product_type', 'variation_profile'];
  return [columns.join(','), ...rows.map(row => columns.map(col => csvCell(row[col])).join(','))].join('\n');
}

function moveToStampingPhase() {
  if (!state.batch) return showToast('No active batch.');
  const missing = state.uploadedDesigns.filter(d => !(d.selectedMockups?.length));
  if (missing.length) {
    showToast(`Select mockups for: ${missing.map(d => d.id).join(', ')}`);
    return;
  }
  state.batch.workflowStage = 'stamping';
  state.batch.movedToStampingAt = new Date().toISOString();
  persistBatchNow();
  markWorkflowStep('mockup');
  showToast('Batch sent to Stamp tab. Apply logos when ready.');
  switchPage('stamp');
}

function renderStampProgress(status, warnings = 0) {
  if (!els.stampProgressPanel || !els.stampProgressGrid) return;
  const stores = activeStores();
  const designs = state.uploadedDesigns;
  const stampStatus = state.batch?.stampStatus || {};
  let totalMockups = 0;
  let completedMockups = 0;
  designs.forEach(d => {
    const count = (d.selectedMockups || []).length;
    totalMockups += count * stores.length;
    stores.forEach(s => {
      const st = stampStatus[s.id]?.[d.id];
      if (st === 'complete' || st === 'warning') completedMockups += count;
    });
  });
  const statusLabel = {
    'not-started': 'Not Started',
    'stamping': 'Stamping…',
    'complete': warnings ? `Complete (${warnings} warning${warnings !== 1 ? 's' : ''})` : 'Complete',
    'error': 'Error'
  }[status] || status;
  const statusClass = status === 'complete' ? (warnings ? 'metric-warn' : 'metric-good') : status === 'error' ? 'metric-bad' : '';
  els.stampProgressGrid.innerHTML = `
    <div class="metric-card ${statusClass}">
      <strong>${statusLabel}</strong><span>stamp status</span>
    </div>
    <div class="metric-card">
      <strong>${stores.length}</strong><span>active stores</span>
    </div>
    <div class="metric-card">
      <strong>${designs.length}</strong><span>designs</span>
    </div>
    <div class="metric-card">
      <strong>${totalMockups}</strong><span>mockups to stamp</span>
    </div>
    <div class="metric-card ${completedMockups === totalMockups && totalMockups > 0 ? 'metric-good' : ''}">
      <strong>${completedMockups} / ${totalMockups}</strong><span>stamped complete</span>
    </div>
  `;
  els.stampProgressPanel.style.display = '';
}

function renderStampDirectoryTree() {
  if (!els.stampDirectoryTree) return;
  const stores = activeStores();
  const stampStatus = state.batch?.stampStatus || {};
  if (!stores.length) {
    els.stampDirectoryTree.innerHTML = '<div class="grid-note">No active stores.</div>';
    return;
  }
  let html = '';
  stores.forEach(store => {
    const storeStatus = getStoreStampStatus(store.id);
    const badgeClass = storeStatus === 'complete' ? 'badge-good' : storeStatus === 'warning' || storeStatus === 'error' ? 'badge-warn' : '';
    html += `<details class="dir-store" open>
      <summary class="dir-store-summary">
        <span class="dir-arrow">▶</span>
        <span class="dir-icon">🏪</span>
        <span class="dir-name">${escapeHtml(store.name)}</span>
        <span class="badge ${badgeClass} dir-badge">${storeStatus}</span>
      </summary>
      <div class="dir-designs">`;
    state.uploadedDesigns.forEach(design => {
      const dStatus = stampStatus[store.id]?.[design.id] || 'not stamped';
      const dBadgeClass = dStatus === 'complete' ? 'badge-good' : dStatus === 'warning' ? 'badge-warn' : '';
      const mockupCount = (design.selectedMockups || []).length;
      html += `<details class="dir-design">
        <summary class="dir-design-summary" data-store="${escapeHtml(store.id)}" data-design="${escapeHtml(design.id)}">
          <span class="dir-arrow">▶</span>
          <span class="dir-icon">🖼</span>
          <span class="dir-name">${escapeHtml(design.id)}</span>
          <span class="dir-meta">${mockupCount} mockup${mockupCount !== 1 ? 's' : ''}</span>
          <span class="badge ${dBadgeClass} dir-badge">${dStatus}</span>
        </summary>
        <div class="dir-previews" data-store="${escapeHtml(store.id)}" data-design="${escapeHtml(design.id)}">
          <div class="dir-preview-placeholder">Click to load previews</div>
        </div>
      </details>`;
    });
    html += `</div></details>`;
  });
  els.stampDirectoryTree.innerHTML = html;

  // Bind click-to-load previews
  els.stampDirectoryTree.querySelectorAll('.dir-design').forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      const preview = details.querySelector('.dir-previews');
      if (!preview || preview.dataset.loaded) return;
      const storeId = preview.dataset.store;
      const designId = preview.dataset.design;
      const store = state.stores.find(s => s.id === storeId);
      const design = state.uploadedDesigns.find(d => d.id === designId);
      if (store && design) {
        preview.dataset.loaded = '1';
        loadStampDirectoryPreviews(preview, store, design);
      }
    });
  });
}

async function loadStampDirectoryPreviews(container, store, design) {
  if (!store.logoUrl || !state.freeShipping?.url) {
    container.innerHTML = '<div class="dir-preview-note">Store logo or shipping logo missing.</div>';
    return;
  }
  container.innerHTML = '<div class="dir-preview-note">Loading…</div>';
  try {
    const rendered = await ensureRenderedForDesign(design);
    const selected = rendered.filter(item => design.selectedMockups?.includes(item.mockup.filename));
    if (!selected.length) {
      container.innerHTML = '<div class="dir-preview-note">No mockups selected for this design.</div>';
      return;
    }
    const storeLogoImage = await loadImage(store.logoUrl);
    const freeShippingImage = await loadImage(state.freeShipping.url);
    container.innerHTML = '';
    for (const item of selected) {
      const wrap = document.createElement('div');
      wrap.className = 'dir-preview-thumb';
      const canvas = document.createElement('canvas');
      const stampPlacements = {
        storeLogo: defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement),
        freeShipping: defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
      };
      drawComposite(canvas, item, { storeLogo: storeLogoImage, freeShippingLogo: freeShippingImage, stampPlacements, previewMax: 300 });
      const name = document.createElement('span');
      name.className = 'dir-preview-name';
      name.textContent = item.mockup.name;
      wrap.appendChild(canvas);
      wrap.appendChild(name);
      // Click to open larger preview
      wrap.addEventListener('click', () => showStampDirectoryLargePreview(wrap, item, store, storeLogoImage, freeShippingImage));
      container.appendChild(wrap);
    }
  } catch (err) {
    container.innerHTML = `<div class="dir-preview-note">Preview error: ${escapeHtml(err.message)}</div>`;
  }
}

function showStampDirectoryLargePreview(thumbWrap, item, store, storeLogoImage, freeShippingImage) {
  const existing = document.querySelector('.stamp-large-preview-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'stamp-large-preview-overlay';
  const canvas = document.createElement('canvas');
  const stampPlacements = {
    storeLogo: defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement),
    freeShipping: defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
  };
  drawComposite(canvas, item, { storeLogo: storeLogoImage, freeShippingLogo: freeShippingImage, stampPlacements, previewMax: 700 });
  const closeBtn = document.createElement('button');
  closeBtn.className = 'stamp-preview-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close preview');
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(canvas);
  overlay.appendChild(closeBtn);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function renderStampPage() {
  if (!els.stampEmptyState || !els.stampWorkspace) return;
  const stage = state.batch?.workflowStage;
  const ready = stage === 'stamping' || stage === 'stamped';
  els.stampEmptyState.style.display = ready ? 'none' : '';
  els.stampWorkspace.style.display = ready ? '' : 'none';
  els.runStampBtn.disabled = !ready;
  if (!ready) {
    if (els.stampProgressPanel) els.stampProgressPanel.style.display = 'none';
    return;
  }
  // Show progress based on current state
  if (stage === 'stamped') renderStampProgress('complete');
  else renderStampProgress('not-started');
  renderStampDirectoryTree();
}

function getStoreStampStatus(storeId) {
  const statuses = state.batch?.stampStatus?.[storeId];
  if (!statuses) return 'not started';
  const values = Object.values(statuses);
  if (!values.length) return 'not started';
  if (values.every(v => v === 'complete')) return 'complete';
  if (values.some(v => v === 'error')) return 'error';
  if (values.some(v => v === 'warning')) return 'warning';
  return 'stamped';
}

function renderStampSidebar() {
  // Legacy: now drives the directory tree. Keep for compatibility.
  renderStampDirectoryTree();
}

function renderStampDesignList(store) {
  els.stampDesignList.innerHTML = '';
  els.stampPreviewTitle.textContent = escapeHtml(store.name);
  els.stampPreviewSubtitle.textContent = 'Select a design to preview stamped mockups.';
  els.stampPreviewGrid.innerHTML = '';
  state.uploadedDesigns.forEach(design => {
    const status = state.batch?.stampStatus?.[store.id]?.[design.id] || 'not stamped';
    const btn = document.createElement('button');
    btn.className = 'side-item';
    const badgeClass = status === 'complete' ? 'badge-good' : status === 'warning' ? 'badge-warn' : '';
    btn.innerHTML = `<span>${escapeHtml(design.id)}</span><span class="badge ${badgeClass}">${status}</span>`;
    btn.addEventListener('click', () => renderStampPreview(store, design));
    els.stampDesignList.appendChild(btn);
  });
}

async function renderStampPreview(store, design) {
  if (!store.logoUrl) return showToast('Store has no logo configured.');
  if (!state.freeShipping?.url) return showToast('Shipping logo is missing.');
  els.stampPreviewTitle.textContent = `${escapeHtml(store.name)} / ${escapeHtml(design.id)}`;
  els.stampPreviewSubtitle.textContent = 'Rendering preview...';
  els.stampPreviewGrid.innerHTML = '<div class="grid-note">Loading previews…</div>';
  try {
    const rendered = await ensureRenderedForDesign(design);
    const selected = rendered.filter(item => design.selectedMockups?.includes(item.mockup.filename));
    if (!selected.length) {
      els.stampPreviewGrid.innerHTML = '<div class="grid-note">No mockups selected for this design.</div>';
      return;
    }
    const storeLogoImage = await loadImage(store.logoUrl);
    const freeShippingImage = await loadImage(state.freeShipping.url);
    els.stampPreviewGrid.innerHTML = '';
    for (const item of selected) {
      const node = els.stampedCardTemplate.content.cloneNode(true);
      const canvas = node.querySelector('.mockup-canvas');
      const name = node.querySelector('.mockup-name');
      const meta = node.querySelector('.mockup-meta');
      const editBtn = node.querySelector('.edit-stamps-btn');
      const downloadBtn = node.querySelector('.download-btn');
      name.textContent = item.mockup.name;
      meta.textContent = `${store.name} • preview`;
      const stampPlacements = {
        storeLogo: defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement),
        freeShipping: defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
      };
      drawComposite(canvas, item, { storeLogo: storeLogoImage, freeShippingLogo: freeShippingImage, stampPlacements, previewMax: 520 });
      const renderIndex = state.rendered.indexOf(item);
      editBtn.addEventListener('click', () => {
        if (renderIndex >= 0) openEditor(renderIndex, 'calibration');
        else showToast('Switch to Mockup Production and open this mockup to calibrate logos.');
      });
      downloadBtn.addEventListener('click', async () => {
        const c = document.createElement('canvas');
        drawComposite(c, item, { storeLogo: storeLogoImage, freeShippingLogo: freeShippingImage, stampPlacements });
        downloadBlob(await canvasToBlob(c, 'image/jpeg', 0.94), `${design.id}-${cleanName(store.name)}-${cleanName(item.mockup.name)}.jpg`);
      });
      els.stampPreviewGrid.appendChild(node);
    }
    els.stampPreviewSubtitle.textContent = `${selected.length} mockup${selected.length === 1 ? '' : 's'} — live preview.`;
  } catch (err) {
    els.stampPreviewGrid.innerHTML = `<div class="grid-note">Preview error: ${escapeHtml(err.message)}</div>`;
  }
}

async function runBatchStamping() {
  if (!state.batch) return showToast('No active batch.');
  const stores = activeStores().filter(s => s.logoUrl);
  if (!stores.length) return showToast('No active stores with logos configured.');
  if (!state.freeShipping?.url) return showToast('Shipping logo is required for stamping.');
  els.runStampBtn.disabled = true;
  els.runStampBtn.textContent = 'Stamping…';
  renderStampProgress('stamping');
  let warnings = 0;
  state.batch.stampStatus = {};
  for (const store of stores) {
    state.batch.stampStatus[store.id] = {};
    for (const design of state.uploadedDesigns) {
      const hasMockups = (design.selectedMockups || []).length > 0;
      if (!hasMockups) { warnings++; state.batch.stampStatus[store.id][design.id] = 'warning'; }
      else state.batch.stampStatus[store.id][design.id] = 'complete';
    }
  }
  state.batch.workflowStage = 'stamped';
  state.batch.stampedAt = new Date().toISOString();
  // Stamping completed successfully — derive and persist readiness so the
  // Current Batch tab and export validation recognize finished designs without
  // the removed manual "Mark Design Ready" button.
  state.uploadedDesigns.forEach(design => {
    if (isDesignExportReady(design)) {
      design.productionStatus = 'Ready';
      syncDesignToBatch(design);
    }
  });
  const allReady = state.uploadedDesigns.length && state.uploadedDesigns.every(isDesignExportReady);
  if (allReady && state.batch.status !== 'Exported') state.batch.status = 'Ready To Export';
  persistBatchNow();
  updateStats();
  els.runStampBtn.disabled = false;
  els.runStampBtn.textContent = 'Stamp Logos for Active Stores';
  renderStampProgress('complete', warnings);
  renderStampDirectoryTree();
  markWorkflowStep('stamp');
  const msg = warnings
    ? `Stamping complete — ${warnings} design${warnings === 1 ? '' : 's'} had no mockups.`
    : `Stamping complete for ${stores.length} store${stores.length === 1 ? '' : 's'}.`;
  showToast(msg);
  // Auto-advance to Current Batch
  setTimeout(() => switchPage('export'), 1200);
}

function computeBatchMetrics() {
  const designs = state.uploadedDesigns;
  const stores = activeStores();
  const readyDesigns = state.uploadedDesigns.filter(isDesignExportReady).length;
  const totalMockupsSelected = designs.reduce((sum, d) => sum + (d.selectedMockups?.length || 0), 0);
  const avgMockups = designs.length ? Math.round(totalMockupsSelected / designs.length * 10) / 10 : 0;
  const totalFinal = stores.length * totalMockupsSelected;
  const validation = validateExport();
  return {
    designs: designs.length,
    stores: stores.length,
    avgMockups,
    totalFinal,
    readyDesigns,
    stampStage: state.batch?.workflowStage || 'not started',
    exportReady: validation.errors.length === 0
  };
}

function renderBatchMetrics() {
  if (!els.batchMetricsRow || !state.batch) return;
  const m = computeBatchMetrics();
  els.batchMetricsRow.style.display = '';
  els.batchMetricsRow.innerHTML = `
    <div class="metric-card"><strong>${m.designs}</strong><span>designs</span></div>
    <div class="metric-card"><strong>${m.stores}</strong><span>active stores</span></div>
    <div class="metric-card"><strong>${m.avgMockups}</strong><span>mockups / design</span></div>
    <div class="metric-card"><strong>${m.totalFinal}</strong><span>total final mockups</span></div>
    <div class="metric-card"><strong>${m.readyDesigns} / ${m.designs}</strong><span>designs ready</span></div>
    <div class="metric-card"><strong>${escapeHtml(m.stampStage)}</strong><span>stamp stage</span></div>
    <div class="metric-card ${m.exportReady ? 'metric-good' : 'metric-warn'}">
      <strong>${m.exportReady ? 'Ready' : 'Not ready'}</strong><span>export status</span>
    </div>
  `;
}

function renderFolderBrowser() {
  if (!els.folderBrowserPanel || !els.folderTreeRoot) return;
  if (!state.batch || !state.uploadedDesigns.length) {
    els.folderBrowserPanel.style.display = 'none';
    return;
  }
  els.folderBrowserPanel.style.display = '';
  const letterMap = storeLetterMap();
  const stores = activeStores();
  let html = `<div class="folder-row folder-file"><span class="folder-icon">📄</span><button class="folder-file-btn" data-type="csv">batch_manifest.csv</button></div>`;
  for (const store of stores) {
    const storeFolder = letterMap.get(store.id) || store.store_folder || store.id;
    html += `<details class="folder-dir"><summary class="folder-summary"><span class="folder-icon">📁</span> ${escapeHtml(storeFolder)}/</summary>`;
    for (const design of state.uploadedDesigns) {
      const skuEntry = (state.batch?.reservedSkus?.[design.id] || {})[store.id];
      const mockupCount = (design.selectedMockups || []).length || 0;
      html += `<details class="folder-dir nested"><summary class="folder-summary"><span class="folder-icon">📁</span> ${escapeHtml(design.id)}/</summary>`;
      if (skuEntry && mockupCount) {
        for (let n = 1; n <= mockupCount; n++) {
          const filename = `${skuEntry.sku}_${n}.jpg`;
          html += `<div class="folder-row folder-file"><span class="folder-icon">🖼</span><button class="folder-file-btn" data-type="image" data-store="${escapeHtml(store.id)}" data-design="${escapeHtml(design.id)}" data-idx="${n - 1}">${escapeHtml(filename)}</button></div>`;
        }
      } else {
        html += `<div class="folder-row folder-missing"><span class="folder-icon">—</span><span>${skuEntry ? 'No mockups selected' : 'No SKU assigned'}</span></div>`;
      }
      html += `</details>`;
    }
    html += `</details>`;
  }
  els.folderTreeRoot.innerHTML = html;
  els.folderTreeRoot.querySelector('[data-type="csv"]')?.addEventListener('click', showCsvPreview);
  els.folderTreeRoot.querySelectorAll('[data-type="image"]').forEach(btn => {
    btn.addEventListener('click', () => showImagePreview(btn.dataset.store, btn.dataset.design, Number(btn.dataset.idx)));
  });
}

function showCsvPreview() {
  if (!els.filePreviewArea) return;
  const csv = generateManifestCsv();
  const lines = csv.split('\n');
  const header = lines[0]?.split(',') || [];
  const dataRows = lines.slice(1).map(r => r.split(','));
  const tableHtml = `<div class="csv-table-wrap"><table class="csv-table">
    <thead><tr>${header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${dataRows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell.replace(/^"|"$/g, ''))}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
  els.filePreviewArea.style.display = '';
  els.filePreviewArea.innerHTML = `<div class="panel-header"><h4>batch_manifest.csv preview</h4></div>${tableHtml}`;
}

async function showImagePreview(storeId, designId, mockupIndex) {
  if (!els.filePreviewArea) return;
  els.filePreviewArea.style.display = '';
  els.filePreviewArea.innerHTML = '<div class="grid-note">Rendering preview…</div>';
  try {
    const design = state.uploadedDesigns.find(d => d.id === designId);
    const store = state.stores.find(s => s.id === storeId);
    if (!design || !store?.logoUrl || !state.freeShipping?.url) {
      els.filePreviewArea.innerHTML = '<div class="grid-note">Cannot preview: missing logo or shipping image.</div>';
      return;
    }
    const rendered = await ensureRenderedForDesign(design);
    const selected = rendered.filter(item => design.selectedMockups?.includes(item.mockup.filename));
    const item = selected[mockupIndex];
    if (!item) { els.filePreviewArea.innerHTML = '<div class="grid-note">Mockup not found.</div>'; return; }
    const storeLogoImage = await loadImage(store.logoUrl);
    const freeShippingImage = await loadImage(state.freeShipping.url);
    const canvas = document.createElement('canvas');
    drawComposite(canvas, item, {
      storeLogo: storeLogoImage, freeShippingLogo: freeShippingImage,
      stampPlacements: {
        storeLogo: defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement),
        freeShipping: defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
      },
      previewMax: 600
    });
    const sku = (state.batch?.reservedSkus?.[designId] || {})[storeId]?.sku || '???';
    const filename = `${sku}_${mockupIndex + 1}.jpg`;
    els.filePreviewArea.innerHTML = '';
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = filename;
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/jpeg', 0.9);
    img.style.cssText = 'max-width:100%;border-radius:8px;margin-top:8px;display:block;';
    els.filePreviewArea.appendChild(p);
    els.filePreviewArea.appendChild(img);
  } catch (err) {
    els.filePreviewArea.innerHTML = `<div class="grid-note">Preview error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderExportSuccessBanner() {
  const banner = els.exportSuccessBanner;
  if (!banner) return;
  const exported = state.batch?.status === 'Exported';
  banner.style.display = exported ? '' : 'none';
  if (!exported) return;
  const titleEl = document.getElementById('exportSuccessTitle');
  const msgEl = document.getElementById('exportSuccessMessage');
  const skuEl = document.getElementById('exportSkuStatus');
  const report = state.batch?.lastExportDriveReport || state.batch?.driveExportReport || state.driveExportReport;
  if (report?.status === 'completed' && report?.verification?.ok !== false) {
    const verifiedNote = report?.verification
      ? ` Verified ${report.verification.completed_items}/${report.verification.expected_items} SKU folders with uploaded source PNGs.`
      : '';
    if (titleEl) titleEl.textContent = 'Export complete';
    if (msgEl) msgEl.textContent = `Batch exported successfully. SKU numbers have been updated in Google Drive and source designs were uploaded.${verifiedNote}`;
    if (skuEl) {
      skuEl.className = 'export-sku-status sku-ok';
      skuEl.innerHTML = escapeHtml(`Batch exported successfully. SKU numbers have been updated in Google Drive and source designs were uploaded.${verifiedNote}`);
    }
  } else if (report?.failures?.length) {
    if (titleEl) titleEl.textContent = 'Batch ZIP exported — Drive needs attention';
    const missingSource = report.failures.some(f => String(f.error || f.message || '').includes('source design file'));
    if (msgEl) msgEl.textContent = missingSource
      ? 'Batch ZIP exported, but D001 source PNG was not found locally for Google Drive upload.'
      : 'Batch ZIP exported, but Google Drive source PNG upload needs attention. Use Retry Failed Drive Uploads.';
    if (skuEl) {
      const failList = report.failures.map(f => `<li>${escapeHtml(f.store_name || f.storeName || '')} / ${escapeHtml(f.sku || f.designId || '')}: ${escapeHtml(f.error || f.message || 'failed')}</li>`).join('');
      skuEl.className = 'export-sku-status sku-warn';
      skuEl.innerHTML = `${missingSource ? 'Batch ZIP exported, but D001 source PNG was not found locally for Google Drive upload.' : 'Batch ZIP exported, but Google Drive source PNG upload needs attention. Use Retry Failed Drive Uploads.'}<ul>${failList}</ul>`;
    }
  } else {
    if (titleEl) titleEl.textContent = 'Export complete';
    if (msgEl) msgEl.textContent = 'Your Batchly-ready ZIP downloaded automatically. Follow the steps below.';
    if (skuEl) { skuEl.className = ''; skuEl.innerHTML = ''; }
  }
  // The reset button label/intent depends on whether the Drive upload fully
  // succeeded. A partial/failed Drive upload offers a guarded "Clear Batch Anyway".
  if (els.resetBatchBtn) {
    const drivePartial = Boolean(report?.failures?.length) || (report && report.status !== 'completed');
    els.resetBatchBtn.dataset.partial = drivePartial ? 'true' : 'false';
    els.resetBatchBtn.textContent = drivePartial ? 'Clear Batch Anyway' : 'Reset Batch / Clear Cache';
    els.resetBatchBtn.classList.toggle('ghost-button', drivePartial);
    els.resetBatchBtn.classList.toggle('primary-button', !drivePartial);
  }
}

// Clears the current workflow/runtime state so Preply is ready for a new batch.
// Permanent config (OAuth token, stores, mappings, SKU prefixes, parent folder
// IDs, mockup/stamp presets) is reloaded from the server, never deleted.
async function resetBatchWorkflow() {
  const batchId = state.batch?.id;
  const partial = els.resetBatchBtn?.dataset.partial === 'true';
  const confirmMsg = partial
    ? 'Google Drive upload is incomplete. Clearing this batch may make retry harder. Continue?'
    : 'This will clear the current batch workflow and prepare Preply for a new batch. It will not remove Google Drive connection, store settings, or presets.';
  if (!window.confirm(confirmMsg)) return;

  // Archive/release the batch server-side (never deletes Drive files or presets).
  if (batchId) {
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(batchId)}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: partial })
      });
      const data = await res.json();
      if (!data.ok && data.requiresForce && !partial) {
        // Server flagged an incomplete Drive upload; re-ask with force.
        if (!window.confirm(`${data.message} Clear anyway?`)) return;
        await fetch(`/api/batches/${encodeURIComponent(batchId)}/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true })
        });
      }
    } catch (err) {
      showToast(`Reset failed: ${err.message}`);
      return;
    }
  }

  // Reset in-memory workflow/runtime state (keeps stores/presets/settings/driveStatus).
  state.batch = null;
  state.uploadedDesigns = [];
  state.zipValidation = null;
  state.csvMetadata = new Map();
  state.intakeEditMode = null;
  state.currentIntakeIndex = 0;
  state.currentProductionIndex = 0;
  state.designImage = null;
  state.designBounds = null;
  state.rendered = [];
  state.previewCache = new Map();
  state.selected = new Set();
  state.editingIndex = null;
  state.calibrationEntry = null;
  state.previewMode = null;
  state.driveExportReport = null;
  state.workflowCompleted = new Set();

  // Clear stale UI panels.
  if (els.validationReport) els.validationReport.innerHTML = '';
  if (els.exportReport) els.exportReport.innerHTML = '';
  if (els.driveExportReport) els.driveExportReport.innerHTML = '';
  if (els.dryRunReport) { els.dryRunReport.innerHTML = ''; els.dryRunReport.style.display = 'none'; }
  if (els.manifestPreview) els.manifestPreview.innerHTML = '';
  if (els.mockupGrid) els.mockupGrid.innerHTML = '';
  if (els.stampDirectoryTree) els.stampDirectoryTree.innerHTML = '';
  if (els.stampProgressGrid) els.stampProgressGrid.innerHTML = '';
  if (els.exportSuccessBanner) els.exportSuccessBanner.style.display = 'none';
  if (els.zipInput) els.zipInput.value = '';
  if (els.uploadSummary) els.uploadSummary.textContent = 'Upload a batch ZIP to begin.';
  if (els.createBatchBtn) els.createBatchBtn.disabled = true;

  // Reload permanent config + refreshed batch list from the server.
  await refreshState();

  // Back to step 1 and reset the global progress bar.
  switchPage('upload');
  updateWorkflowProgress();
  showToast('Batch cache cleared. Preply is ready for a new batch.');
}

function renderCurrentBatch() {
  renderExport();
  renderDriveOAuthBanner();
  if (!state.batch) {
    if (els.batchMetricsRow) els.batchMetricsRow.style.display = 'none';
    if (els.folderBrowserPanel) els.folderBrowserPanel.style.display = 'none';
    if (els.exportSuccessBanner) els.exportSuccessBanner.style.display = 'none';
    return;
  }
  renderBatchMetrics();
  renderFolderBrowser();
  renderExportSuccessBanner();
}

// Shows the Connect Google Drive affordance only in OAuth mode. In OAuth mode
// uploads run as the signed-in user (who has Drive storage quota), which is the
// only way to store source PNGs in a personal My Drive folder.
function renderDriveOAuthBanner() {
  const banner = els.driveOAuthBanner;
  if (!banner) return;
  const ds = state.driveStatus || {};
  if (ds.mode !== 'oauth') { banner.style.display = 'none'; return; }
  const oauth = ds.oauth || {};
  banner.style.display = '';
  if (!oauth.client_configured) {
    els.driveOAuthTitle.textContent = 'Google Drive OAuth not configured';
    els.driveOAuthMessage.textContent = 'Add google-oauth-client.json (from Google Cloud Console) or set GOOGLE_OAUTH_CLIENT_ID/SECRET, then restart Preply.';
    els.connectDriveBtn.disabled = true;
    els.disconnectDriveBtn.style.display = 'none';
    banner.classList.toggle('drive-oauth-warn', true);
    banner.classList.toggle('drive-oauth-ok', false);
  } else if (!oauth.connected) {
    els.driveOAuthTitle.textContent = 'Connect Google Drive';
    els.driveOAuthMessage.textContent = 'Authorize uploads as your Google user so source-design PNGs land in the store SKU folders.';
    els.connectDriveBtn.disabled = false;
    els.connectDriveBtn.textContent = 'Connect Google Drive';
    els.disconnectDriveBtn.style.display = 'none';
    banner.classList.toggle('drive-oauth-warn', true);
    banner.classList.toggle('drive-oauth-ok', false);
  } else {
    els.driveOAuthTitle.textContent = 'Google Drive connected ✓';
    els.driveOAuthMessage.textContent = `Uploading as ${oauth.connected_email || 'your Google account'}. Source PNGs will be stored in Drive on export.`;
    els.connectDriveBtn.disabled = false;
    els.connectDriveBtn.textContent = 'Reconnect';
    els.disconnectDriveBtn.style.display = '';
    banner.classList.toggle('drive-oauth-warn', false);
    banner.classList.toggle('drive-oauth-ok', true);
  }
}

async function connectDriveAction() {
  try {
    const res = await fetch('/api/drive/oauth/url');
    const data = await res.json();
    if (!data.ok || !data.url) { showToast(data.error || 'Could not start Google Drive connection.'); return; }
    window.open(data.url, '_blank', 'noopener');
    showToast('Complete the Google consent in the new tab, then click Refresh / re-open this tab.');
  } catch (err) {
    showToast(`Connect failed: ${err.message}`);
  }
}

async function disconnectDriveAction() {
  try {
    await fetch('/api/drive/oauth/disconnect', { method: 'POST' });
    const status = await (await fetch('/api/drive/status')).json();
    state.driveStatus = status;
    renderDriveOAuthBanner();
    showToast('Google Drive disconnected.');
  } catch (err) {
    showToast(`Disconnect failed: ${err.message}`);
  }
}

// -- Phase 5: connection settings (Settings page) ------------------------------

function statusChip(kind, label) {
  return `<span class="status-chip ${kind}">${escapeHtml(label)}</span>`;
}

function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

async function refreshConnectionSettings() {
  try {
    const [settingsRes, statusRes] = await Promise.all([
      fetch('/api/settings', { cache: 'no-store' }),
      fetch('/api/settings/status', { cache: 'no-store' })
    ]);
    state.appSettings = await settingsRes.json();
    state.settingsStatus = await statusRes.json();
  } catch (err) {
    showToast(`Could not load connection settings: ${err.message}`);
    return;
  }
  renderSettingsWarnings();
  renderConnectionSettings();
  renderStoreSettings();
}

function renderSettingsWarnings() {
  const box = els.settingsWarnings;
  if (!box) return;
  const warnings = state.settingsStatus?.warnings || [];
  if (!warnings.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = `
    <strong>Production configuration incomplete</strong>
    <ul>${warnings.map(w => `
      <li><span class="${w.level === 'error' ? 'error-text' : 'warn-text'}">${w.level === 'error' ? 'Error' : 'Warning'}</span>
        — ${escapeHtml(w.message)} <span class="fix-text">${escapeHtml(w.fix)}</span></li>`).join('')}
    </ul>`;
}

function renderConnectionSettings() {
  const grid = els.connectionSettingsGrid;
  if (!grid) return;
  const status = state.settingsStatus;
  const settings = state.appSettings;
  if (!status || !settings) { grid.innerHTML = '<p class="hint">Loading…</p>'; return; }

  const drive = status.drive || {};
  const mode = drive.mode || 'mock';
  const pending = status.pendingFolder || {};
  const handoff = status.handoffMode || { value: 'local', source: 'default' };

  // --- Card 1: Google Drive connection ---
  let driveChip;
  let driveDetail;
  if (mode === 'mock') {
    driveChip = statusChip('neutral', 'Local mock mode');
    driveDetail = 'Drive calls are simulated locally. Set GOOGLE_DRIVE_AUTH_MODE=oauth for production.';
  } else if (drive.connected) {
    driveChip = statusChip('ok', 'Connected');
    driveDetail = `Connected as ${drive.email || 'your Google account'}${drive.connectedAt ? ` · since ${formatWhen(drive.connectedAt)}` : ''}.`;
  } else {
    driveChip = statusChip(drive.error ? 'bad' : 'warn', drive.error ? 'Error' : 'Needs setup');
    driveDetail = drive.error || 'Google Drive is not connected yet.';
  }
  const showOAuthButtons = mode === 'oauth';

  // --- Card 2: pending-batches folder ---
  const pendingValue = settings.pendingBatchesFolderId?.value || '';
  const pendingSource = settings.pendingBatchesFolderId?.source || 'default';
  const lastTest = pending.lastTest || settings.pendingFolderLastTest || null;
  const pendingChip = lastTest?.ok
    ? statusChip('ok', 'Tested')
    : pending.configured
      ? statusChip('warn', 'Needs test')
      : statusChip(mode === 'mock' ? 'neutral' : 'warn', mode === 'mock' ? 'Local mock mode' : 'Needs setup');
  const sourceLabel = pendingSource === 'settings'
    ? 'Saved in Preply settings (overrides the environment variable).'
    : pendingSource === 'env'
      ? 'Using the PREPLY_PENDING_BATCHES_FOLDER_ID environment variable — saving here overrides it.'
      : 'Not configured yet — paste the Drive folder ID from the folder URL.';

  // --- Card 3: handoff mode ---
  const handoffSourceLabel = handoff.source === 'settings'
    ? 'Saved in Preply settings.'
    : handoff.source === 'env'
      ? 'From the PREPLY_BATCHLY_HANDOFF_MODE environment variable.'
      : 'Default.';
  const modeDescriptions = {
    local: 'Exports are written to the local Batchly downloads folder on this machine.',
    drive: 'Exports upload to the pending-batches Drive folder for Batchly to scan.',
    both: 'Exports go to both destinations; the handoff fails if either fails.'
  };
  const localWarn = status.production && handoff.value === 'local'
    ? '<p class="error-text">Production is running with local handoff — exports will not reach Drive. Switch to "drive" after testing the pending folder.</p>'
    : '';

  grid.innerHTML = `
    <article class="store-card connection-card" id="driveConnectionCard">
      <div class="connection-card-head"><h3>Google Drive connection</h3>${driveChip}</div>
      <p class="hint">${escapeHtml(driveDetail)}</p>
      ${showOAuthButtons ? `
        <div class="button-row">
          <button id="settingsConnectDriveBtn" class="primary-button" type="button">${drive.connected ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
          ${drive.connected ? '<button id="settingsDisconnectDriveBtn" class="ghost-button" type="button">Disconnect</button>' : ''}
        </div>` : ''}
    </article>

    <article class="store-card connection-card" id="pendingFolderCard">
      <div class="connection-card-head"><h3>Batchly pending-batches folder</h3>${pendingChip}</div>
      <p class="hint">${escapeHtml(sourceLabel)}</p>
      <label><span>Drive folder ID</span>
        <input id="pendingFolderInput" placeholder="Drive folder ID" value="${escapeHtml(pendingValue)}">
      </label>
      <div class="button-row">
        <button id="savePendingFolderBtn" class="secondary-button" type="button">Save</button>
        <button id="testPendingFolderBtn" class="secondary-button" type="button">Test Pending Batches Folder</button>
      </div>
      ${lastTest ? `<p class="hint">Last test: ${lastTest.ok ? `passed${lastTest.folderName ? ` (${escapeHtml(lastTest.folderName)})` : ''}` : `failed — ${escapeHtml(lastTest.error || '')}`} · ${formatWhen(lastTest.checkedAt)}</p>` : ''}
    </article>

    <article class="store-card connection-card" id="handoffModeCard">
      <div class="connection-card-head"><h3>Batchly handoff mode</h3>${statusChip(handoff.value === 'local' ? (status.production ? 'warn' : 'neutral') : 'ok', handoff.value)}</div>
      <p class="hint">${escapeHtml(handoffSourceLabel)}</p>
      ${['local', 'drive', 'both'].map(m => `
        <label class="radio-row"><input type="radio" name="handoffMode" value="${m}" ${handoff.value === m ? 'checked' : ''}>
          <span><strong>${m}</strong> — ${modeDescriptions[m]}</span></label>`).join('')}
      ${localWarn}
      <div class="button-row">
        <button id="saveHandoffModeBtn" class="secondary-button" type="button">Save Handoff Mode</button>
      </div>
    </article>`;

  const connectBtn = document.getElementById('settingsConnectDriveBtn');
  if (connectBtn) connectBtn.addEventListener('click', connectDriveAction);
  const disconnectBtn = document.getElementById('settingsDisconnectDriveBtn');
  if (disconnectBtn) disconnectBtn.addEventListener('click', async () => {
    if (!window.confirm('Disconnect Google Drive? Exports and folder tests will stop working until you reconnect.')) return;
    await disconnectDriveAction();
    await refreshConnectionSettings();
  });

  const saveFolderBtn = document.getElementById('savePendingFolderBtn');
  if (saveFolderBtn) saveFolderBtn.addEventListener('click', async () => {
    saveFolderBtn.disabled = true;
    try {
      const value = document.getElementById('pendingFolderInput').value.trim();
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingBatchesFolderId: value })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) return showToast(data.error || 'Save failed.');
      showToast(value ? 'Pending-batches folder saved.' : 'Cleared — using the environment variable if set.');
      await refreshConnectionSettings();
    } finally {
      saveFolderBtn.disabled = false;
    }
  });

  const testFolderBtn = document.getElementById('testPendingFolderBtn');
  if (testFolderBtn) testFolderBtn.addEventListener('click', async () => {
    testFolderBtn.disabled = true;
    testFolderBtn.textContent = 'Testing…';
    try {
      const value = document.getElementById('pendingFolderInput').value.trim();
      const res = await fetch('/api/settings/test-pending-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value ? { folderId: value } : {})
      });
      const data = await res.json();
      showToast(data.ok
        ? `Folder accessible${data.folderName ? `: ${data.folderName}` : ''} (${data.sampleCount ?? 0} entries).`
        : `Folder test failed: ${data.error || 'unknown error'}${data.fix ? ` — ${data.fix}` : ''}`);
      await refreshConnectionSettings();
    } finally {
      testFolderBtn.disabled = false;
      testFolderBtn.textContent = 'Test Pending Batches Folder';
    }
  });

  const saveModeBtn = document.getElementById('saveHandoffModeBtn');
  if (saveModeBtn) saveModeBtn.addEventListener('click', async () => {
    saveModeBtn.disabled = true;
    try {
      const selected = document.querySelector('input[name="handoffMode"]:checked')?.value || 'local';
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffMode: selected })
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) return showToast(data.error || 'Save failed.');
      showToast(`Handoff mode set to "${selected}".`);
      await refreshConnectionSettings();
    } finally {
      saveModeBtn.disabled = false;
    }
  });
}

function renderExport() {
  const validation = validateExport();
  els.exportZipBtn.disabled = Boolean(validation.errors.length);
  els.dryRunBtn.disabled = !state.batch || Boolean(validation.errors.length);
  els.retryDriveBtn.disabled = !state.batch?.driveExportReport?.failures?.length;
  els.refreshSkuBtn.disabled = !state.batch || state.batch.status === 'Exported' || Boolean(state.batch.exportState?.batch_zip_exported);
  els.exportSummary.textContent = validation.errors.length
    ? `${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'} to fix before export.`
    : `${manifestRows().length} manifest rows ready.`;
  els.exportReport.innerHTML = [
    ...validation.errors.map(error => reportItem('error', error)),
    ...validation.warnings.map(warning => reportItem('warning', warning)),
    ...(validation.errors.length ? [] : [reportItem('ok', 'Batch is ready for Batchly export.')])
  ].join('');
  renderDriveExportStatus();
  els.manifestPreview.textContent = generateManifestCsv().split('\n').slice(0, 8).join('\n');
}

function renderDriveExportStatus() {
  const report = state.batch?.driveExportReport || state.driveExportReport;
  const ranges = state.batch?.driveReservedRanges;
  const rangeHtml = ranges ? Object.values(ranges).map(range => reportItem(
    'ok',
    `${escapeHtml(range.storeName)} Drive range`,
    `Latest found: ${range.latestFound || 'none'} • Reserved: ${range.reservedStart}-${range.reservedEnd}`
  )).join('') : '';
  if (!report) {
    els.driveExportReport.innerHTML = rangeHtml;
    return;
  }
  const itemRows = (report.stores || []).flatMap(store => (store.items || []).map(item => {
    const kind = item.status === 'completed' ? 'ok' : item.status === 'failed' ? 'error' : 'warning';
    return reportItem(kind, `${store.store_name} / ${item.sku}: ${item.status}`, item.error || `Folder: ${item.folder_id || 'pending'} • File: ${item.uploaded_file_id || 'pending'}`);
  })).join('');
  const conflictRows = report.conflict_checks?.conflicts?.map(conflict => reportItem('error', conflict.message)).join('') || '';
  els.driveExportReport.innerHTML = `${rangeHtml}${conflictRows}${itemRows}`;
}

async function ensureRenderedForDesign(design) {
  state.designImage = design.image;
  state.designBounds = design.bounds;
  // Preset-scoped caches (from renders/preloads) may not cover a selection
  // that changed afterwards — only reuse a cache that has every selected
  // mockup, otherwise rebuild from the full pool so export never drops files.
  const cached = state.previewCache.get(design.id);
  const needed = design.selectedMockups || [];
  if (cached && needed.every(filename => cached.some(item => item.mockup.filename === filename))) {
    return cached;
  }
  const rendered = [];
  for (const mockup of state.blankMockups) {
    const mockupImage = await loadImage(mockup.url);
    rendered.push({ mockup, mockupImage, placement: defaultPlacement(mockupImage, state.designBounds, mockup.placement) });
  }
  state.previewCache.set(design.id, rendered);
  return rendered;
}

// Determinate export progress: phases get fixed spans, the per-file render/
// upload loop advances inside its span by actual file count.
function setExportProgress(label, percent) {
  const wrap = document.getElementById('exportProgressWrap');
  const fill = document.getElementById('exportProgressFill');
  const text = document.getElementById('exportProgressLabel');
  if (!wrap || !fill || !text) return;
  wrap.hidden = false;
  fill.style.width = `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
  text.textContent = label;
}

function hideExportProgress() {
  const wrap = document.getElementById('exportProgressWrap');
  if (wrap) wrap.hidden = true;
}

async function exportBatchZip() {
  const validation = validateExport();
  if (validation.errors.length) return renderExport();
  els.exportZipBtn.disabled = true;
  els.exportZipBtn.textContent = 'Rechecking Drive...';
  setExportProgress('Uploading source PNGs to Drive SKU folders\u2026', 5);
  let driveData = { ok: false, report: null };
  let driveConflictError = '';
  try {
    // Ensure the server has every source PNG (uploads only what's missing —
    // normally zero, since batch creation already sent them), then export
    // without shipping any design bytes in this request.
    setStatus('Checking source designs on server...');
    await uploadSourceDesigns(state.batch.id, {
      onlyMissing: true,
      onProgress: (done, total) => setStatus(`Re-uploading source designs... ${done}/${total}`),
    });
    const driveResponse = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/export-drive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    driveData = await driveResponse.json();
    state.batch.driveExportReport = driveData.report;
    renderDriveExportStatus();
    if (driveResponse.status === 409 || driveData.report?.status === 'conflict') {
      driveConflictError = driveData.report?.failures?.[0]?.message || driveData.report?.failures?.[0]?.error || 'Drive SKU conflict detected. Refresh SKU assignments before exporting.';
    }
  } catch (error) {
    driveData = {
      ok: false,
      report: {
        status: 'failed',
        failures: [{ message: `Drive export request failed: ${error.message}` }]
      }
    };
    state.batch.driveExportReport = driveData.report;
    renderDriveExportStatus();
  }

  if (driveConflictError) {
    hideExportProgress();
    els.exportZipBtn.textContent = 'Export Batchly ZIP';
    els.exportZipBtn.disabled = false;
    els.retryDriveBtn.disabled = !driveData.report?.failures?.length;
    els.refreshSkuBtn.disabled = false;
    setStatus(`Export blocked: ${driveConflictError} Click "Refresh SKU Reservation" to re-scan Drive and reserve new safe SKUs for this batch.`);
    showToast('Drive SKU conflict detected. Use Refresh SKU Reservation.');
    return;
  }

  // The Drive SKU-folder handoff is a required part of the export. If it did
  // not verifiably complete (folders created + PNGs uploaded for every
  // reserved SKU), block the export: no ZIP, no Exported status. Retry Failed
  // Drive Uploads is the recovery path.
  const driveSucceeded = driveData.report?.status === 'completed' && driveData.report?.verification?.ok !== false;
  if (!driveSucceeded) {
    hideExportProgress();
    els.exportZipBtn.textContent = 'Export Batchly ZIP';
    els.exportZipBtn.disabled = false;
    els.retryDriveBtn.disabled = !driveData.report?.failures?.length;
    const firstFailure = driveData.report?.failures?.[0];
    const detail = firstFailure?.message || firstFailure?.error || 'The server returned no Drive export report.';
    setStatus(`Export blocked: Google Drive SKU folder upload did not complete — the Batchly ZIP was NOT created. ${detail}`);
    showToast('Export blocked: Drive SKU folder upload failed.');
    return;
  }

  els.exportZipBtn.textContent = 'Exporting...';
  try {
  // Open the handoff FIRST: its mode decides whether a browser ZIP is built
  // at all. In pure drive mode the batch goes server\u2192Drive\u2192Batchly and the
  // whole JSZip build + download is skipped (the single slowest client step).
  setExportProgress('Preparing Batchly handoff\u2026', 16);
  setStatus('Preparing Batchly handoff...');
  let handoffSession;
  try {
    const startRes = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/handoff/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    handoffSession = await startRes.json();
    if (!startRes.ok || !handoffSession.ok) throw new Error(handoffSession?.error || 'handoff/start failed');
  } catch (err) {
    hideExportProgress();
    els.exportZipBtn.textContent = 'Export Batchly ZIP';
    els.exportZipBtn.disabled = false;
    setStatus(`Export blocked: could not open Batchly handoff \u2014 ${err.message}`);
    showToast('Export blocked: handoff failed to start.');
    return;
  }
  const handoffMode = handoffSession.mode || 'local';
  const wantZip = handoffMode !== 'drive';

  // Flip the label as soon as the handoff is open — handoff/start itself is
  // near-instant, and leaving "Preparing…" up through the image preloads and
  // the first design's renders read as the export being stuck.
  const totalExportFiles = state.uploadedDesigns.reduce(
    (sum, design) => sum + (design.selectedMockups?.length || 0), 0,
  ) * activeStores().length;
  setExportProgress(`Rendering & uploading mockups… 0 of ${totalExportFiles}`, 18);

  const zip = wantZip ? new JSZip() : null;
  const manifest = generateManifestCsv();
  if (zip) {
    zip.file('batch_manifest.csv', manifest);
    zip.file('batch_info.json', JSON.stringify(buildBatchInfo(), null, 2));
    zip.file('validation_report.json', JSON.stringify(validation, null, 2));
    if (driveData.report) zip.file('logs/drive_export_report.json', JSON.stringify(driveData.report, null, 2));
    zip.file('export_log.txt', `Preply export\nBatch: ${state.batch.id}\nRows: ${manifestRows().length}\nCreated: ${new Date().toISOString()}\n`);
    for (const design of state.uploadedDesigns) {
      zip.file(`source_designs/${design.filename}`, design.file);
    }
  }
  const freeShippingImage = await loadImage(state.freeShipping.url);
  const logoImages = new Map();
  const exportLetterMap = storeLetterMap();
  for (const store of activeStores()) {
    if (store.logoUrl) logoImages.set(store.id, await loadImage(store.logoUrl));
  }

  // Phase 3: chunked handoff. Peel each rendered JPEG into a small buffer and
  // POST it to the server as we go — bounded browser memory, no giant JSON.
  // In local/both modes the ZIP also gets every JPEG; the Batchly-facing tree
  // lives on the server for atomic local rename and/or Drive upload.
  const chunkBudgetBytes = Math.max(1024 * 1024, (handoffSession.chunk_max_bytes || 32 * 1024 * 1024) - 1024 * 1024);
  let chunkBuffer = [];
  let chunkBudget = 0;
  const expectedPaths = ['batch_manifest.csv'];
  let filesUploaded = 0;
  let bytesUploaded = 0;
  let exportFilesDone = 0;

  // Pipelined: at most one chunk upload in flight while rendering continues —
  // the network transfer overlaps the canvas work instead of serializing.
  let inflightChunkUpload = null;
  async function postChunk(files) {
    const res = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/handoff/files`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handoffId: handoffSession.handoffId, files }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(body.error || `handoff/files failed (HTTP ${res.status})`);
    filesUploaded += files.length;
    setStatus(`Uploading batch files to server... ${filesUploaded} files, ${Math.round(bytesUploaded / (1024 * 1024))} MB`);
  }
  async function flushChunk() {
    if (!chunkBuffer.length) return;
    const files = chunkBuffer;
    chunkBuffer = [];
    chunkBudget = 0;
    if (inflightChunkUpload) await inflightChunkUpload; // rethrows an upload failure
    inflightChunkUpload = postChunk(files);
    inflightChunkUpload.catch(() => {}); // observed on the next await
  }
  async function drainChunkUploads() {
    await flushChunk();
    if (inflightChunkUpload) await inflightChunkUpload;
  }

  for (const design of state.uploadedDesigns) {
    setStatus(`Final-rendering ${design.id}...`);
    const rendered = await ensureRenderedForDesign(design);
    const selected = rendered.filter(item => design.selectedMockups.includes(item.mockup.filename));
    const skus = state.batch.reservedSkus[design.id] || {};
    for (const store of activeStores()) {
      const sku = skus[store.id]?.sku;
      const storeLogoImage = logoImages.get(store.id);
      const storeFolder = exportLetterMap.get(store.id);
      // validateExport() already guarantees every active store has a SKU (per
      // design), a logo, and a Batchly folder. If any is somehow missing here we
      // must NOT silently skip — that would drop this store's images while its
      // manifest row still exists, so we fail loudly and abort the ZIP instead.
      if (!sku || !storeLogoImage || !storeFolder) {
        const reason = !storeFolder
          ? 'no Batchly folder assigned'
          : !sku
            ? `no reserved SKU for ${design.id}`
            : 'no store logo loaded';
        throw new Error(`Export aborted: ${store.name} is misconfigured (${reason}). Fix it in Store Settings and re-export — no batch was marked exported.`);
      }
      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        const canvas = document.createElement('canvas');
        drawComposite(canvas, item, {
          storeLogo: storeLogoImage,
          freeShippingLogo: freeShippingImage,
          stampPlacements: {
            storeLogo: defaultStampPlacement(item.mockupImage, storeLogoImage, 'storeLogo', item.mockup.stampPlacement),
            freeShipping: defaultStampPlacement(item.mockupImage, freeShippingImage, 'freeShipping', item.mockup.stampPlacement)
          }
        });
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94);
        const filePath = `${storeFolder}/${design.id}/${sku}_${index + 1}.jpg`;
        if (zip) zip.file(filePath, blob);
        expectedPaths.push(filePath);
        exportFilesDone += 1;
        setExportProgress(
          `Rendering & uploading mockups\u2026 ${exportFilesDone} of ${totalExportFiles}`,
          18 + (totalExportFiles ? (exportFilesDone / totalExportFiles) * 57 : 0),
        );
        const base64 = await blobToBase64(blob);
        const encodedBytes = Math.ceil(base64.length * 3 / 4);
        bytesUploaded += encodedBytes;
        if (chunkBudget + encodedBytes > chunkBudgetBytes && chunkBuffer.length) {
          await flushChunk();
        }
        chunkBuffer.push({ path: filePath, base64 });
        chunkBudget += encodedBytes;
      }
    }
  }
  await drainChunkUploads();

  const zipBlob = zip ? await zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => {
    setStatus(`Packaging ZIP... ${Math.round(metadata.percent)}%`);
    setExportProgress(`Packaging ZIP\u2026 ${Math.round(metadata.percent)}%`, 75 + metadata.percent * 0.13);
  }) : null;

  setExportProgress(`Finalizing Batchly handoff (${handoffMode})\u2026`, 89);
  setStatus(`Finalizing Batchly handoff (${handoffMode})...`);
  // Finalize is one long server call (Drive tree upload) \u2014 tick an elapsed
  // counter so the frozen 89% bar still reads as alive.
  const finalizeStartedAt = Date.now();
  const finalizeTicker = setInterval(() => {
    const seconds = Math.round((Date.now() - finalizeStartedAt) / 1000);
    setExportProgress(`Finalizing Batchly handoff (${handoffMode})\u2026 ${seconds}s`, 89);
  }, 1000);
  // The Batchly handoff is a required, verified step. If it did not fully
  // succeed (local atomic rename + optional Drive upload per configured mode),
  // the batch must NOT be marked Exported — retry stays available; staging is
  // preserved on the server so we don't have to re-render every JPEG.
  let handoffReport = null;
  try {
    const finalizeRes = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/handoff/finalize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handoffId: handoffSession.handoffId,
        manifest: generateManifestCsv(),
        expectedPaths,
        mode: handoffMode,
      }),
    });
    const body = await finalizeRes.json().catch(() => ({}));
    handoffReport = body?.report || null;
    if (!finalizeRes.ok || !body.ok || !handoffReport?.ok) {
      const localErr = handoffReport?.local?.error;
      const driveErr = handoffReport?.drive?.error;
      const reason = driveErr || localErr || body?.error || 'Batchly handoff did not complete.';
      throw new Error(`Export blocked: Batchly handoff failed — the batch was NOT marked exported. ${reason}`);
    }
  } catch (err) {
    hideExportProgress();
    els.exportZipBtn.textContent = 'Export Batchly ZIP';
    els.exportZipBtn.disabled = false;
    els.retryDriveBtn.disabled = !state.batch?.driveExportReport?.failures?.length;
    const message = err.message || 'Batchly handoff failed.';
    setStatus(message);
    showToast('Export blocked: Batchly handoff failed.');
    return;
  } finally {
    clearInterval(finalizeTicker);
  }

  await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/exported`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exportInfo: {
        manifestRows: manifestRows().length,
        exportedFile: zipBlob ? `${state.batch.id}-batchly-ready.zip` : `Drive pending-batches handoff`,
        batch_zip_exported: Boolean(zipBlob),
        source_png_uploaded: driveSucceeded
      }
    })
  });
  if (zipBlob) downloadBlob(zipBlob, `${state.batch.id}-batchly-ready.zip`);
  state.batch.status = 'Exported';
  state.batch.lastExportDriveReport = driveData.report;
  state.batch.lastHandoffReport = handoffReport;
  markWorkflowStep('export');
  const verified = driveData.report?.verification;
  const handoffSummary = handoffReport?.drive?.ok
    ? ` Batchly handoff → Drive pending-batches folder ${handoffReport.drive.batchFolderName} (${handoffReport.drive.files_created} files).`
    : handoffReport?.local?.ok
      ? ` Batchly handoff → local downloads directory (${handoffReport.staged_file_count} files).`
      : '';
  setStatus(`Batch exported successfully. Drive verified: ${verified?.completed_items ?? '?'} of ${verified?.expected_items ?? '?'} SKU folders created with source PNGs uploaded.${handoffSummary}`);
  showToast('Batch exported successfully.');

  // Hands-free Batchly pickup: the batch is durable in Drive, now ping
  // Batchly (may cold-start on free hosting) so it scans and shows the batch
  // with zero manual steps. Failure is non-fatal — manual scan still works.
  if (handoffReport?.drive?.ok) {
    const folderName = handoffReport.drive.batchFolderName;
    setExportProgress('Waking Batchly\u2026 (a sleeping instance can take up to a minute)', 93);
    setStatus('Waking Batchly and requesting a pending-batches scan\u2026 (up to a minute on free hosting)');
    try {
      const notifyRes = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/notify-batchly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchFolderName: folderName }),
      });
      const notify = await notifyRes.json().catch(() => ({}));
      if (notify.ok) {
        // Batchly downloads + validates in the background; poll until the
        // batch lands in the inQueue pool (or ~4 minutes pass).
        let finalState = notify.batch?.autoValidation || null;
        const deadline = Date.now() + 4 * 60 * 1000;
        while (Date.now() < deadline) {
          const status = finalState?.status || 'validating';
          if (status === 'ready' || status === 'warnings' || status === 'failed') break;
          setExportProgress('Batchly is validating the batch\u2026', 96);
          setStatus('Batchly is downloading and validating the batch\u2026');
          await new Promise(resolve => setTimeout(resolve, 6000));
          try {
            const pollRes = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/notify-batchly`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ batchFolderName: folderName, quick: true }),
            });
            const poll = await pollRes.json().catch(() => ({}));
            if (poll.ok && poll.batch) finalState = poll.batch.autoValidation || finalState;
          } catch { /* transient poll failure \u2014 keep waiting */ }
        }
        setExportProgress('Done', 100);
        const status = finalState?.status || null;
        if (status === 'ready' || status === 'warnings') {
          setStatus(`Batch validated by Batchly${status === 'warnings' ? ' (with warnings)' : ''} \u2014 "${folderName}" is in the inQueue pool. Open Batchly \u2192 Batches to run the listings.`);
          showToast('Batch validated \u2014 ready in the inQueue pool.');
        } else if (status === 'failed') {
          setStatus(`Batchly validation FAILED for "${folderName}"${finalState?.error ? ` (${finalState.error})` : ''}. The batch is safe in Drive \u2014 open Batchly \u2192 Batches to inspect it.`);
          showToast('Batchly validation failed \u2014 check Batchly.');
        } else {
          setStatus(`Batch handed to Batchly${notify.woke ? ' (woken from sleep)' : ''}; validation is still running \u2014 it will appear in the inQueue pool when done. Open Batchly \u2192 Batches to watch it.`);
        }
      } else {
        setStatus(`Batch exported to Drive, but the automatic Batchly scan did not go through (${notify.error || 'unknown error'}). The batch is safe in the pending-batches folder — open Batchly and click Scan Drive.`);
        showToast('Batch is in Drive; scan it from Batchly manually.');
      }
    } catch (error) {
      setStatus(`Batch exported to Drive, but Batchly could not be reached (${error.message}). The batch is safe — open Batchly and click Scan Drive.`);
    }
  } else {
    setExportProgress('Export complete', 100);
  }
  setTimeout(hideExportProgress, 4000);
  els.exportZipBtn.textContent = 'Export Batchly ZIP';
  renderExport();
  await refreshState();
  } catch (error) {
    // A consistency guard (e.g. the misconfigured-store abort) fired after the
    // Drive handoff. The batch is NOT marked exported — that only happens on the
    // success path above. Reset the button and surface the exact reason.
    hideExportProgress();
    els.exportZipBtn.textContent = 'Export Batchly ZIP';
    els.exportZipBtn.disabled = false;
    setStatus(error.message || 'Export failed while building the Batchly ZIP.');
    showToast(error.message || 'Export failed while building the Batchly ZIP.');
  }
}

function buildBatchInfo() {
  const perDesignOverrides = {};
  const selectedByDesign = {};
  state.uploadedDesigns.forEach(design => {
    selectedByDesign[design.id] = design.selectedMockups || [];
    if (design.selectionType === 'custom') {
      perDesignOverrides[design.id] = {
        selection_type: 'custom',
        selected_mockup_ids: design.selectedMockups || []
      };
    }
  });
  return {
    ...state.batch,
    exportedAt: new Date().toISOString(),
    active_mockup_preset_id: state.batch?.activeMockupPresetId || null,
    active_mockup_preset_name: state.batch?.activeMockupPresetName || null,
    applied_to_batch: Boolean(state.batch?.appliedMockupPresetToBatch),
    per_design_overrides: perDesignOverrides,
    selected_mockup_ids_per_design: selectedByDesign
  };
}

async function retryFailedDriveUploads() {
  if (!state.batch) return;
  els.retryDriveBtn.disabled = true;
  // Same binary path as export: top up any missing server-side sources, then
  // retry without shipping design bytes in the request body.
  await uploadSourceDesigns(state.batch.id, { onlyMissing: true }).catch(() => {});
  const response = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/retry-drive-failures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ retryOnly: true })
  });
  const data = await response.json();
  state.batch.driveExportReport = data.report;
  renderDriveExportStatus();
  els.retryDriveBtn.disabled = !data.report?.failures?.length;
  showToast(data.report?.status === 'completed' ? 'Drive retry completed.' : 'Drive retry still has failures.');
}

// Recovery for stale SKU reservations: re-scans Drive server-side and moves
// this batch onto the next safe SKU block. Read-only against Drive — no
// folders created, no PNGs uploaded, batch is not marked exported.
async function refreshSkuReservation() {
  if (!state.batch) return;
  els.refreshSkuBtn.disabled = true;
  const originalLabel = els.refreshSkuBtn.textContent;
  els.refreshSkuBtn.textContent = 'Re-scanning Drive...';
  try {
    const response = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/refresh-sku-reservation`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'SKU reservation refresh failed.');
    const previous = Object.values(data.previousReservedSkus || {})
      .flatMap(byStore => Object.values(byStore || {}).map(entry => entry.sku));
    Object.assign(state.batch, {
      reservedSkus: data.batch.reservedSkus,
      driveScanSnapshot: data.batch.driveScanSnapshot,
      driveReservedRanges: data.batch.driveReservedRanges,
      driveExportStatus: data.batch.driveExportStatus,
      driveExportReport: data.batch.driveExportReport,
      exportState: data.batch.exportState,
      activeStores: data.batch.activeStores,
      skuReservationRefreshedAt: data.batch.skuReservationRefreshedAt,
      updatedAt: data.batch.updatedAt
    });
    const ranges = Object.values(data.batch.driveReservedRanges || {})
      .map(range => `${range.storeName}: ${range.reservedStart}-${range.reservedEnd}`);
    renderExport();
    renderDriveRangeReport();
    renderIntake();
    setStatus(`SKU reservation refreshed. New reservation — ${ranges.join(' • ')}. Old reservation (${previous.join(', ') || 'none'}) released. No Drive folders or files were created.`);
    showToast('SKUs re-reserved from a fresh Drive scan.');
  } catch (error) {
    setStatus(`SKU reservation refresh failed: ${error.message}`);
    showToast(`SKU refresh failed: ${error.message}`);
    els.refreshSkuBtn.disabled = false;
  } finally {
    els.refreshSkuBtn.textContent = originalLabel;
  }
}

async function dryRunExport() {
  if (!state.batch) return showToast('No active batch.');
  els.dryRunBtn.disabled = true;
  els.dryRunBtn.textContent = 'Checking Drive...';
  if (els.dryRunReport) { els.dryRunReport.innerHTML = ''; els.dryRunReport.style.display = 'none'; }
  try {
    const response = await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/dry-run`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Dry run failed.');
    showDryRunResults(data.report);
    showToast(data.report.hasConflicts ? 'Dry run: conflicts detected.' : 'Dry run OK — no conflicts.');
  } catch (error) {
    showToast('Dry run error: ' + error.message);
  } finally {
    els.dryRunBtn.disabled = false;
    els.dryRunBtn.textContent = 'Dry Run Export';
  }
}

function showDryRunResults(report) {
  if (!els.dryRunReport || !report) return;
  const items = [];
  items.push(reportItem(report.hasConflicts ? 'error' : 'ok', `Dry Run — ${report.message}`));
  if (!report.hasConflicts) {
    items.push(reportItem('ok', 'Dry run complete. SKU numbers would be updated in Google Drive during a real export.'));
  }
  (report.conflicts || []).forEach(c => items.push(reportItem('error', c.message || JSON.stringify(c))));
  (report.wouldCreate || []).forEach(item => items.push(reportItem('ok', `Would create: ${item.storeName} / ${item.sku}`, `design: ${item.designId}`)));
  (report.wouldUpload || []).forEach(item => items.push(reportItem('ok', `Would upload: ${item.designFile} → ${item.storeName}/${item.sku}`)));
  els.dryRunReport.innerHTML = items.join('');
  els.dryRunReport.style.display = '';
}

async function clearOldBatches() {
  if (!window.confirm('Cancel all active batches? This releases their reserved SKUs. This cannot be undone.')) return;
  try {
    const response = await fetch('/api/batches/clear-old', { method: 'POST' });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Clear failed.');
    state.batch = null;
    state.uploadedDesigns = [];
    state.zipValidation = null;
    state.csvMetadata = new Map();
    await refreshState();
    showToast(`Cleared ${data.cleared} old batch(es). Ready for a fresh start.`);
    updateStats();
    renderExport();
  } catch (error) {
    showToast('Clear failed: ' + error.message);
  }
}

function renderStoreSettings() {
  els.storeSettingsList.innerHTML = '';
  if (els.hubConfigureLink) {
    const hub = (window.INQUEUE_CONFIG && window.INQUEUE_CONFIG.hubUrl) || '';
    els.hubConfigureLink.href = hub ? `${hub}/#configure` : '#';
  }
  // Store configuration lives in the inQueue Hub's Configure tab; this list is
  // a read-only readiness view. Sync state banner first:
  const banner = document.createElement('div');
  banner.className = 'settings-warnings';
  banner.style.gridColumn = '1 / -1';
  banner.setAttribute('role', 'note');
  if (state.settingsStatus?.configSource === 'hub') {
    banner.innerHTML = `<strong>Managed by the inQueue Hub.</strong> Store configuration is pushed from the Hub's Configure tab${
      state.settingsStatus?.hubConfig?.appliedAt
        ? ` (last sync ${new Date(state.settingsStatus.hubConfig.appliedAt).toLocaleString()})`
        : ' (no sync applied yet — run Sync now in the Hub)'
    }.`;
  } else {
    banner.innerHTML = `<strong>Hub sync not active on this service.</strong> Set <code>INQUEUE_STORE_CONFIG_SOURCE=hub</code> after the Hub's dry-run diff for Store_A comes back empty. Until then this service keeps its last local store configuration.`;
  }
  els.storeSettingsList.appendChild(banner);

  state.stores.forEach(store => {
    const report = state.settingsStatus?.stores?.find(item => item.id === store.id) || null;
    const readinessChip = !store.active
      ? statusChip('neutral', 'Inactive')
      : report
        ? (report.ready ? statusChip('ok', 'Ready') : statusChip('warn', 'Needs setup'))
        : '';
    const missingList = store.active && report && !report.ready
      ? `<div class="readiness-missing"><strong>Setup needed:</strong><ul>${report.missing.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
      : '';
    const lastDriveTest = report?.lastDriveTest
      ? `<span>Drive test: <strong>${report.lastDriveTest.ok ? 'passed' : 'failed'}</strong> · ${report.lastDriveTest.checkedAt ? new Date(report.lastDriveTest.checkedAt).toLocaleString() : ''}</span>`
      : '';
    const card = document.createElement('article');
    card.className = 'store-card';
    card.innerHTML = `
      <div class="connection-card-head"><div class="store-logo-preview">${store.logoUrl ? `<img src="${store.logoUrl}" alt="${escapeHtml(store.name)} logo">` : '<span>No logo</span>'}</div>${readinessChip}</div>
      <h3>${escapeHtml(store.name || store.id)}</h3>
      <div class="drive-card-status">
        <span>Batchly folder: <strong>${escapeHtml(store.store_folder || 'unassigned')}</strong></span>
        <span>SKU prefix: <strong>${escapeHtml(store.skuPrefix || '-')}</strong></span>
        <span>Drive folder: <strong>${store.skuRootFolderId ? (store.skuRootFolderId.startsWith('mock-drive-') ? 'placeholder' : 'configured') : 'not set'}</strong></span>
        <span>Latest detected: <strong>${escapeHtml(store.latestDetectedSku || 'Not scanned')}</strong></span>
        <span>Next SKU: <strong>${escapeHtml(store.nextSkuPreview || '-')}</strong></span>
        <span>Last scan: <strong>${store.lastSkuScanAt ? new Date(store.lastSkuScanAt).toLocaleString() : '-'}</strong></span>
        ${lastDriveTest}
        ${store.skuScanError ? `<span class="error-text">${escapeHtml(store.skuScanError)}</span>` : ''}
      </div>
      <div class="button-row">
        <button class="secondary-button scan-store-btn" type="button">Scan Latest SKU</button>
        <button class="ghost-button test-drive-btn" type="button">Test Connection</button>
      </div>
      ${missingList}
      ${store.active && store.skuRootFolderId?.startsWith('mock-drive-') ? `<div class="mock-drive-warn"><strong>Placeholder Drive folder.</strong> Set a real Google Drive folder ID for this store in the inQueue Hub → Configure.</div>` : ''}
    `;
    card.querySelector('.scan-store-btn').addEventListener('click', () => scanStoreDrive(store.id));
    card.querySelector('.test-drive-btn').addEventListener('click', () => scanStoreDrive(store.id, true));
    els.storeSettingsList.appendChild(card);
  });
}

async function scanStoreDrive(storeId, testOnly = false) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store?.skuRootFolderId) return showToast('Add a Drive SKU root folder ID first.');
  const response = await fetch(testOnly
    ? `/api/stores/${encodeURIComponent(storeId)}/test-drive`
    : `/api/stores/${encodeURIComponent(storeId)}/scan-sku`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    showToast(data.error || 'Drive scan failed.');
  } else {
    Object.assign(store, data.store);
    showToast(testOnly ? data.result.message : `Latest SKU: ${data.scan.latestSku || 'none'}`);
  }
  await refreshState();
}

async function persistMockupPresets() {
  const response = await fetch('/api/mockup-presets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presets: state.mockupPresets })
  });
  const data = await response.json();
  if (data.ok) {
    state.mockupPresets = data.presets;
    renderMockupPresetManager();
  }
}

function renderMockupPresetManager() {
  if (!els.mockupPresetList) return;
  els.mockupPresetList.innerHTML = '';
  if (!state.mockupPresets.length) {
    els.mockupPresetList.innerHTML = '<div class="grid-note">No mockup presets yet. Select mockups and click "Save Selected as Preset" to create one.</div>';
    return;
  }
  state.mockupPresets.forEach((preset, index) => {
    const isActive = state.batch?.activeMockupPresetId === preset.preset_id;
    const card = document.createElement('article');
    card.className = `preset-card${isActive ? ' active-preset' : ''}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    card.innerHTML = `
      <div class="preset-card-header">
        <div class="preset-card-title">
          <strong>${escapeHtml(preset.preset_name)}</strong>
          ${isActive ? '<span class="badge badge-good">Active</span>' : ''}
          ${preset.is_default ? '<span class="badge">Default</span>' : ''}
          <span class="badge badge-profile">${escapeHtml(variationProfileLabel(presetDesignType(preset)))}</span>
        </div>
        <span class="preset-meta">${preset.selected_mockup_ids.length} mockup${preset.selected_mockup_ids.length === 1 ? '' : 's'}</span>
      </div>
      <div class="button-row preset-actions">
        <button class="secondary-button edit-preset-btn" type="button">Edit Mockups</button>
        <button class="ghost-button delete-preset-btn" type="button">Delete</button>
      </div>
    `;
    // The whole card is the selector. Clicking the ALREADY-active card is a
    // no-op on purpose: applyPresetToBatch resets perDesignOverrides, and an
    // accidental re-click must never wipe manual per-design selections.
    const selectPreset = () => {
      if (!state.batch) return showToast('Load a batch first to apply a preset.');
      if (state.batch.activeMockupPresetId === preset.preset_id) return;
      const overrideCount = Object.keys(state.batch.perDesignOverrides || {}).length;
      if (overrideCount > 0) {
        const ok = window.confirm(
          `Switching presets clears custom mockup selections on ${overrideCount} design${overrideCount === 1 ? '' : 's'}. Continue?`,
        );
        if (!ok) return;
      }
      applyPresetToBatch(preset);
      renderMockupPresetManager();
    };
    card.addEventListener('click', selectPreset);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectPreset();
      }
    });
    card.querySelector('.edit-preset-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      openPresetEditor(preset);
    });
    card.querySelector('.delete-preset-btn').addEventListener('click', (event) => {
      event.stopPropagation();
      if (!window.confirm(`Delete preset "${preset.preset_name}"?`)) return;
      state.mockupPresets.splice(index, 1);
      persistMockupPresets();
    });
    els.mockupPresetList.appendChild(card);
  });
}

function openPresetEditor(preset, { isNew = false } = {}) {
  if (!state.blankMockups.length) return showToast('Load a batch first to see available mockups.');
  const modal = document.createElement('dialog');
  modal.className = 'edit-dialog preset-editor-dialog';
  const selectedSet = new Set(preset.selected_mockup_ids);
  // Count header
  const countId = `preset-count-${Date.now()}`;
  // New presets must have a design type CONSCIOUSLY chosen — no silent default.
  // The select opens on a disabled placeholder and Save is blocked until the
  // operator picks Front-sided or Double-sided. Existing/legacy presets keep
  // their current type (or migrate to front_sided via presetDesignType()).
  const currentType = presetDesignType(preset);
  const designTypeOptions = [
    isNew ? `<option value="" disabled selected>— Select design type —</option>` : '',
    ...VARIATION_PROFILES.map(p =>
      `<option value="${p.key}"${!isNew && currentType === p.key ? ' selected' : ''}>${escapeHtml(p.label)}</option>`),
  ].join('');
  modal.innerHTML = `
    <div class="editor-shell">
      <div class="editor-header">
        <div>
          <p class="eyebrow">${isNew ? 'New Preset' : 'Edit Preset'}</p>
          <h3>${escapeHtml(preset.preset_name)}</h3>
          <p class="preset-editor-count" id="${countId}"><span class="count-num">${selectedSet.size}</span> of ${state.blankMockups.length} selected</p>
        </div>
        <button class="icon-button close-preset-editor-btn" aria-label="Close">×</button>
      </div>
      <div class="preset-designtype-row">
        <label for="preset-designtype">Design type${isNew ? ' <span class="req">*</span>' : ''}</label>
        <select id="preset-designtype" class="preset-designtype-select">
          ${designTypeOptions}
        </select>
        <span class="help">Every design using this preset exports with this variation profile.</span>
      </div>
      <div class="preset-mockup-visual-grid">
        ${state.blankMockups.map(mockup => `
          <label class="preset-mockup-visual-card ${selectedSet.has(mockup.filename) ? 'selected' : ''}" data-filename="${escapeHtml(mockup.filename)}">
            <input type="checkbox" value="${escapeHtml(mockup.filename)}" ${selectedSet.has(mockup.filename) ? 'checked' : ''}>
            <div class="preset-mockup-thumb-wrap">
              <img class="preset-mockup-thumb" src="${escapeHtml(mockup.url)}" alt="${escapeHtml(mockup.name)}" loading="lazy" />
              <div class="preset-mockup-check-overlay" aria-hidden="true">✓</div>
            </div>
            <span class="preset-mockup-name">${escapeHtml(mockup.name)}</span>
          </label>
        `).join('')}
      </div>
      <div class="editor-footer">
        <button class="ghost-button cancel-preset-btn">Cancel</button>
        <button class="secondary-button select-all-preset-btn">Select All</button>
        <button class="secondary-button clear-all-preset-btn">Clear All</button>
        <button class="primary-button save-preset-editor-btn">Save Preset</button>
      </div>
    </div>
  `;
  const countEl = modal.querySelector(`#${countId} .count-num`);
  function updateCount() {
    const n = modal.querySelectorAll('input[type=checkbox]:checked').length;
    if (countEl) countEl.textContent = String(n);
  }
  modal.querySelectorAll('.preset-mockup-visual-card').forEach(card => {
    const cb = card.querySelector('input[type=checkbox]');
    cb.addEventListener('change', () => {
      card.classList.toggle('selected', cb.checked);
      updateCount();
    });
  });
  modal.querySelector('.close-preset-editor-btn').addEventListener('click', () => modal.close());
  modal.querySelector('.cancel-preset-btn').addEventListener('click', () => modal.close());
  modal.querySelector('.select-all-preset-btn').addEventListener('click', () => {
    modal.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = true;
      cb.closest('.preset-mockup-visual-card')?.classList.add('selected');
    });
    updateCount();
  });
  modal.querySelector('.clear-all-preset-btn').addEventListener('click', () => {
    modal.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.checked = false;
      cb.closest('.preset-mockup-visual-card')?.classList.remove('selected');
    });
    updateCount();
  });
  modal.querySelector('.save-preset-editor-btn').addEventListener('click', () => {
    const designType = modal.querySelector('#preset-designtype')?.value;
    const validType = VARIATION_PROFILES.some(p => p.key === designType);
    // Design type is mandatory for a NEW preset — force a conscious choice.
    if (isNew && !validType) {
      return showToast('Choose a design type (Front-sided or Double-sided) before saving.');
    }
    const checked = [...modal.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value);
    preset.selected_mockup_ids = checked;
    if (validType) preset.design_type = designType;
    preset.updated_at = new Date().toISOString();
    // A new preset is committed to state only on save, so cancelling adds nothing.
    if (isNew) {
      preset.is_default = state.mockupPresets.length === 0;
      state.mockupPresets.push(preset);
    }
    persistMockupPresets();
    // If this preset is the batch's active one, re-apply so its designs pick up
    // the new design type immediately (kept consistent with the manifest).
    if (state.batch?.activeMockupPresetId === preset.preset_id) applyPresetToBatch(preset, false);
    modal.close();
    showToast(`Preset "${preset.preset_name}" ${isNew ? 'created' : 'updated'} — ${checked.length} mockup${checked.length === 1 ? '' : 's'}, ${variationProfileLabel(presetDesignType(preset))}.`);
  });
  document.body.appendChild(modal);
  modal.addEventListener('close', () => modal.remove());
  modal.showModal();
}

function newEmptyPreset() {
  if (!state.blankMockups.length) return showToast('Load a batch first to see available mockups.');
  const name = window.prompt('Preset name', `Mockup Preset ${state.mockupPresets.length + 1}`);
  if (!name) return;
  const now = new Date().toISOString();
  // Draft only — not pushed to state until the editor's Save commits it (which
  // requires a consciously chosen design type). `design_type` is intentionally
  // left unset so the editor opens on the "— Select design type —" placeholder.
  const draft = {
    preset_id: cleanName(name),
    preset_name: name,
    selected_mockup_ids: [],
    is_default: false,
    created_at: now,
    updated_at: now,
    notes: ''
  };
  openPresetEditor(draft, { isNew: true });
}

async function cancelBatch() {
  if (!state.batch) return;
  await fetch(`/api/batches/${encodeURIComponent(state.batch.id)}/cancel`, { method: 'POST' });
  state.batch.status = 'Canceled';
  showToast('Batch canceled. Reserved SKUs were not committed.');
  updateStats();
  renderExport();
}

function bindEvents() {
  els.navTabs.forEach(button => button.addEventListener('click', () => switchPage(button.dataset.page)));
  if (els.refreshConnectionsBtn) els.refreshConnectionsBtn.addEventListener('click', () => refreshConnectionSettings().then(() => showToast('Connections refreshed.')));
  els.refreshAssetsBtn.addEventListener('click', () => refreshState().then(() => showToast('Assets refreshed.')));
  els.zipInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) validateZipFile(file).catch(error => {
      els.uploadSummary.textContent = error.message;
      els.createBatchBtn.disabled = true;
    });
  });
  ['dragenter', 'dragover'].forEach(eventName => {
    els.zipUploadZone.addEventListener(eventName, event => {
      event.preventDefault();
      els.zipUploadZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(eventName => {
    els.zipUploadZone.addEventListener(eventName, event => {
      event.preventDefault();
      els.zipUploadZone.classList.remove('dragover');
    });
  });
  els.zipUploadZone.addEventListener('drop', event => {
    const file = event.dataTransfer.files?.[0];
    if (file) validateZipFile(file).catch(error => {
      els.uploadSummary.textContent = error.message;
      els.createBatchBtn.disabled = true;
    });
  });
  els.createBatchBtn.addEventListener('click', createBatch);
  els.cancelBatchBtn.addEventListener('click', cancelBatch);
  els.titleDescription.addEventListener('input', () => {
    if (!els.titleDescription.readOnly) { saveCurrentIntake(false); renderIntake(); }
  });
  els.keywordsInput.addEventListener('input', () => {
    if (!els.keywordsInput.readOnly) { renderKeywordMeta(); saveCurrentIntake(false); }
  });
  els.prevIntakeBtn.addEventListener('click', () => {
    if (state.intakeEditMode) saveCurrentIntake(false);
    state.currentIntakeIndex = Math.max(0, state.currentIntakeIndex - 1);
    renderIntake();
  });
  if (els.editMetadataBtn) els.editMetadataBtn.addEventListener('click', toggleIntakeEditMode);
  els.nextIntakeBtn.addEventListener('click', goNextIntake);
  els.continueProductionBtn.addEventListener('click', startProduction);
  els.renderBtn.addEventListener('click', renderAllBlankMockups);
  if (els.selectPresetBtn) els.selectPresetBtn.addEventListener('click', selectPresetAction);
  if (els.previewAllBtn) els.previewAllBtn.addEventListener('click', previewAllAction);
  if (els.saveSelectionPresetBtn) els.saveSelectionPresetBtn.addEventListener('click', saveCurrentSelectionAsPreset);
  if (els.applyPresetBtn) els.applyPresetBtn.addEventListener('click', applyPresetToCurrentDesign);
  if (els.batchPresetBtn) els.batchPresetBtn.addEventListener('click', applyChosenPresetToBatch);
  if (els.applyRemainingPresetBtn) els.applyRemainingPresetBtn.addEventListener('click', applyChosenPresetToRemaining);
  if (els.revertPresetBtn) els.revertPresetBtn.addEventListener('click', revertCurrentDesignToBatchPreset);
  if (els.selectAllBtn) els.selectAllBtn.addEventListener('click', selectAllMockups);
  els.clearAllBtn.addEventListener('click', clearSelection);
  if (els.copyPreviousBtn) els.copyPreviousBtn.addEventListener('click', copyPreviousSelection);
  if (els.markReadyBtn) els.markReadyBtn.addEventListener('click', markDesignReady);
  if (els.moveToStampingBtn) els.moveToStampingBtn.addEventListener('click', moveToStampingPhase);
  if (els.moveToStampingTopBtn) els.moveToStampingTopBtn.addEventListener('click', moveToStampingPhase);
  if (els.runStampBtn) els.runStampBtn.addEventListener('click', runBatchStamping);
  els.dryRunBtn.addEventListener('click', dryRunExport);
  els.exportZipBtn.addEventListener('click', exportBatchZip);
  els.retryDriveBtn.addEventListener('click', retryFailedDriveUploads);
  els.refreshSkuBtn.addEventListener('click', refreshSkuReservation);
  if (els.connectDriveBtn) els.connectDriveBtn.addEventListener('click', connectDriveAction);
  if (els.disconnectDriveBtn) els.disconnectDriveBtn.addEventListener('click', disconnectDriveAction);
  if (els.resetBatchBtn) els.resetBatchBtn.addEventListener('click', resetBatchWorkflow);
  if (els.clearOldBatchesBtn) els.clearOldBatchesBtn.addEventListener('click', clearOldBatches);
  els.newPresetBtn.addEventListener('click', newEmptyPreset);
  els.closeEditorBtn.addEventListener('click', closeEditor);
  els.savePresetBtn.addEventListener('click', savePresetCurrent);
  els.saveEditorBtn.addEventListener('click', () => {
    if (state.editingIndex !== null) updateRenderedCard(state.editingIndex);
    closeEditor();
    showToast('Placement applied.');
  });
  els.downloadCurrentBtn.addEventListener('click', async () => {
    const index = state.editingIndex;
    if (index === null) return;
    const item = state.rendered[index];
    const entry = state.calibrationEntry;
    if (!item) return;
    const c = document.createElement('canvas');
    drawComposite(c, item, {
      storeLogo: entry?.storeLogoImage || null,
      freeShippingLogo: entry?.freeShippingImage || null,
      stampPlacements: entry?.stampPlacements || null
    });
    downloadBlob(await canvasToBlob(c, 'image/jpeg', 0.94), `${currentDesign()?.id || 'preview'}-${cleanName(item.mockup.name)}.jpg`);
  });
  els.scaleRange.addEventListener('input', event => {
    const item = getEditingItem();
    if (!item) return;
    applyScale(item, Number(event.target.value));
    syncEditorControls(item);
    drawEditor();
  });
  els.smallerBtn.addEventListener('click', () => resizeCurrent(-5));
  els.largerBtn.addEventListener('click', () => resizeCurrent(5));
  els.rotateLeftBtn.addEventListener('click', () => rotateCurrent(-3));
  els.rotateRightBtn.addEventListener('click', () => rotateCurrent(3));
  els.straightenBtn.addEventListener('click', () => {
    const item = getEditingItem();
    if (!item) return;
    applyRotation(item, 0);
    syncEditorControls(item);
    drawEditor();
  });
  document.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', () => nudgeCurrent(button.dataset.nudge, 5)));
  // Unified editor layer selector buttons
  if (els.layerDesignBtn) els.layerDesignBtn.addEventListener('click', () => setActiveEditorLayer('design'));
  if (els.layerStoreLogoBtn) els.layerStoreLogoBtn.addEventListener('click', () => setActiveEditorLayer('storeLogo'));
  if (els.layerShippingBtn) els.layerShippingBtn.addEventListener('click', () => setActiveEditorLayer('freeShipping'));
  // Legacy buttons (hidden but may still be called programmatically)
  if (els.editStoreLogoBtn) els.editStoreLogoBtn.addEventListener('click', () => setActiveEditorLayer('storeLogo'));
  if (els.editFreeShippingBtn) els.editFreeShippingBtn.addEventListener('click', () => setActiveEditorLayer('freeShipping'));
  els.saveStampPresetBtn.addEventListener('click', saveStampPresetCurrent);
  if (els.applyStampChangesBtn) els.applyStampChangesBtn.addEventListener('click', () => {
    closeEditor();
    showToast('Logo calibration applied.');
  });
  if (els.downloadStampedCurrentBtn) els.downloadStampedCurrentBtn.addEventListener('click', async () => {
    const entry = state.calibrationEntry;
    if (!entry) return;
    const c = document.createElement('canvas');
    drawComposite(c, entry.item, { storeLogo: entry.storeLogoImage, freeShippingLogo: entry.freeShippingImage, stampPlacements: entry.stampPlacements });
    downloadBlob(await canvasToBlob(c, 'image/jpeg', 0.94), `calibration-preview-${cleanName(entry.item.mockup.name)}.jpg`);
  });
  els.stampScaleRange.addEventListener('input', event => {
    const placement = getActiveStampPlacement();
    if (!placement) return;
    applyStampScale(placement, Number(event.target.value));
    syncStampEditorControls();
    drawStampEditor();
  });
  els.stampSmallerBtn.addEventListener('click', () => resizeActiveStamp(-5));
  els.stampLargerBtn.addEventListener('click', () => resizeActiveStamp(5));
  els.stampRotateLeftBtn.addEventListener('click', () => rotateActiveStamp(-3));
  els.stampRotateRightBtn.addEventListener('click', () => rotateActiveStamp(3));
  els.stampStraightenBtn.addEventListener('click', () => {
    const placement = getActiveStampPlacement();
    if (!placement) return;
    placement.rotationDeg = 0;
    syncStampEditorControls();
    drawStampEditor();
  });
  // Unified editor canvas: pointer events handle all layers
  if (els.editorCanvas) {
    els.editorCanvas.addEventListener('pointerdown', startUnifiedPointerInteraction);
    els.editorCanvas.addEventListener('pointermove', moveUnifiedPointerInteraction);
    els.editorCanvas.addEventListener('pointerup', endUnifiedPointerInteraction);
    els.editorCanvas.addEventListener('pointercancel', endUnifiedPointerInteraction);
  }
  window.addEventListener('keydown', event => {
    const amount = event.shiftKey ? 16 : 4;
    const keyMap = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (!keyMap[event.key]) return;
    if (!els.editDialog.open) return;
    event.preventDefault();
    if (state.editorActiveLayer === 'design') {
      nudgeCurrent(keyMap[event.key], amount);
    } else {
      nudgeActiveStamp(keyMap[event.key], amount);
    }
  });
}

bindEvents();
document.documentElement.dataset.zipSupport = window.JSZip ? 'ready' : 'missing';
refreshState().then(() => {
  setStatus('Upload a ZIP batch to begin.');
}).catch(error => {
  console.error(error);
  setStatus('Could not load Preply assets. Make sure the local server is running.');
});
