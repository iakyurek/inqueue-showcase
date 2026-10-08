// @ts-check
// Playwright globalTeardown: remove the scratch data dir so no test state lingers
// on disk between runs. Never touches production preply/data.
const fs = require('fs');
const path = require('path');
const { TEST_DATA_DIR } = require('./test-paths.cjs');

module.exports = async () => {
  if (path.basename(TEST_DATA_DIR) !== 'test-data') {
    throw new Error(`Refusing to remove non-scratch data dir: ${TEST_DATA_DIR}`);
  }
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  console.log(`[preply-test] removed scratch data dir ${TEST_DATA_DIR}`);
};
