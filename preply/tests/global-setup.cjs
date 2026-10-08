// @ts-check
// Playwright globalSetup: wipe and recreate the isolated scratch data dir, then
// seed it from checked-in fixtures ONLY. Production preply/data is never read or
// written. Runs before the test webServer serves any request.
const fs = require('fs');
const path = require('path');
const { TEST_DATA_DIR, FIXTURES_DATA_DIR } = require('./test-paths.cjs');

// Safety rail: refuse to operate on anything that isn't the expected scratch dir,
// so a future edit can never point this wipe at production data.
function assertScratchDir(dir) {
  if (path.basename(dir) !== 'test-data') {
    throw new Error(`Refusing to wipe non-scratch data dir: ${dir}`);
  }
}

module.exports = async () => {
  assertScratchDir(TEST_DATA_DIR);

  // Wipe any leftovers from a previous run (batches, mock-drive, source-designs).
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  // Seed from fixtures only.
  const seedFiles = fs.readdirSync(FIXTURES_DATA_DIR).filter((name) => name.endsWith('.json'));
  for (const name of seedFiles) {
    fs.copyFileSync(path.join(FIXTURES_DATA_DIR, name), path.join(TEST_DATA_DIR, name));
  }

  console.log(`[preply-test] seeded scratch data dir ${TEST_DATA_DIR} from fixtures (${seedFiles.join(', ')})`);
};
