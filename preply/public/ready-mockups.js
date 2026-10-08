// ---------------------------------------------------------------------------
// Ready Mockups — stamp-only workflow (browser side).
//
// Mockups are held only in this tab; every composite and the final ZIP are
// built here. The server stores just the logo library and the default logo
// placement (/api/ready-stamp/*). Nothing here touches batches, SKUs, or Drive.
//
// Placement model (shared with the server): center + box are fractions of the
// mockup's width/height, rotation is in degrees. A logo is scaled to fit inside
// the box (aspect preserved) and pinned to the box's anchor edge.
// ---------------------------------------------------------------------------
(function () {
  'use strict';

  const LOGO_MAX_SIDE = 1600;          // logos are downscaled to this before upload
  const LOGO_MAX_UPLOAD_BYTES = 3.8 * 1024 * 1024;
  const THUMB_MAX_SIDE = 360;
  const SNAP_MARGIN = 0.035;           // 3.5% inset, same as Preply's default stamp
  const NUDGE_STEP = 0.005;
  const MIN_BOX = 0.02;
  const MAX_BOX = 1.2;
  const JPEG_QUALITY = 0.95;
  const WEBP_QUALITY = 0.95;
  const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const DEFAULT_PLACEMENT = { center: { x: 0.875, y: 0.095 }, box: { width: 0.18, height: 0.12 }, rotationDeg: 0 };
  const DEFAULT_ALIGN = { x: 'right', y: 'top' };

  const $ = (id) => document.getElementById(id);
  const els = {
    statMockups: $('statMockups'), statLogos: $('statLogos'), statOutput: $('statOutput'),
    logoGrid: $('logoGrid'), logoEmpty: $('logoEmpty'),
    uploadLogosBtn: $('uploadLogosBtn'), importStoreLogosBtn: $('importStoreLogosBtn'),
    logoFileInput: $('logoFileInput'), logoReplaceInput: $('logoReplaceInput'),
    mockupDrop: $('mockupDrop'), mockupGrid: $('mockupGrid'), mockupFileInput: $('mockupFileInput'),
    addMockupsBtn: $('addMockupsBtn'), clearMockupsBtn: $('clearMockupsBtn'),
    editorCanvas: $('editorCanvas'), editorEmpty: $('editorEmpty'),
    previewLogoSelect: $('previewLogoSelect'), sizeRange: $('sizeRange'), sizeValue: $('sizeValue'),
    rotationRange: $('rotationRange'), rotationValue: $('rotationValue'),
    scopeNote: $('scopeNote'), clearOverrideBtn: $('clearOverrideBtn'),
    resetPlacementBtn: $('resetPlacementBtn'), saveStatus: $('saveStatus'),
    exportSummary: $('exportSummary'), stampAllBtn: $('stampAllBtn'), cancelStampBtn: $('cancelStampBtn'),
    progressWrap: $('progressWrap'), progressFill: $('progressFill'), progressText: $('progressText'),
    toast: $('toast'),
  };

  const state = {
    logos: [],                 // server records (no image bytes)
    logoImages: new Map(),     // logo id -> { version, img }
    mockups: [],               // { id, name, blob, type, width, height, thumb }
    selectedMockupId: null,
    previewLogoId: null,
    global: { placement: clone(DEFAULT_PLACEMENT), align: { ...DEFAULT_ALIGN } },
    overrides: new Map(),      // mockup id -> { placement, align }  (this tab only)
    scope: 'all',
    editorImage: null,         // { mockupId, base: canvas at display resolution }
    drag: null,
    replaceTargetId: null,
    logosLoaded: false,
    exporting: false,
    cancelRequested: false,
  };
  let mockupSeq = 0;

  // ── Utilities ─────────────────────────────────────────────────────────────
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function round5(n) { return Math.round(n * 1e5) / 1e5; }

  let toastTimer = null;
  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3800);
  }

  async function api(path, options = {}) {
    const init = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (options.body !== undefined && typeof options.body !== 'string') {
      init.body = JSON.stringify(options.body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 401) throw new Error('Your session expired — reload the page to sign in again.');
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
    return data;
  }

  function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase(); }
  function stemOf(name) { return String(name).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''); }
  function naturalCompare(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
      img.src = url;
    });
  }

  function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load logo image.'));
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))), type, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(blob);
    });
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  // Bounding box of the non-transparent pixels. Trimming invisible padding makes
  // every logo's visible edge line up with the placement box.
  function opaqueBounds(ctx, width, height) {
    const { data } = ctx.getImageData(0, 0, width, height);
    let top = -1, bottom = -1, left = width, right = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > 8) {
          if (top === -1) top = y;
          bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    if (top === -1) return null;
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }

  // Downscale + trim a logo in the browser so the library stays small.
  async function prepareLogo(blob) {
    const { img, revoke } = await loadImageFromBlob(blob);
    try {
      let maxSide = LOGO_MAX_SIDE;
      for (let attempt = 0; attempt < 4; attempt++) {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const bounds = opaqueBounds(ctx, canvas.width, canvas.height);
        if (!bounds) throw new Error('This logo is completely transparent.');
        let out = canvas;
        if (bounds.w < canvas.width || bounds.h < canvas.height) {
          out = makeCanvas(bounds.w, bounds.h);
          out.getContext('2d').drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
        }
        const png = await canvasToBlob(out, 'image/png');
        if (png.size <= LOGO_MAX_UPLOAD_BYTES) {
          return { dataUrl: await blobToDataUrl(png), width: out.width, height: out.height };
        }
        maxSide = Math.round(maxSide * 0.7);
      }
      throw new Error('This logo is too detailed to store — try a smaller file.');
    } finally {
      revoke();
    }
  }

  function cleanStoreName(raw) {
    return String(raw).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60);
  }

  function uniqueStoreName(base) {
    const cleaned = cleanStoreName(base) || 'Store';
    const taken = new Set(state.logos.map((logo) => logo.storeName.toLowerCase()));
    if (!taken.has(cleaned.toLowerCase())) return cleaned;
    for (let n = 2; n < 1000; n++) {
      const candidate = `${cleaned.slice(0, 56)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${cleaned.slice(0, 50)} ${Date.now() % 10000}`;
  }

  // ── Placement math ────────────────────────────────────────────────────────
  function placementFor(mockupId) {
    return state.overrides.get(mockupId) || state.global;
  }

  // Logo rectangle in the box's local (unrotated) frame, in pixels of a W×H surface.
  function logoGeometry(entry, W, H, img) {
    const p = entry.placement;
    const boxW = p.box.width * W;
    const boxH = p.box.height * H;
    const iw = img ? img.naturalWidth || img.width : boxW;
    const ih = img ? img.naturalHeight || img.height : boxH;
    const fit = Math.min(boxW / iw, boxH / ih);
    const w = iw * fit;
    const h = ih * fit;
    const align = entry.align || DEFAULT_ALIGN;
    const ox = align.x === 'left' ? -boxW / 2 + w / 2 : align.x === 'right' ? boxW / 2 - w / 2 : 0;
    const oy = align.y === 'top' ? -boxH / 2 + h / 2 : align.y === 'bottom' ? boxH / 2 - h / 2 : 0;
    return { cx: p.center.x * W, cy: p.center.y * H, boxW, boxH, w, h, ox, oy, rad: (p.rotationDeg || 0) * Math.PI / 180 };
  }

  function drawLogo(ctx, img, entry, W, H) {
    if (!img) return;
    const g = logoGeometry(entry, W, H, img);
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rad);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, g.ox - g.w / 2, g.oy - g.h / 2, g.w, g.h);
    ctx.restore();
  }

  function toLocal(point, g) {
    const dx = point.x - g.cx;
    const dy = point.y - g.cy;
    const c = Math.cos(-g.rad);
    const s = Math.sin(-g.rad);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function editableEntry() {
    if (state.scope === 'mockup' && state.selectedMockupId) {
      return state.overrides.get(state.selectedMockupId) || clone(state.global);
    }
    return state.global;
  }

  // Every edit goes through here so the editor, thumbnails, controls, and the
  // autosave all stay in sync.
  function updatePlacement(mutate, { save = true } = {}) {
    const entry = clone(editableEntry());
    mutate(entry);
    entry.placement.center.x = clamp(entry.placement.center.x, 0, 1);
    entry.placement.center.y = clamp(entry.placement.center.y, 0, 1);
    entry.placement.rotationDeg = clamp(Math.round(entry.placement.rotationDeg * 10) / 10, -180, 180);
    if (state.scope === 'mockup' && state.selectedMockupId) {
      state.overrides.set(state.selectedMockupId, entry);
    } else {
      state.global = entry;
      if (save) scheduleSave();
    }
    renderPlacementViews();
  }

  function editorAspect() {
    const base = state.editorImage?.base;
    return base ? base.width / base.height : 1;
  }

  // The point (in half-box units, -1..1) that stays put while resizing: the
  // anchor, so a logo snapped to a corner grows away from that corner instead
  // of past the mockup edge.
  function anchorPivot(entry) {
    const align = entry.align || DEFAULT_ALIGN;
    return {
      x: align.x === 'left' ? -1 : align.x === 'right' ? 1 : 0,
      y: align.y === 'top' ? -1 : align.y === 'bottom' ? 1 : 0,
    };
  }

  // Scale the box by `factor`, keeping `pivot` (half-box units in the box's own
  // rotated frame) fixed on the mockup. `aspect` = mockup width / height, so the
  // math runs in true pixel proportions even though placement is normalized.
  function scaleAbout(entry, factor, pivot, aspect) {
    const p = entry.placement;
    let f = factor;
    f = Math.max(f, MIN_BOX / p.box.width, MIN_BOX / p.box.height);
    f = Math.min(f, MAX_BOX / p.box.width, MAX_BOX / p.box.height);
    const bw = p.box.width * aspect;
    const bh = p.box.height;
    const ox = pivot.x * bw / 2;
    const oy = pivot.y * bh / 2;
    const rad = (p.rotationDeg || 0) * Math.PI / 180;
    const wx = ox * Math.cos(rad) - oy * Math.sin(rad);
    const wy = ox * Math.sin(rad) + oy * Math.cos(rad);
    p.center.x += (1 - f) * wx / aspect;
    p.center.y += (1 - f) * wy;
    p.box.width *= f;
    p.box.height *= f;
  }

  function snapTo(entry, position) {
    const p = entry.placement;
    const halfW = p.box.width / 2;
    const halfH = p.box.height / 2;
    const [vertical, horizontal] = position === 'center' ? ['center', 'center'] : position.split('-');
    p.center.x = horizontal === 'left' ? SNAP_MARGIN + halfW : horizontal === 'right' ? 1 - SNAP_MARGIN - halfW : 0.5;
    p.center.y = vertical === 'top' ? SNAP_MARGIN + halfH : vertical === 'bottom' ? 1 - SNAP_MARGIN - halfH : 0.5;
    entry.align = { x: horizontal, y: vertical };
  }

  // ── Autosave (all-mockups placement only) ─────────────────────────────────
  let saveTimer = null;
  let savePending = false;
  function setSaveStatus(text, kind = '') {
    els.saveStatus.textContent = text;
    els.saveStatus.className = `rm-save-status${kind ? ` is-${kind}` : ''}`;
  }
  function scheduleSave() {
    savePending = true;
    setSaveStatus('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }
  async function saveNow() {
    const { placement, align } = state.global;
    const body = {
      placement: {
        center: { x: round5(placement.center.x), y: round5(placement.center.y) },
        box: { width: round5(placement.box.width), height: round5(placement.box.height) },
        rotationDeg: placement.rotationDeg,
      },
      align,
    };
    try {
      await api('/api/ready-stamp/settings', { method: 'PUT', body });
      savePending = false;
      setSaveStatus('Placement saved', 'ok');
    } catch (error) {
      setSaveStatus('Not saved — will retry on your next change', 'bad');
      toast(error.message);
    }
  }

  // ── Logos ────────────────────────────────────────────────────────────────
  async function loadLogos() {
    const { logos } = await api('/api/ready-stamp/logos');
    state.logos = logos;
    state.logosLoaded = true;
    await ensureLogoImages();
  }

  async function ensureLogoImages() {
    await Promise.all(state.logos.map(async (logo) => {
      const cached = state.logoImages.get(logo.id);
      if (cached && cached.version === logo.updatedAt) return;
      try {
        const img = await loadImageFromUrl(logo.url);
        state.logoImages.set(logo.id, { version: logo.updatedAt, img });
      } catch {
        state.logoImages.delete(logo.id);
      }
    }));
    for (const id of [...state.logoImages.keys()]) {
      if (!state.logos.some((logo) => logo.id === id)) state.logoImages.delete(id);
    }
  }

  function includedLogos() {
    return state.logos.filter((logo) => logo.enabled && state.logoImages.has(logo.id));
  }

  function logoImage(id) { return state.logoImages.get(id)?.img || null; }

  function upsertLogo(record) {
    const index = state.logos.findIndex((logo) => logo.id === record.id);
    if (index === -1) state.logos.push(record);
    else state.logos[index] = record;
  }

  function formatBytes(bytes) {
    if (!bytes) return '';
    return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function renderLogos() {
    els.logoGrid.replaceChildren();
    els.logoEmpty.hidden = !state.logosLoaded || state.logos.length > 0;
    for (const logo of state.logos) {
      const card = document.createElement('article');
      card.className = `rm-logo-card${logo.enabled ? '' : ' is-off'}`;

      const thumb = document.createElement('div');
      thumb.className = 'rm-logo-thumb rm-checker';
      const img = document.createElement('img');
      img.src = logo.url;
      img.alt = `${logo.storeName} logo`;
      thumb.append(img);

      const name = document.createElement('input');
      name.className = 'rm-logo-name';
      name.value = logo.storeName;
      name.maxLength = 60;
      name.setAttribute('aria-label', 'Store name (folder name in the ZIP)');
      name.addEventListener('keydown', (event) => { if (event.key === 'Enter') name.blur(); });
      name.addEventListener('change', () => renameLogo(logo.id, name));

      const meta = document.createElement('div');
      meta.className = 'rm-logo-meta';
      const include = document.createElement('label');
      include.className = 'rm-include';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = logo.enabled;
      checkbox.addEventListener('change', () => toggleLogo(logo.id, checkbox));
      include.append(checkbox, document.createTextNode('Include'));
      const size = document.createElement('small');
      size.textContent = [logo.width && logo.height ? `${logo.width}×${logo.height}` : '', formatBytes(logo.bytes)].filter(Boolean).join(' · ');
      meta.append(include, size);

      const actions = document.createElement('div');
      actions.className = 'rm-logo-actions';
      const replace = document.createElement('button');
      replace.type = 'button';
      replace.className = 'ghost-button';
      replace.textContent = 'Replace';
      replace.addEventListener('click', () => {
        state.replaceTargetId = logo.id;
        els.logoReplaceInput.value = '';
        els.logoReplaceInput.click();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost-button rm-danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteLogo(logo));
      actions.append(replace, remove);

      card.append(thumb, name, meta, actions);
      els.logoGrid.append(card);
    }
    renderPreviewLogoSelect();
    renderSummary();
  }

  function renderPreviewLogoSelect() {
    const select = els.previewLogoSelect;
    const logos = state.logos.filter((logo) => state.logoImages.has(logo.id));
    if (!logos.some((logo) => logo.id === state.previewLogoId)) {
      state.previewLogoId = (logos.find((logo) => logo.enabled) || logos[0])?.id || null;
    }
    select.replaceChildren();
    if (!logos.length) {
      const option = document.createElement('option');
      option.textContent = 'No logos yet';
      select.append(option);
      select.disabled = true;
    } else {
      for (const logo of logos) {
        const option = document.createElement('option');
        option.value = logo.id;
        option.textContent = logo.enabled ? logo.storeName : `${logo.storeName} (not included)`;
        option.selected = logo.id === state.previewLogoId;
        select.append(option);
      }
      select.disabled = false;
    }
    renderPlacementViews();
  }

  // Large logos take a moment each to downscale, so show progress on the button
  // and render every logo as soon as it's saved.
  function setLogoBusy(button, text) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    els.uploadLogosBtn.disabled = Boolean(text);
    els.importStoreLogosBtn.disabled = Boolean(text);
    button.textContent = text || button.dataset.label;
  }

  async function addLogoAndRender(storeName, blob) {
    const prepared = await prepareLogo(blob);
    const { logo } = await api('/api/ready-stamp/logos', {
      method: 'POST',
      body: { storeName: uniqueStoreName(storeName), ...prepared },
    });
    upsertLogo(logo);
    await ensureLogoImages();
    renderLogos();
  }

  async function uploadLogoFiles(files) {
    const list = [...files].filter((file) => IMAGE_TYPES[extOf(file.name)]);
    if (!list.length) return toast('Choose PNG, JPG, or WebP logo files.');
    let added = 0;
    try {
      for (const [index, file] of list.entries()) {
        setLogoBusy(els.uploadLogosBtn, `Adding ${index + 1} of ${list.length}…`);
        try {
          await addLogoAndRender(stemOf(file.name), file);
          added += 1;
        } catch (error) {
          toast(`${file.name}: ${error.message}`);
        }
      }
    } finally {
      setLogoBusy(els.uploadLogosBtn, '');
    }
    if (added) toast(`Added ${added} logo${added === 1 ? '' : 's'}. Rename them to the exact store names you want as folders.`);
  }

  async function importStoreLogos() {
    setLogoBusy(els.importStoreLogosBtn, 'Checking Store Settings…');
    try {
      const { sources } = await api('/api/ready-stamp/store-logo-sources');
      const existing = new Set(state.logos.map((logo) => logo.storeName.toLowerCase()));
      const fresh = sources.filter((source) => !existing.has(cleanStoreName(source.storeName).toLowerCase()));
      if (!sources.length) return toast('No store logos are set up in Store Settings yet.');
      if (!fresh.length) return toast('Every Store Settings logo is already in the library.');
      let added = 0;
      for (const [index, source] of fresh.entries()) {
        setLogoBusy(els.importStoreLogosBtn, `Importing ${index + 1} of ${fresh.length}…`);
        try {
          const res = await fetch(source.url, { credentials: 'same-origin' });
          if (!res.ok) throw new Error(`could not download (${res.status})`);
          await addLogoAndRender(source.storeName, await res.blob());
          added += 1;
        } catch (error) {
          toast(`${source.storeName}: ${error.message}`);
        }
      }
      if (added) toast(`Imported ${added} store logo${added === 1 ? '' : 's'}.`);
    } catch (error) {
      toast(error.message);
    } finally {
      setLogoBusy(els.importStoreLogosBtn, '');
    }
  }

  async function renameLogo(id, input) {
    const logo = state.logos.find((item) => item.id === id);
    if (!logo) return;
    const next = input.value.replace(/\s+/g, ' ').trim();
    if (next === logo.storeName) { input.value = logo.storeName; return; }
    try {
      const { logo: saved } = await api(`/api/ready-stamp/logos/${encodeURIComponent(id)}`, { method: 'PATCH', body: { storeName: next } });
      upsertLogo(saved);
      input.removeAttribute('aria-invalid');
      input.value = saved.storeName;
      renderPreviewLogoSelect();
      renderSummary();
    } catch (error) {
      input.setAttribute('aria-invalid', 'true');
      input.value = logo.storeName;
      toast(error.message);
      setTimeout(() => input.removeAttribute('aria-invalid'), 2500);
    }
  }

  async function toggleLogo(id, checkbox) {
    try {
      const { logo } = await api(`/api/ready-stamp/logos/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled: checkbox.checked } });
      upsertLogo(logo);
      renderLogos();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      toast(error.message);
    }
  }

  async function replaceLogo(id, file) {
    try {
      const prepared = await prepareLogo(file);
      const { logo } = await api(`/api/ready-stamp/logos/${encodeURIComponent(id)}`, { method: 'PATCH', body: prepared });
      upsertLogo(logo);
      await ensureLogoImages();
      renderLogos();
      toast(`Replaced the ${logo.storeName} logo.`);
    } catch (error) {
      toast(error.message);
    }
  }

  async function deleteLogo(logo) {
    if (!window.confirm(`Delete the "${logo.storeName}" logo from the library?`)) return;
    try {
      await api(`/api/ready-stamp/logos/${encodeURIComponent(logo.id)}`, { method: 'DELETE' });
      state.logos = state.logos.filter((item) => item.id !== logo.id);
      state.logoImages.delete(logo.id);
      renderLogos();
    } catch (error) {
      toast(error.message);
    }
  }

  // ── Mockups ──────────────────────────────────────────────────────────────
  function uniqueMockupName(name) {
    const taken = new Set(state.mockups.map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const stem = stemOf(name);
    const ext = extOf(name);
    for (let n = 2; n < 10000; n++) {
      const candidate = `${stem} (${n}).${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${stem}-${Date.now()}.${ext}`;
  }

  async function collectMockupInputs(files) {
    const items = [];
    let skipped = 0;
    for (const file of files) {
      const ext = extOf(file.name);
      if (ext === 'zip' || file.type === 'application/zip') {
        if (!window.JSZip) throw new Error('ZIP support is not available — reload the page.');
        const zip = await window.JSZip.loadAsync(file);
        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        for (const entry of entries) {
          const base = entry.name.split('/').pop();
          if (!base || base.startsWith('.') || entry.name.includes('__MACOSX/')) continue;
          const type = IMAGE_TYPES[extOf(base)];
          if (!type) { skipped += 1; continue; }
          const data = await entry.async('blob');
          items.push({ name: base, blob: new Blob([data], { type }), type });
        }
      } else if (IMAGE_TYPES[ext]) {
        items.push({ name: file.name, blob: file, type: IMAGE_TYPES[ext] });
      } else {
        skipped += 1;
      }
    }
    return { items, skipped };
  }

  async function addMockups(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    els.addMockupsBtn.disabled = true;
    try {
      const { items, skipped } = await collectMockupInputs(files);
      let added = 0;
      for (const item of items) {
        try {
          const { img, revoke } = await loadImageFromBlob(item.blob);
          const scale = Math.min(1, THUMB_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
          const thumb = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
          const ctx = thumb.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, thumb.width, thumb.height);
          const mockup = {
            id: `m${++mockupSeq}`,
            name: uniqueMockupName(item.name),
            blob: item.blob,
            type: item.type,
            width: img.naturalWidth,
            height: img.naturalHeight,
            thumb,
          };
          revoke();
          state.mockups.push(mockup);
          added += 1;
        } catch {
          toast(`${item.name}: could not read this image.`);
        }
      }
      state.mockups.sort((a, b) => naturalCompare(a.name, b.name));
      if (!state.selectedMockupId && state.mockups.length) state.selectedMockupId = state.mockups[0].id;
      renderMockups();
      await loadEditorImage();
      const parts = [`Added ${added} mockup${added === 1 ? '' : 's'}`];
      if (skipped) parts.push(`skipped ${skipped} non-image file${skipped === 1 ? '' : 's'}`);
      toast(`${parts.join(', ')}.`);
    } catch (error) {
      toast(error.message);
    } finally {
      els.addMockupsBtn.disabled = false;
    }
  }

  function removeMockup(id) {
    state.mockups = state.mockups.filter((m) => m.id !== id);
    state.overrides.delete(id);
    if (state.selectedMockupId === id) {
      state.selectedMockupId = state.mockups[0]?.id || null;
      loadEditorImage();
    }
    renderMockups();
  }

  const thumbCanvases = new Map();
  function renderMockups() {
    els.mockupGrid.replaceChildren();
    thumbCanvases.clear();
    for (const mockup of state.mockups) {
      const card = document.createElement('div');
      card.className = `rm-mockup${mockup.id === state.selectedMockupId ? ' is-selected' : ''}`;
      card.dataset.id = mockup.id;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.setAttribute('aria-pressed', String(mockup.id === state.selectedMockupId));
      card.setAttribute('aria-label', `Edit placement on ${mockup.name}`);
      const canvas = makeCanvas(mockup.thumb.width, mockup.thumb.height);
      thumbCanvases.set(mockup.id, canvas);
      const name = document.createElement('span');
      name.className = 'rm-mockup-name';
      name.textContent = mockup.name;
      name.title = `${mockup.name} · ${mockup.width}×${mockup.height}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rm-mockup-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${mockup.name}`);
      remove.addEventListener('click', (event) => { event.stopPropagation(); removeMockup(mockup.id); });
      card.append(canvas, name, remove);
      if (state.overrides.has(mockup.id)) {
        const badge = document.createElement('span');
        badge.className = 'rm-mockup-badge';
        badge.textContent = 'Custom';
        card.append(badge);
      }
      const select = () => selectMockup(mockup.id);
      card.addEventListener('click', select);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
      });
      els.mockupGrid.append(card);
    }
    els.clearMockupsBtn.disabled = !state.mockups.length;
    drawThumbnails();
    renderSummary();
  }

  function drawThumbnails() {
    const img = logoImage(state.previewLogoId);
    for (const mockup of state.mockups) {
      const canvas = thumbCanvases.get(mockup.id);
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(mockup.thumb, 0, 0);
      drawLogo(ctx, img, placementFor(mockup.id), canvas.width, canvas.height);
    }
  }

  async function selectMockup(id) {
    if (id === state.selectedMockupId) return;
    state.selectedMockupId = id;
    renderMockups();
    await loadEditorImage();
  }

  // ── Editor ───────────────────────────────────────────────────────────────
  let editorLoadToken = 0;
  async function loadEditorImage() {
    const mockup = state.mockups.find((m) => m.id === state.selectedMockupId);
    const token = ++editorLoadToken;
    if (!mockup) {
      state.editorImage = null;
      renderPlacementViews();
      return;
    }
    const { img, revoke } = await loadImageFromBlob(mockup.blob);
    if (token !== editorLoadToken) { revoke(); return; }
    // Keep a display-resolution copy; full resolution is only needed at export.
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const base = makeCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
    const ctx = base.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, base.width, base.height);
    revoke();
    state.editorImage = { mockupId: mockup.id, base };
    renderPlacementViews();
  }

  function editorCssSize() {
    const base = state.editorImage?.base;
    if (!base) return null;
    const wrap = els.editorCanvas.parentElement;
    const maxW = Math.max(200, wrap.clientWidth - 24);
    const maxH = Math.max(240, Math.round(window.innerHeight * 0.68));
    const scale = Math.min(maxW / base.width, maxH / base.height, 2);
    return { w: Math.round(base.width * scale), h: Math.round(base.height * scale) };
  }

  function drawEditor() {
    const canvas = els.editorCanvas;
    const size = editorCssSize();
    const ready = Boolean(size);
    canvas.hidden = !ready;
    els.editorEmpty.hidden = ready;
    if (!ready) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      canvas.style.width = `${size.w}px`;
      canvas.style.height = `${size.h}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.editorImage.base, 0, 0, size.w, size.h);
    const entry = placementFor(state.selectedMockupId);
    const img = logoImage(state.previewLogoId);
    drawLogo(ctx, img, entry, size.w, size.h);

    // Placement box + resize handle.
    const g = logoGeometry(entry, size.w, size.h, img);
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rad);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(143, 182, 255, 0.95)';
    ctx.strokeRect(-g.boxW / 2, -g.boxH / 2, g.boxW, g.boxH);
    ctx.setLineDash([]);
    ctx.fillStyle = '#8fb6ff';
    ctx.strokeStyle = '#0a0b0d';
    ctx.beginPath();
    ctx.rect(g.boxW / 2 - 6, g.boxH / 2 - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function editorPoint(event) {
    const rect = els.editorCanvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, W: rect.width, H: rect.height };
  }

  function onEditorPointerDown(event) {
    if (!state.editorImage || event.button !== 0) return;
    const pt = editorPoint(event);
    const entry = placementFor(state.selectedMockupId);
    const g = logoGeometry(entry, pt.W, pt.H, logoImage(state.previewLogoId));
    const local = toLocal(pt, g);
    const onHandle = Math.abs(local.x - g.boxW / 2) <= 12 && Math.abs(local.y - g.boxH / 2) <= 12;
    const inside = Math.abs(local.x) <= g.boxW / 2 && Math.abs(local.y) <= g.boxH / 2;
    els.editorCanvas.setPointerCapture(event.pointerId);
    els.editorCanvas.classList.add('is-moving');
    if (onHandle) {
      // Handle is the bottom-right corner; the opposite (top-left) corner stays put.
      state.drag = { mode: 'resize', startEntry: clone(entry) };
    } else {
      if (!inside) {
        // Click outside the box: move the logo straight to the clicked spot.
        updatePlacement((e) => { e.placement.center.x = pt.x / pt.W; e.placement.center.y = pt.y / pt.H; }, { save: false });
      }
      state.drag = { mode: 'move', start: pt, startCenter: { ...placementFor(state.selectedMockupId).placement.center } };
    }
    event.preventDefault();
  }

  function onEditorPointerMove(event) {
    if (!state.drag) return;
    const pt = editorPoint(event);
    const drag = state.drag;
    if (drag.mode === 'move') {
      updatePlacement((e) => {
        e.placement.center.x = drag.startCenter.x + (pt.x - drag.start.x) / pt.W;
        e.placement.center.y = drag.startCenter.y + (pt.y - drag.start.y) / pt.H;
      }, { save: false });
    } else {
      // Project the pointer onto the box diagonal measured from the fixed corner.
      const g = logoGeometry(drag.startEntry, pt.W, pt.H, null);
      const local = toLocal(pt, g);
      const rx = local.x + g.boxW / 2;
      const ry = local.y + g.boxH / 2;
      const factor = Math.max(0.05, (rx * g.boxW + ry * g.boxH) / (g.boxW * g.boxW + g.boxH * g.boxH));
      updatePlacement((e) => {
        e.placement = clone(drag.startEntry.placement);
        scaleAbout(e, factor, { x: -1, y: -1 }, pt.W / pt.H);
      }, { save: false });
    }
  }

  function onEditorPointerUp(event) {
    if (!state.drag) return;
    state.drag = null;
    els.editorCanvas.classList.remove('is-moving');
    if (els.editorCanvas.hasPointerCapture(event.pointerId)) els.editorCanvas.releasePointerCapture(event.pointerId);
    if (state.scope === 'all') scheduleSave();
  }

  function nudge(direction, big) {
    const step = NUDGE_STEP * (big ? 4 : 1);
    updatePlacement((e) => {
      if (direction === 'up') e.placement.center.y -= step;
      if (direction === 'down') e.placement.center.y += step;
      if (direction === 'left') e.placement.center.x -= step;
      if (direction === 'right') e.placement.center.x += step;
    });
  }

  function syncControls() {
    const entry = editableEntry();
    const sizePct = Math.round(entry.placement.box.width * 1000) / 10;
    els.sizeRange.value = String(clamp(sizePct, 2, 100));
    els.sizeValue.textContent = `${sizePct}%`;
    els.rotationRange.value = String(entry.placement.rotationDeg);
    els.rotationValue.textContent = `${entry.placement.rotationDeg}°`;
    const align = entry.align || DEFAULT_ALIGN;
    document.querySelectorAll('.rm-anchor button').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.ax === align.x && button.dataset.ay === align.y));
    });
    document.querySelectorAll('.rm-segmented button').forEach((button) => {
      button.setAttribute('aria-checked', String(button.dataset.scope === state.scope));
    });
    const customCount = state.overrides.size;
    const selectedCustom = state.overrides.has(state.selectedMockupId);
    els.clearOverrideBtn.hidden = !selectedCustom;
    if (state.scope === 'mockup') {
      els.scopeNote.textContent = selectedCustom
        ? 'This mockup has its own placement (kept for this session only).'
        : 'Your next change applies to the selected mockup only.';
    } else {
      els.scopeNote.textContent = customCount
        ? `${customCount} mockup${customCount === 1 ? ' keeps its' : 's keep their'} own placement.`
        : 'Saved as the default for everyone on your team.';
    }
  }

  let placementFrame = 0;
  function renderPlacementViews() {
    if (placementFrame) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = 0;
      drawEditor();
      drawThumbnails();
      syncControls();
      // Keep the "Custom" badges accurate without a full re-render on every drag.
      for (const card of els.mockupGrid.children) {
        const hasBadge = Boolean(card.querySelector('.rm-mockup-badge'));
        if (state.overrides.has(card.dataset.id) !== hasBadge) { renderMockups(); break; }
      }
    });
  }

  // ── Summary + export ─────────────────────────────────────────────────────
  function folderNames(logos) {
    const used = new Set();
    return logos.map((logo) => {
      const base = cleanStoreName(logo.storeName) || 'Store';
      let name = base;
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})`;
      used.add(name.toLowerCase());
      return name;
    });
  }

  function renderSummary() {
    const logos = includedLogos();
    const total = logos.length * state.mockups.length;
    els.statMockups.textContent = String(state.mockups.length);
    els.statLogos.textContent = String(logos.length);
    els.statOutput.textContent = String(total);
    if (!state.mockups.length && !logos.length) {
      els.exportSummary.textContent = 'Add mockups and at least one logo.';
    } else if (!state.mockups.length) {
      els.exportSummary.textContent = 'Add the ready mockups you want to stamp.';
    } else if (!logos.length) {
      els.exportSummary.textContent = 'Add or include at least one store logo.';
    } else {
      const names = folderNames(logos);
      const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? `, +${names.length - 4} more` : '');
      els.exportSummary.textContent = `Creates ${logos.length} store folder${logos.length === 1 ? '' : 's'} (${shown}) × ${state.mockups.length} mockup${state.mockups.length === 1 ? '' : 's'} = ${total} stamped image${total === 1 ? '' : 's'}.`;
    }
    els.stampAllBtn.disabled = state.exporting || !total;
  }

  function setProgress(fraction, text) {
    els.progressWrap.hidden = false;
    els.progressFill.style.width = `${Math.round(clamp(fraction, 0, 1) * 1000) / 10}%`;
    els.progressText.textContent = text;
  }

  function outputFormat(mockup) {
    if (mockup.type === 'image/jpeg') return { type: 'image/jpeg', quality: JPEG_QUALITY };
    if (mockup.type === 'image/webp') return { type: 'image/webp', quality: WEBP_QUALITY };
    return { type: 'image/png' };
  }

  function timestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  async function stampAll() {
    const logos = includedLogos();
    const mockups = [...state.mockups];
    const total = logos.length * mockups.length;
    if (!total) return;
    if (!window.JSZip) return toast('ZIP support is not available — reload the page.');

    // Snapshot everything so edits during the export can't change its output.
    const placements = new Map(mockups.map((m) => [m.id, clone(placementFor(m.id))]));
    const logoImgs = logos.map((logo) => logoImage(logo.id));
    const folders = folderNames(logos);

    state.exporting = true;
    state.cancelRequested = false;
    els.stampAllBtn.disabled = true;
    els.cancelStampBtn.hidden = false;
    setProgress(0, `Stamping 0 of ${total}…`);

    const zip = new window.JSZip();
    const canvas = document.createElement('canvas');
    let done = 0;
    try {
      for (const mockup of mockups) {
        const { img, revoke } = await loadImageFromBlob(mockup.blob);
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        const format = outputFormat(mockup);
        try {
          for (let i = 0; i < logos.length; i++) {
            if (state.cancelRequested) throw new Error('CANCELLED');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            drawLogo(ctx, logoImgs[i], placements.get(mockup.id), canvas.width, canvas.height);
            let blob = await canvasToBlob(canvas, format.type, format.quality);
            let fileName = mockup.name;
            if (blob.type !== format.type) {
              // Browser can't encode this format (e.g. WebP) — fall back to PNG.
              blob = await canvasToBlob(canvas, 'image/png');
              fileName = `${stemOf(mockup.name)}.png`;
            }
            zip.folder(folders[i]).file(fileName, blob, { binary: true });
            done += 1;
            // No setTimeout yield here: the awaited toBlob already hands control
            // back to the page, and timers are throttled to ≥1s in background
            // tabs — which made exports crawl when the operator switched tabs.
            setProgress(done / total * 0.9, `Stamping ${done} of ${total} · ${folders[i]} · ${mockup.name}`);
          }
        } finally {
          revoke();
        }
      }
      setProgress(0.9, 'Packaging ZIP…');
      const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, (meta) => {
        setProgress(0.9 + meta.percent / 1000, `Packaging ZIP… ${Math.round(meta.percent)}%`);
      });
      if (state.cancelRequested) throw new Error('CANCELLED');
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ready-mockups-${timestamp()}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setProgress(1, `Done — ${total} stamped image${total === 1 ? '' : 's'} in ${folders.length} store folder${folders.length === 1 ? '' : 's'}.`);
      toast('ZIP downloaded.');
    } catch (error) {
      if (error.message === 'CANCELLED') {
        setProgress(done / total, 'Cancelled — nothing was downloaded.');
      } else {
        setProgress(done / total, `Stopped: ${error.message}`);
        toast(`Stamping failed: ${error.message}`);
      }
    } finally {
      state.exporting = false;
      els.cancelStampBtn.hidden = true;
      canvas.width = 1;
      canvas.height = 1;
      renderSummary();
    }
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function wire() {
    const hub = (window.INQUEUE_CONFIG && window.INQUEUE_CONFIG.hubUrl) || '';
    if (hub) $('inqueueHubLink').href = hub;
    $('inqueueLogoutBtn').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }
      finally { window.location.href = `${hub}/login`; }
    });

    els.uploadLogosBtn.addEventListener('click', () => { els.logoFileInput.value = ''; els.logoFileInput.click(); });
    els.logoFileInput.addEventListener('change', () => uploadLogoFiles(els.logoFileInput.files));
    els.logoReplaceInput.addEventListener('change', () => {
      const file = els.logoReplaceInput.files[0];
      if (file && state.replaceTargetId) replaceLogo(state.replaceTargetId, file);
      state.replaceTargetId = null;
    });
    els.importStoreLogosBtn.addEventListener('click', importStoreLogos);

    const openMockupPicker = () => { els.mockupFileInput.value = ''; els.mockupFileInput.click(); };
    els.addMockupsBtn.addEventListener('click', openMockupPicker);
    els.mockupDrop.addEventListener('click', openMockupPicker);
    els.mockupDrop.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMockupPicker(); }
    });
    els.mockupFileInput.addEventListener('change', () => addMockups(els.mockupFileInput.files));
    els.clearMockupsBtn.addEventListener('click', () => {
      if (!window.confirm('Remove all mockups from this session?')) return;
      state.mockups = [];
      state.overrides.clear();
      state.selectedMockupId = null;
      state.editorImage = null;
      renderMockups();
      renderPlacementViews();
    });

    for (const target of [els.mockupDrop, els.mockupGrid]) {
      target.addEventListener('dragover', (event) => { event.preventDefault(); els.mockupDrop.classList.add('is-over'); });
      target.addEventListener('dragleave', () => els.mockupDrop.classList.remove('is-over'));
      target.addEventListener('drop', (event) => {
        event.preventDefault();
        els.mockupDrop.classList.remove('is-over');
        addMockups(event.dataTransfer.files);
      });
    }
    // Stray drops elsewhere shouldn't navigate away and lose the session.
    window.addEventListener('dragover', (event) => event.preventDefault());
    window.addEventListener('drop', (event) => event.preventDefault());

    els.previewLogoSelect.addEventListener('change', () => {
      state.previewLogoId = els.previewLogoSelect.value;
      renderPlacementViews();
    });

    document.querySelectorAll('.rm-segmented button').forEach((button) => {
      button.addEventListener('click', () => { state.scope = button.dataset.scope; renderPlacementViews(); });
    });
    els.clearOverrideBtn.addEventListener('click', () => {
      state.overrides.delete(state.selectedMockupId);
      renderMockups();
      renderPlacementViews();
    });

    document.querySelectorAll('.rm-snap button').forEach((button) => {
      button.addEventListener('click', () => updatePlacement((e) => snapTo(e, button.dataset.snap)));
    });
    document.querySelectorAll('.rm-anchor button').forEach((button) => {
      button.addEventListener('click', () => updatePlacement((e) => { e.align = { x: button.dataset.ax, y: button.dataset.ay }; }));
    });
    document.querySelectorAll('.rm-nudge button').forEach((button) => {
      button.addEventListener('click', (event) => nudge(button.dataset.nudge, event.shiftKey));
    });

    els.sizeRange.addEventListener('input', () => {
      const target = Number(els.sizeRange.value) / 100;
      updatePlacement((e) => scaleAbout(e, target / e.placement.box.width, anchorPivot(e), editorAspect()), { save: false });
    });
    els.sizeRange.addEventListener('change', () => { if (state.scope === 'all') scheduleSave(); });
    els.rotationRange.addEventListener('input', () => {
      updatePlacement((e) => { e.placement.rotationDeg = Number(els.rotationRange.value); }, { save: false });
    });
    els.rotationRange.addEventListener('change', () => { if (state.scope === 'all') scheduleSave(); });
    els.resetPlacementBtn.addEventListener('click', () => {
      updatePlacement((e) => { e.placement = clone(DEFAULT_PLACEMENT); e.align = { ...DEFAULT_ALIGN }; });
    });

    const canvas = els.editorCanvas;
    canvas.addEventListener('pointerdown', onEditorPointerDown);
    canvas.addEventListener('pointermove', onEditorPointerMove);
    canvas.addEventListener('pointerup', onEditorPointerUp);
    canvas.addEventListener('pointercancel', onEditorPointerUp);
    canvas.addEventListener('keydown', (event) => {
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (!map[event.key]) return;
      event.preventDefault();
      nudge(map[event.key], event.shiftKey);
    });
    window.addEventListener('resize', () => renderPlacementViews());

    els.stampAllBtn.addEventListener('click', stampAll);
    els.cancelStampBtn.addEventListener('click', () => { state.cancelRequested = true; });

    window.addEventListener('beforeunload', (event) => {
      if (state.mockups.length || savePending || state.exporting) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  async function init() {
    wire();
    renderMockups();
    renderLogos();
    try {
      const [settings] = await Promise.all([api('/api/ready-stamp/settings'), loadLogos()]);
      state.global = { placement: settings.placement, align: settings.align || { ...DEFAULT_ALIGN } };
      if (!settings.isDefault) setSaveStatus('Placement saved', 'ok');
    } catch (error) {
      toast(error.message);
    }
    renderLogos();
    renderPlacementViews();
  }

  init();
})();
