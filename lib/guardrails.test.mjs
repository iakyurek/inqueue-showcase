// Phase 5: hub production-guardrail matrix. Pure-function tests, no I/O.
// Run: node lib/guardrails.test.mjs

import assert from 'node:assert/strict';
import { computeProductionWarnings, isProductionEnv } from './productionGuardrails.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.message}`); }
}

const GOOD_PROD_ENV = {
  NODE_ENV: 'production',
  INQUEUE_SESSION_SECRET: 'a'.repeat(48),
  INQUEUE_PASSWORD_HASH: 'pbkdf2$100000$aa$bb',
  INQUEUE_HUB_URL: 'https://web.inqueue.io',
  INKLY_BASE_URL: 'https://inkly.inqueue.io',
  PREPLY_BASE_URL: 'https://preply.inqueue.io',
  BATCHLY_BASE_URL: 'https://batchly.inqueue.io',
  INQUEUE_DATABASE_URL: 'postgres://user:pass@db.internal.render.com:5432/inqueue',
};

console.log('Phase 5 hub guardrails tests');

test('non-production env produces no warnings regardless of config', () => {
  assert.equal(computeProductionWarnings({ NODE_ENV: 'development' }).length, 0);
  assert.equal(isProductionEnv({ NODE_ENV: 'development' }), false);
});

test('clean production env produces no warnings', () => {
  assert.deepEqual(computeProductionWarnings(GOOD_PROD_ENV), []);
  assert.equal(isProductionEnv(GOOD_PROD_ENV), true);
});

test('INQUEUE_ENV=production also counts as production', () => {
  assert.equal(isProductionEnv({ INQUEUE_ENV: 'production' }), true);
});

test('missing/weak session secret → SESSION_SECRET_MISSING error', () => {
  const warnings = computeProductionWarnings({ ...GOOD_PROD_ENV, INQUEUE_SESSION_SECRET: 'short' });
  const hit = warnings.find(w => w.code === 'SESSION_SECRET_MISSING');
  assert.ok(hit, JSON.stringify(warnings));
  assert.equal(hit.level, 'error');
});

test('plaintext password fallback → PASSWORD_PLAINTEXT error', () => {
  const env = { ...GOOD_PROD_ENV, INQUEUE_PASSWORD_HASH: '', INQUEUE_PASSWORD: 'hunter2' };
  const hit = computeProductionWarnings(env).find(w => w.code === 'PASSWORD_PLAINTEXT');
  assert.ok(hit);
  assert.equal(hit.level, 'error');
});

test('no password at all → PASSWORD_HASH_MISSING error', () => {
  const env = { ...GOOD_PROD_ENV, INQUEUE_PASSWORD_HASH: '' };
  assert.ok(computeProductionWarnings(env).find(w => w.code === 'PASSWORD_HASH_MISSING'));
});

test('localhost base URLs → one error per offending URL', () => {
  const env = {
    ...GOOD_PROD_ENV,
    PREPLY_BASE_URL: 'http://localhost:3001',
    BATCHLY_BASE_URL: 'http://127.0.0.1:3030',
  };
  const warnings = computeProductionWarnings(env);
  assert.ok(warnings.find(w => w.code === 'PREPLY_BASE_URL_LOCALHOST'));
  assert.ok(warnings.find(w => w.code === 'BATCHLY_BASE_URL_LOCALHOST'));
  assert.equal(warnings.filter(w => w.code.endsWith('_LOCALHOST')).length, 2);
});

test('missing/file/localhost database URL → DATABASE_URL_MISSING error', () => {
  for (const bad of [undefined, '', 'file:./dev.db', 'postgres://localhost:5432/x']) {
    const env = { ...GOOD_PROD_ENV, INQUEUE_DATABASE_URL: bad };
    const hit = computeProductionWarnings(env).find(w => w.code === 'DATABASE_URL_MISSING');
    assert.ok(hit, `expected DATABASE_URL_MISSING for ${JSON.stringify(bad)}`);
    assert.equal(hit.level, 'error');
  }
});

test('every warning carries message and fix text', () => {
  const warnings = computeProductionWarnings({ NODE_ENV: 'production' });
  assert.ok(warnings.length >= 3);
  for (const w of warnings) {
    assert.ok(w.message?.length > 10, w.code);
    assert.ok(w.fix?.length > 10, w.code);
    assert.ok(['error', 'warn'].includes(w.level), w.code);
  }
});

console.log('');
if (failed) { console.error(`Phase 5 hub guardrails tests: FAILED (${failed})`); process.exit(1); }
console.log('Phase 5 hub guardrails tests: OK');
