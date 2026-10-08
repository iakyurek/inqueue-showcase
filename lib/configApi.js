// Store Configuration HTTP API for the hub (Node ESM).
//
// server.js mounts this after its auth gate, so every route here is already
// session-protected (unauthenticated /api/* requests get 401 upstream).
//
// Routes (see docs/plans/store-config-hub-plan.md):
//   GET  /api/config
//   PUT  /api/config/stores/:slot
//   PUT  /api/config/presets
//   POST /api/config/stores/:slot/test-drive        (proxy → Preply)
//   POST /api/config/stores/:slot/infer-prefix      (proxy → Preply, no write)
//   POST /api/config/stores/:slot/test-etsy         (proxy → Batchly)
//   POST /api/config/stores/:slot/refresh-etsy-ids  (proxy → Batchly)
//   GET  /api/config/etsy/connect/:slot             (302 via hub SSO launch)
//   POST /api/config/sync                           (push full state to tools)
//
// Proxy semantics: results are persisted ONLY when the tool answered
// definitively. A network failure/timeout never fakes a state in either
// direction — it surfaces as *_UNREACHABLE and the stored status is untouched.

import {
  isValidSlot,
  validateStorePatch,
  validatePresets,
  computeReadiness,
  buildSyncPayload,
  READINESS_LABELS,
  SLOTS,
} from './storeConfig.js';
import { serviceAuthHeader } from './serviceAuth.js';

const PROXY_TIMEOUT_MS = 5000;

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) req.destroy(new Error('Request too large'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// POST to a tool's internal endpoint with a fresh service token. Returns
// { ok, status, body } for definitive answers, { ok:false, unreachable:true }
// for network-level failures.
async function callTool(baseUrl, path, aud, payload) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROXY_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: serviceAuthHeader('hub', aud),
      },
      body: JSON.stringify(payload ?? {}),
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON reply */ }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, unreachable: true, reason: error?.name === 'AbortError' ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

function publicState(state) {
  const readiness = {};
  for (const slot of SLOTS) {
    readiness[slot] = computeReadiness(state.stores[slot], state.presets);
  }
  return {
    configVersion: state.configVersion,
    stores: SLOTS.map((slot) => state.stores[slot]),
    presets: state.presets,
    sync: state.sync,
    readiness,
    readinessLabels: READINESS_LABELS,
  };
}

export function createConfigApi({ configStore, preplyBaseUrl, batchlyBaseUrl }) {
  async function syncTool(tool, state) {
    const baseUrl = tool === 'preply' ? preplyBaseUrl : batchlyBaseUrl;
    const payload = buildSyncPayload(state, new Date().toISOString());
    const attemptAt = new Date().toISOString();
    const result = await callTool(baseUrl, '/api/internal/config-sync', tool, payload);
    if (result.unreachable) {
      await configStore.recordSync(tool, {
        lastAttemptAt: attemptAt,
        lastError: `unreachable (${result.reason})`,
        pushedConfigVersion: payload.configVersion,
      });
      return { tool, applied: false, error: 'unreachable', reason: result.reason };
    }
    const body = result.body || {};
    await configStore.recordSync(tool, {
      lastAttemptAt: attemptAt,
      lastSuccessAt: result.ok && body.applied ? attemptAt : undefined,
      lastError: result.ok ? (body.error ?? null) : `http_${result.status}`,
      pushedConfigVersion: payload.configVersion,
      ackedConfigVersion: body.appliedVersion ?? undefined,
      mode: body.mode ?? undefined,
    });
    if (!result.ok) return { tool, applied: false, error: `http_${result.status}`, detail: body };
    return { tool, ...body };
  }

  // Returns true when the request was handled.
  return async function handleConfigRoute(req, res, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/config')) return false;

    // ---- GET /api/config -------------------------------------------------
    if (pathname === '/api/config' && req.method === 'GET') {
      json(res, 200, publicState(await configStore.getState()));
      return true;
    }

    // ---- PUT /api/config/presets ------------------------------------------
    if (pathname === '/api/config/presets' && req.method === 'PUT') {
      let body;
      try { body = await readJsonBody(req); }
      catch { json(res, 400, { error: 'INVALID_JSON' }); return true; }
      const check = validatePresets(body);
      if (!check.ok) { json(res, 422, { error: 'VALIDATION_FAILED', errors: check.errors }); return true; }
      const { presets, configVersion } = await configStore.savePresets(check.value);
      json(res, 200, { presets, configVersion });
      return true;
    }

    // ---- PUT /api/config/stores/:slot --------------------------------------
    const storeMatch = pathname.match(/^\/api\/config\/stores\/([^/]+)$/);
    if (storeMatch && req.method === 'PUT') {
      const slot = storeMatch[1];
      if (!isValidSlot(slot)) { json(res, 400, { error: 'INVALID_SLOT' }); return true; }
      let body;
      try { body = await readJsonBody(req); }
      catch { json(res, 400, { error: 'INVALID_JSON' }); return true; }
      const { expectedRowVersion, ...patch } = body;
      if (!Number.isInteger(expectedRowVersion)) {
        json(res, 400, { error: 'EXPECTED_ROW_VERSION_REQUIRED' });
        return true;
      }
      const check = validateStorePatch(patch);
      if (!check.ok) { json(res, 422, { error: 'VALIDATION_FAILED', errors: check.errors }); return true; }
      const state = await configStore.getState();
      // Enable gate: a store may only be enabled once fully configured.
      if (check.value.enabled === true) {
        const merged = {
          ...state.stores[slot],
          ...check.value,
          etsyIds: { ...state.stores[slot].etsyIds, ...(check.value.etsyIds || {}) },
        };
        // A pending driveFolderId change invalidates the previous test result.
        if ('driveFolderId' in check.value && check.value.driveFolderId !== state.stores[slot].driveFolderId) {
          merged.driveTestStatus = 'untested';
        }
        const readiness = computeReadiness(merged, state.presets);
        if (!readiness.ready) {
          json(res, 422, { error: 'NOT_READY', missing: readiness.missing, labels: READINESS_LABELS });
          return true;
        }
      }
      try {
        const { store, configVersion } = await configStore.updateStore(slot, check.value, expectedRowVersion);
        json(res, 200, { store, configVersion, readiness: computeReadiness(store, state.presets) });
      } catch (e) {
        if (e.code === 'CONFLICT') json(res, 409, { error: 'ROW_VERSION_CONFLICT' });
        else throw e;
      }
      return true;
    }

    // ---- per-slot actions ---------------------------------------------------
    const actionMatch = pathname.match(/^\/api\/config\/stores\/([^/]+)\/(test-drive|infer-prefix|test-etsy|refresh-etsy-ids)$/);
    if (actionMatch && req.method === 'POST') {
      const [, slot, action] = actionMatch;
      if (!isValidSlot(slot)) { json(res, 400, { error: 'INVALID_SLOT' }); return true; }
      const state = await configStore.getState();
      const store = state.stores[slot];

      if (action === 'test-drive' || action === 'infer-prefix') {
        if (!store.driveFolderId) { json(res, 422, { error: 'DRIVE_FOLDER_NOT_SET' }); return true; }
        const path = action === 'test-drive' ? '/api/internal/drive/test-folder' : '/api/internal/drive/infer-prefix';
        const result = await callTool(preplyBaseUrl, path, 'preply', { folderId: store.driveFolderId });
        if (result.unreachable) { json(res, 502, { error: 'PREPLY_UNREACHABLE', reason: result.reason }); return true; }
        if (!result.ok) { json(res, 502, { error: 'PREPLY_ERROR', status: result.status, detail: result.body }); return true; }
        if (action === 'test-drive') {
          const ok = result.body?.ok === true;
          const { store: updated } = await configStore.updateStoreSystem(slot, {
            driveTestStatus: ok ? 'ok' : 'failed',
            driveTestDetail: result.body?.detail ?? null,
            driveTestedAt: new Date().toISOString(),
          });
          json(res, 200, {
            status: updated.driveTestStatus,
            detail: updated.driveTestDetail,
            testedAt: updated.driveTestedAt,
            folder: result.body?.folder ?? null,
          });
        } else {
          // Inference never writes — the user confirms a candidate in the UI,
          // which then PUTs skuPrefix with skuPrefixSource:'inferred_confirmed'.
          json(res, 200, { candidates: result.body?.candidates ?? [] });
        }
        return true;
      }

      if (action === 'test-etsy' || action === 'refresh-etsy-ids') {
        const result = await callTool(batchlyBaseUrl, '/api/internal/etsy/test-connection', 'batchly', { storeFolder: slot });
        if (result.unreachable) {
          json(res, 200, { connected: false, reason: 'unreachable', persisted: false });
          return true;
        }
        if (!result.ok) { json(res, 502, { error: 'BATCHLY_ERROR', status: result.status, detail: result.body }); return true; }
        const body = result.body || {};
        const systemFields = {
          etsyConnected: body.connected === true,
          etsyShopId: body.shopId ?? null,
          etsyShopName: body.shopName ?? null,
          etsyStatusCheckedAt: new Date().toISOString(),
        };
        if (action === 'refresh-etsy-ids' && body.etsyIds && typeof body.etsyIds === 'object') {
          systemFields.etsyIds = {};
          for (const key of ['taxonomyId', 'shippingProfileId', 'readinessStateId', 'returnPolicyId', 'sectionId']) {
            if (key in body.etsyIds) {
              const n = Number(body.etsyIds[key]);
              systemFields.etsyIds[key] = Number.isInteger(n) && n > 0 ? n : null;
            }
          }
        }
        const { store: updated } = await configStore.updateStoreSystem(slot, systemFields);
        json(res, 200, {
          connected: updated.etsyConnected,
          shopId: updated.etsyShopId,
          shopName: updated.etsyShopName,
          checkedAt: updated.etsyStatusCheckedAt,
          reason: body.reason ?? null,
          etsyIds: action === 'refresh-etsy-ids' ? updated.etsyIds : undefined,
          persisted: true,
        });
        return true;
      }
    }

    // ---- GET /api/config/etsy/connect/:slot ---------------------------------
    const connectMatch = pathname.match(/^\/api\/config\/etsy\/connect\/([^/]+)$/);
    if (connectMatch && req.method === 'GET') {
      const slot = connectMatch[1];
      if (!isValidSlot(slot)) { json(res, 400, { error: 'INVALID_SLOT' }); return true; }
      // Route the browser through the hub's own SSO launch so it lands on
      // Batchly's OAuth start with a valid Batchly session. `returnTo=hub` is a
      // sentinel — Batchly resolves the actual URL from its own INQUEUE_HUB_URL
      // env, so no URL ever travels in the request (no open-redirect surface).
      const startPath = `/api/auth/etsy/start?storeFolder=${encodeURIComponent(slot)}&returnTo=hub`;
      const location = `/auth/launch?tool=batchly&next=${encodeURIComponent(startPath)}`;
      res.writeHead(302, { Location: location });
      res.end();
      return true;
    }

    // ---- POST /api/config/sync ----------------------------------------------
    if (pathname === '/api/config/sync' && req.method === 'POST') {
      let body;
      try { body = await readJsonBody(req); }
      catch { json(res, 400, { error: 'INVALID_JSON' }); return true; }
      const tools = body.tool ? [body.tool] : ['preply', 'batchly'];
      if (!tools.every((t) => t === 'preply' || t === 'batchly')) {
        json(res, 400, { error: 'INVALID_TOOL' });
        return true;
      }
      const state = await configStore.getState();
      const results = [];
      for (const tool of tools) results.push(await syncTool(tool, state));
      const refreshed = await configStore.getState();
      json(res, 200, { results, sync: refreshed.sync, configVersion: refreshed.configVersion });
      return true;
    }

    // Unknown /api/config path or wrong method.
    json(res, pathname === '/api/config' || storeMatch || actionMatch || connectMatch ? 405 : 404, { error: 'NOT_FOUND' });
    return true;
  };
}
