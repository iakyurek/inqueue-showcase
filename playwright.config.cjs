// @ts-check
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 15_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4000",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // inQueue hub server must already be running on port 4000
  webServer: {
    command: "node server.js",
    port: 4000,
    reuseExistingServer: true,
    timeout: 8_000,
  },
});
