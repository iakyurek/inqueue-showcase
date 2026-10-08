// @ts-check
// Shared, single-source-of-truth paths/ports for the isolated Playwright run.
// Both playwright.config.cjs and global-setup/teardown import from here so the
// scratch data directory and test port never drift apart.
const path = require('path');

// preply/ (parent of tests/) — the server's cwd during the test webServer run.
const PREPLY_DIR = path.resolve(__dirname, '..');

// Isolated scratch data dir. Matches PREPLY_DATA_DIR="./test-data" resolved from
// PREPLY_DIR. NEVER the production preply/data directory.
const TEST_DATA_DIR = path.join(PREPLY_DIR, 'test-data');

// Read-only seed fixtures (checked in). Copied into TEST_DATA_DIR on setup.
const FIXTURES_DATA_DIR = path.join(__dirname, 'fixtures', 'data');

// Dedicated test port, distinct from the dev default (3001), so the suite never
// attaches to — or collides with — a live dev server.
const TEST_PORT = 3199;
const TEST_BASE_URL = `http://localhost:${TEST_PORT}`;

module.exports = { PREPLY_DIR, TEST_DATA_DIR, FIXTURES_DATA_DIR, TEST_PORT, TEST_BASE_URL };
