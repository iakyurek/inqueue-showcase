// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');
const { PREPLY_DIR, TEST_DATA_DIR, TEST_PORT, TEST_BASE_URL } = require('./tests/test-paths.cjs');

module.exports = defineConfig({
  testDir: './tests',
  // Only *.spec.cjs are tests; helper .cjs (test-paths, global-setup/teardown) are excluded.
  testMatch: '**/*.spec.cjs',
  timeout: 60000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // Seed the isolated scratch data dir before tests; remove it afterwards.
  globalSetup: require.resolve('./tests/global-setup.cjs'),
  globalTeardown: require.resolve('./tests/global-teardown.cjs'),
  use: {
    baseURL: TEST_BASE_URL,
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node server.js',
    // Run the server from preply/ so PREPLY_DATA_DIR="./test-data" resolves to
    // the scratch dir, and start it on a dedicated test port so the suite never
    // attaches to a live dev server on 3001.
    cwd: PREPLY_DIR,
    port: TEST_PORT,
    reuseExistingServer: false,
    timeout: 20000,
    env: {
      PORT: String(TEST_PORT),
      // Isolated scratch data — never production preply/data.
      PREPLY_DATA_DIR: TEST_DATA_DIR,
      // Force the local mock Drive adapter: no real Google Drive / OAuth writes.
      GOOGLE_DRIVE_AUTH_MODE: 'mock',
    },
  },
});
