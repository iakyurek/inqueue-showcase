import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    // Production server: dev-mode cold compiles delay hydration nondeterministically,
    // which makes mount-effect fetches unreliable in tests. Run `npm run build` first.
    command: "npm run start",
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      ...process.env,
      // The auth middleware verifies the inqueue_session cookie against this
      // secret; the spec mints a matching test cookie (E2E_SESSION_SECRET in
      // batch-wizard.spec.ts). Test-only value — never use it in real envs.
      INQUEUE_SESSION_SECRET: "e2e-test-secret-e2e-test-secret-42",
    },
  },
});
