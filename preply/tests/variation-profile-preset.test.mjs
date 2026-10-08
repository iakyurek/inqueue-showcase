// Preply mockup-preset variation-profile (design_type) contract.
// Proves the server-side normalizer whitelists front_sided/double_sided, migrates
// legacy presets (no design_type) to front_sided, and rejects unknown keys — the
// same key the manifest export and Batchly resolver depend on.
// Run: node tests/variation-profile-preset.test.mjs   (from preply/)
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolate Preply behind a scratch data dir + mock Drive so importing the server
// module has no live side effects (it does not call listen on import).
const SCRATCH = fsSync.mkdtempSync(path.join(os.tmpdir(), 'preply-vprofile-'));
process.env.PREPLY_DATA_DIR = SCRATCH;
process.env.GOOGLE_DRIVE_AUTH_MODE = 'mock';
process.env.INQUEUE_SESSION_SECRET = 'test-session-secret-value-of-adequate-length';
process.env.INQUEUE_USERNAME = 'test-user';

const {
  normalizeMockupPreset,
  VARIATION_PROFILE_KEYS,
  DEFAULT_VARIATION_PROFILE,
} = await import('../server.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${err.stack || err.message}`); }
}

console.log('preply variation-profile preset tests');

test('registry keys and default match the hub/Batchly contract', () => {
  assert.deepEqual([...VARIATION_PROFILE_KEYS].sort(), ['double_sided', 'front_sided']);
  assert.equal(DEFAULT_VARIATION_PROFILE, 'front_sided');
});

test('create Front-sided preset: design_type preserved', () => {
  const p = normalizeMockupPreset({ preset_name: 'Front Preset', design_type: 'front_sided' });
  assert.equal(p.design_type, 'front_sided');
  assert.equal(p.preset_name, 'Front Preset');
});

test('create Double-sided preset: design_type preserved', () => {
  const p = normalizeMockupPreset({ preset_name: 'Double Preset', design_type: 'double_sided' });
  assert.equal(p.design_type, 'double_sided');
});

test('legacy preset (no design_type) migrates to front_sided', () => {
  const p = normalizeMockupPreset({ preset_name: 'Old Preset' });
  assert.equal(p.design_type, 'front_sided');
});

test('unknown design_type is rejected and falls back to front_sided default', () => {
  for (const bad of ['triple_sided', '', null, undefined, 'DOUBLE_SIDED', 42, {}]) {
    const p = normalizeMockupPreset({ preset_name: 'X', design_type: bad });
    assert.equal(p.design_type, 'front_sided', `bad=${JSON.stringify(bad)}`);
  }
});

test('editing a preset can switch its design_type front <-> double', () => {
  let p = normalizeMockupPreset({ preset_name: 'Switch', design_type: 'front_sided' });
  assert.equal(p.design_type, 'front_sided');
  // Simulate the editor saving a new choice on the same preset.
  p = normalizeMockupPreset({ ...p, design_type: 'double_sided' });
  assert.equal(p.design_type, 'double_sided');
  assert.equal(p.preset_name, 'Switch'); // other fields intact
});

console.log('');
if (failed) { console.error(`preply variation-profile preset tests: FAILED (${failed})`); process.exit(1); }
console.log('preply variation-profile preset tests: OK');
