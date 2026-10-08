// Ready Mockups (stamp-only workflow) — server tests.
// Unit: store-name + image validation, the logo library service, placement
// settings. HTTP: auth gate, full logo lifecycle, settings, and proof that the
// workflow never touches stores / batches / the SKU ledger.
// Run: node tests/ready-stamp.test.mjs   (from preply/)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-ready-stamp-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';

const {
  normalizeStoreName,
  parseImageDataUrl,
  normalizeAlign,
  createReadyStampService,
  READY_STAMP_LIMITS,
  DEFAULT_READY_STAMP_PLACEMENT,
  DEFAULT_READY_STAMP_ALIGN,
} = await import('../readyStamp.js');
const preply = await import('../server.js');
const { signSessionToken, SESSION_COOKIE_NAME } = await import('../../lib/auth.js');

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

// 1×1 transparent PNG / minimal JPEG + WebP headers.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pngDataUrl = `data:image/png;base64,${PNG_1PX}`;
const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const webpBytes = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);

function memoryStore() {
  const files = new Map();
  return {
    files,
    readJsonFile: async (file, fallback) => (files.has(file) ? structuredClone(files.get(file)) : fallback),
    writeJsonFile: async (file, value) => { files.set(file, structuredClone(value)); },
  };
}

function makeService(extra = {}) {
  const mem = memoryStore();
  const service = createReadyStampService({
    logosFile: 'logos.json',
    settingsFile: 'settings.json',
    readJsonFile: mem.readJsonFile,
    writeJsonFile: mem.writeJsonFile,
    // Same shape rules as Preply's normalizeStampPlacement.
    normalizePlacement: (p) => {
      if (!p || typeof p !== 'object') return null;
      const out = { center: { x: Number(p.center?.x), y: Number(p.center?.y) }, box: { width: Number(p.box?.width), height: Number(p.box?.height) }, rotationDeg: Number(p.rotationDeg || 0) };
      if (![out.center.x, out.center.y, out.box.width, out.box.height, out.rotationDeg].every(Number.isFinite)) return null;
      if (out.box.width <= 0 || out.box.height <= 0) return null;
      return out;
    },
    ...extra,
  });
  return { service, mem };
}

async function expectStatus(promise, status, pattern) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.statusCode, status, `expected ${status}, got ${err.statusCode}: ${err.message}`);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

console.log('ready-stamp tests');

// ── Validation ──────────────────────────────────────────────────────────────
await test('store names: trims/collapses whitespace, rejects empty, long, and folder-unsafe names', () => {
  assert.deepEqual(normalizeStoreName('  Custom   Culture US '), { ok: true, value: 'Custom Culture US' });
  assert.equal(normalizeStoreName('').ok, false);
  assert.equal(normalizeStoreName('   ').ok, false);
  assert.equal(normalizeStoreName(null).ok, false);
  assert.equal(normalizeStoreName('x'.repeat(READY_STAMP_LIMITS.maxStoreNameLength + 1)).ok, false);
  for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', '.hidden', 'a\u0001b']) {
    assert.equal(normalizeStoreName(bad).ok, false, `should reject ${JSON.stringify(bad)}`);
  }
});

await test('image data URLs: accepts real PNG/JPEG/WebP bytes, rejects spoofed or oversize input', () => {
  const png = parseImageDataUrl(pngDataUrl);
  assert.equal(png.ok, true);
  assert.equal(png.mime, 'image/png');
  assert.equal(parseImageDataUrl(`data:image/jpeg;base64,${jpegBytes.toString('base64')}`).mime, 'image/jpeg');
  assert.equal(parseImageDataUrl(`data:image/webp;base64,${webpBytes.toString('base64')}`).mime, 'image/webp');
  // Declared PNG but the bytes are not an image.
  assert.equal(parseImageDataUrl(`data:image/png;base64,${Buffer.from('hello world').toString('base64')}`).ok, false);
  assert.equal(parseImageDataUrl('data:text/html;base64,PGgxPg==').ok, false);
  assert.equal(parseImageDataUrl('not a data url').ok, false);
  const huge = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(READY_STAMP_LIMITS.maxLogoBytes)]);
  const tooBig = parseImageDataUrl(`data:image/png;base64,${huge.toString('base64')}`);
  assert.equal(tooBig.ok, false);
  assert.match(tooBig.error, /too large/i);
});

await test('anchor: only known left/center/right × top/center/bottom values', () => {
  assert.deepEqual(normalizeAlign({ x: 'right', y: 'top' }), { x: 'right', y: 'top' });
  assert.equal(normalizeAlign({ x: 'middle', y: 'top' }), null);
  assert.equal(normalizeAlign(null), null);
});

// ── Service ─────────────────────────────────────────────────────────────────
await test('create → list: metadata only (no image bytes), enabled by default, cache-busting url', async () => {
  const { service } = makeService();
  const logo = await service.createLogo({ storeName: 'NorthwindUS', dataUrl: pngDataUrl, width: 1, height: 1 });
  assert.equal(logo.storeName, 'NorthwindUS');
  assert.equal(logo.enabled, true);
  assert.equal(logo.mime, 'image/png');
  assert.equal(logo.data, undefined, 'image bytes must not be in listings');
  assert.match(logo.url, /^\/api\/ready-stamp\/logos\/[0-9a-f-]+\/image\?v=/);
  const list = await service.listLogos();
  assert.equal(list.length, 1);
  assert.equal(list[0].data, undefined);
  const image = await service.getLogoImage(logo.id);
  assert.equal(image.mime, 'image/png');
  assert.deepEqual(image.buffer, Buffer.from(PNG_1PX, 'base64'));
});

await test('store names are unique case-insensitively (they become folder names)', async () => {
  const { service } = makeService();
  await service.createLogo({ storeName: 'FernPrint', dataUrl: pngDataUrl });
  await expectStatus(service.createLogo({ storeName: 'fernprint', dataUrl: pngDataUrl }), 409, /already exists/);
  const other = await service.createLogo({ storeName: 'PineCrest', dataUrl: pngDataUrl });
  await expectStatus(service.updateLogo(other.id, { storeName: 'FERNPRINT' }), 409);
});

await test('update: rename, toggle include, replace image bumps updatedAt', async () => {
  let tick = 0;
  const { service } = makeService({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
  const logo = await service.createLogo({ storeName: 'Cedarknit', dataUrl: pngDataUrl });
  const renamed = await service.updateLogo(logo.id, { storeName: 'Cozy Craft' });
  assert.equal(renamed.storeName, 'Cozy Craft');
  const off = await service.updateLogo(logo.id, { enabled: false });
  assert.equal(off.enabled, false);
  const replaced = await service.updateLogo(logo.id, { dataUrl: `data:image/jpeg;base64,${jpegBytes.toString('base64')}`, width: 10, height: 5 });
  assert.equal(replaced.mime, 'image/jpeg');
  assert.equal(replaced.width, 10);
  assert.notEqual(replaced.updatedAt, logo.updatedAt);
  assert.notEqual(replaced.url, logo.url, 'url must change so browsers refetch the new image');
});

await test('delete + unknown ids → 404', async () => {
  const { service } = makeService();
  const logo = await service.createLogo({ storeName: 'Bluebirdteesusa', dataUrl: pngDataUrl });
  assert.deepEqual(await service.deleteLogo(logo.id), { deleted: logo.id });
  assert.equal((await service.listLogos()).length, 0);
  await expectStatus(service.deleteLogo(logo.id), 404);
  await expectStatus(service.updateLogo('nope', { enabled: true }), 404);
  assert.equal(await service.getLogoImage('nope'), null);
});

await test('invalid input is rejected with 400 and nothing is written', async () => {
  const { service, mem } = makeService();
  await expectStatus(service.createLogo({ storeName: 'a/b', dataUrl: pngDataUrl }), 400, /folder name/);
  await expectStatus(service.createLogo({ storeName: 'Fine', dataUrl: 'data:image/png;base64,AAAA' }), 400);
  assert.equal(mem.files.has('logos.json'), false);
});

await test('library limits: max logo count and total size', async () => {
  const { service } = makeService();
  for (let i = 0; i < READY_STAMP_LIMITS.maxLogos; i++) {
    await service.createLogo({ storeName: `Store ${i}`, dataUrl: pngDataUrl });
  }
  await expectStatus(service.createLogo({ storeName: 'One too many', dataUrl: pngDataUrl }), 400, /full/);

  const big = makeService();
  const chunk = Buffer.concat([Buffer.from(PNG_1PX, 'base64'), Buffer.alloc(READY_STAMP_LIMITS.maxLogoBytes - 200)]);
  const bigUrl = `data:image/png;base64,${chunk.toString('base64')}`;
  const fits = Math.floor(READY_STAMP_LIMITS.maxLibraryBytes / chunk.length);
  for (let i = 0; i < fits; i++) await big.service.createLogo({ storeName: `Big ${i}`, dataUrl: bigUrl });
  await expectStatus(big.service.createLogo({ storeName: 'Overflow', dataUrl: bigUrl }), 400, /out of space/);
});

await test('concurrent uploads are serialized — none are lost', async () => {
  const { service } = makeService();
  const names = ['A', 'B', 'C', 'D', 'E', 'F'];
  await Promise.all(names.map((storeName) => service.createLogo({ storeName, dataUrl: pngDataUrl })));
  const stored = (await service.listLogos()).map((logo) => logo.storeName).sort();
  assert.deepEqual(stored, names);
});

await test('settings: default top-right placement + anchor until saved; save validates', async () => {
  const { service } = makeService();
  const initial = await service.getSettings();
  assert.equal(initial.isDefault, true);
  assert.deepEqual(initial.placement, DEFAULT_READY_STAMP_PLACEMENT);
  assert.deepEqual(initial.align, DEFAULT_READY_STAMP_ALIGN);
  const placement = { center: { x: 0.2, y: 0.8 }, box: { width: 0.3, height: 0.1 }, rotationDeg: -12 };
  const saved = await service.saveSettings({ placement, align: { x: 'left', y: 'bottom' } });
  assert.equal(saved.isDefault, false);
  const reread = await service.getSettings();
  assert.deepEqual(reread.placement, placement);
  assert.deepEqual(reread.align, { x: 'left', y: 'bottom' });
  await expectStatus(service.saveSettings({ placement: { center: {}, box: {} } }), 400, /placement/);
  await expectStatus(service.saveSettings({ placement, align: { x: 'up', y: 'top' } }), 400, /anchor/);
});

// ── HTTP ────────────────────────────────────────────────────────────────────
const { server } = preply;
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const cookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ u: 'test-user' })}`;
const call = (pathname, { method = 'GET', body, auth = true } = {}) => fetch(`${base}${pathname}`, {
  method,
  headers: {
    ...(auth ? { cookie } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  },
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
});

const stateFiles = ['stores.json', 'batches.json', 'sku-ledger.json'];
async function snapshotState() {
  const out = {};
  for (const name of stateFiles) out[name] = await fs.readFile(path.join(SCRATCH, name), 'utf8').catch(() => null);
  return out;
}

try {
  await test('HTTP: API and page require a session', async () => {
    const api = await call('/api/ready-stamp/logos', { auth: false });
    assert.equal(api.status, 401);
    const page = await fetch(`${base}/ready-mockups`, { redirect: 'manual' });
    assert.equal(page.status, 302);
  });

  await test('HTTP: /ready-mockups serves the page with the workflow wired in', async () => {
    const res = await call('/ready-mockups');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Stamp all store logos/);
    assert.match(html, /ready-mockups\.js/);
    assert.match(html, /vendor\/jszip\.min\.js/);
  });

  // A fresh data dir gets Preply's normal first-boot seeding (which a real
  // server does at startup). Trigger it once, then snapshot: every Ready
  // Mockups operation after this point must leave these files byte-identical.
  await call('/api/ready-stamp/store-logo-sources');
  const before = await snapshotState();
  assert.ok(Object.values(before).some((v) => v !== null), 'expected seeded state files to snapshot');
  let created;

  await test('HTTP: logo lifecycle — create, image, rename, toggle, delete', async () => {
    let res = await call('/api/ready-stamp/logos', { method: 'POST', body: { storeName: 'NorthwindUS', dataUrl: pngDataUrl, width: 1, height: 1 } });
    assert.equal(res.status, 201);
    created = (await res.json()).logo;
    assert.equal(created.storeName, 'NorthwindUS');

    res = await call('/api/ready-stamp/logos', { method: 'POST', body: { storeName: 'northwindus', dataUrl: pngDataUrl } });
    assert.equal(res.status, 409);

    res = await call(created.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG_1PX, 'base64'));

    res = await call(`/api/ready-stamp/logos/${created.id}`, { method: 'PATCH', body: { storeName: 'Custom Culture', enabled: false } });
    assert.equal(res.status, 200);
    const patched = (await res.json()).logo;
    assert.equal(patched.storeName, 'Custom Culture');
    assert.equal(patched.enabled, false);

    res = await call('/api/ready-stamp/logos');
    const { logos } = await res.json();
    assert.equal(logos.length, 1);
    assert.equal(logos[0].data, undefined);

    // Durable file written where hydration expects it.
    const onDisk = JSON.parse(await fs.readFile(path.join(SCRATCH, 'ready-stamp-logos.json'), 'utf8'));
    assert.equal(onDisk.logos.length, 1);

    res = await call(`/api/ready-stamp/logos/${created.id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    res = await call(`/api/ready-stamp/logos/${created.id}/image`);
    assert.equal(res.status, 404);
  });

  await test('HTTP: bad input → 4xx, never a 500', async () => {
    let res = await call('/api/ready-stamp/logos', { method: 'POST', body: '{not json' });
    assert.equal(res.status, 400);
    res = await call('/api/ready-stamp/logos', { method: 'POST', body: { storeName: 'x', dataUrl: 'data:image/png;base64,QUJD' } });
    assert.equal(res.status, 400);
    res = await call('/api/ready-stamp/logos/..%2F..%2Fstores/image');
    assert.equal(res.status, 404);
    res = await call('/api/ready-stamp/logos', { method: 'DELETE' });
    assert.equal(res.status, 405);
  });

  await test('HTTP: settings round-trip', async () => {
    let res = await call('/api/ready-stamp/settings');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).isDefault, true);
    const placement = { center: { x: 0.1, y: 0.1 }, box: { width: 0.2, height: 0.1 }, rotationDeg: 5 };
    res = await call('/api/ready-stamp/settings', { method: 'PUT', body: { placement, align: { x: 'left', y: 'top' } } });
    assert.equal(res.status, 200);
    res = await call('/api/ready-stamp/settings');
    const settings = await res.json();
    assert.deepEqual(settings.placement, placement);
    assert.deepEqual(settings.align, { x: 'left', y: 'top' });
    res = await call('/api/ready-stamp/settings', { method: 'PUT', body: { placement: { center: { x: 9, y: 9 }, box: { width: 0.2, height: 0.1 } } } });
    assert.equal(res.status, 400);
  });

  await test('HTTP: store-logo import sources come from Store Settings (read-only)', async () => {
    const res = await call('/api/ready-stamp/store-logo-sources');
    assert.equal(res.status, 200);
    const { sources } = await res.json();
    assert.ok(Array.isArray(sources));
    for (const source of sources) {
      assert.equal(typeof source.storeName, 'string');
      assert.match(source.url, /^\/store-logos\//);
    }
  });

  await test('isolation: stores, batches, and the SKU ledger are untouched', async () => {
    assert.deepEqual(await snapshotState(), before);
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('');
if (failed) { console.error(`ready-stamp tests: FAILED (${failed})`); process.exit(1); }
console.log('ready-stamp tests: OK');
