// @ts-check
/**
 * Configure tab e2e — six store cards, accordion, save round-trip, enable
 * gate, presets panel, sync strip. Self-contained: spawns its own hub on a
 * scratch port with a scratch JSON config store + generated credentials, so it
 * needs no .env.local and never touches real data.
 * Run: npx playwright test tests/configure.spec.cjs
 */

const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORT = 4930 + Math.floor(Math.random() * 50);
const BASE = `http://localhost:${PORT}`;
const USERNAME = "e2e-user";
const PASSWORD = "e2e-password";

let child;
let scratch;

test.beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "inqueue-configure-e2e-"));
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(PASSWORD, salt, 100000, 32, "sha256");
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      INQUEUE_SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
      INQUEUE_USERNAME: USERNAME,
      INQUEUE_PASSWORD_HASH: `pbkdf2$100000$${salt.toString("hex")}$${hash.toString("hex")}`,
      INQUEUE_PASSWORD: "",
      INQUEUE_DATABASE_URL: "",
      INQUEUE_STORE_CONFIG_FILE: path.join(scratch, "store-config.json"),
      INQUEUE_HUB_URL: BASE,
      // Dead tool ports: proxy-backed actions degrade gracefully; not exercised here.
      PREPLY_BASE_URL: "http://localhost:9",
      BATCHLY_BASE_URL: "http://localhost:9",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  // Wait for the hub to accept requests.
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("hub did not start");
});

test.afterAll(() => {
  if (child) child.kill("SIGTERM");
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.fill("#usernameInput", USERNAME);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#loginSubmit");
  await page.waitForURL(`${BASE}/`);
}

async function openConfigure(page) {
  await login(page);
  await page.click('[data-page="configure"]');
  await page.waitForSelector(".cfg-card");
}

test.describe("Configure tab", () => {
  test("renders six fixed store cards plus the shared presets panel", async ({ page }) => {
    await openConfigure(page);
    await expect(page.locator(".cfg-card")).toHaveCount(6);
    for (const slot of ["Store_A", "Store_B", "Store_C", "Store_D", "Store_E", "Store_F"]) {
      await expect(page.locator(`.cfg-card[data-slot="${slot}"]`)).toBeVisible();
    }
    await expect(page.locator("#cfgPresetsPanel")).toContainText("Draft presets");
    await expect(page.locator("#cfgPresetsPanel")).toContainText("every store");
  });

  test("unconfigured card shows Not configured; accordion expands and collapses", async ({ page }) => {
    await openConfigure(page);
    const card = page.locator('.cfg-card[data-slot="Store_C"]');
    await expect(card).toContainText("Not configured");
    await card.locator(".cfg-card-head").click();
    await expect(card.locator(".cfg-body")).toContainText("Store identity");
    await expect(card.locator(".cfg-card-head")).toHaveAttribute("aria-expanded", "true");
    await card.locator(".cfg-card-head").click();
    await expect(card.locator(".cfg-card-head")).toHaveAttribute("aria-expanded", "false");
  });

  test("identity save round-trips and updates the header", async ({ page }) => {
    await openConfigure(page);
    const card = page.locator('.cfg-card[data-slot="Store_B"]');
    await card.locator(".cfg-card-head").click();
    await page.fill("#f-Store_B-displayName", "Maplegoods");
    await card.locator('[data-action="save-identity"]').click();
    await expect(page.locator('.cfg-card[data-slot="Store_B"] .cfg-card-name')).toContainText("Maplegoods");
    // Reload — the value came back from the server, not local state.
    await page.reload();
    await page.click('[data-page="configure"]');
    await expect(page.locator('.cfg-card[data-slot="Store_B"] .cfg-card-name')).toContainText("Maplegoods");
  });

  test("enable toggle is blocked until ready, readiness checklist shows missing items", async ({ page }) => {
    await openConfigure(page);
    const card = page.locator('.cfg-card[data-slot="Store_B"]');
    await card.locator(".cfg-card-head").click();
    // Not ready → the enable button is disabled and the checklist shows misses.
    await expect(card.locator('[data-action="toggle-enabled"]')).toBeDisabled();
    await expect(card.locator(".readiness-list li.missing").first()).toBeVisible();
    await expect(card.locator(".cfg-body")).toContainText("Etsy account connected");
  });

  test("SKU prefix save validates format server-side", async ({ page }) => {
    await openConfigure(page);
    const card = page.locator('.cfg-card[data-slot="Store_D"]');
    await card.locator(".cfg-card-head").click();
    await page.fill("#f-Store_D-skuPrefix", "BAD1");
    await card.locator('[data-action="save-prefix"]').click();
    await expect(card.locator("#r-Store_D-prefix")).toContainText("skuPrefix");
    await page.fill("#f-Store_D-skuPrefix", "DT");
    await card.locator('[data-action="save-prefix"]').click();
    await expect(page.locator('.cfg-card[data-slot="Store_D"] .folder-badge').nth(1)).toContainText("DT");
  });

  test("sync strip shows both tools and Sync now reports unreachable tools without failing", async ({ page }) => {
    await openConfigure(page);
    await expect(page.locator("#cfgSyncStrip .sync-chip")).toHaveCount(2);
    await page.click('[data-action="sync-now"]');
    await expect(page.locator("#cfgBanner")).toContainText("Sync finished");
    await expect(page.locator("#cfgBanner")).toContainText("unreachable");
  });

  test("presets panel expands and saves", async ({ page }) => {
    await openConfigure(page);
    await page.click('[data-action="toggle-presets"]');
    await expect(page.locator("#pv-defaultPrice")).toBeVisible();
    await page.fill("#pv-defaultPrice", "12.99");
    await page.click('[data-action="save-presets"]');
    // Re-render keeps the panel open and the saved value.
    await expect(page.locator("#pv-defaultPrice")).toHaveValue("12.99");
  });

  test("Connect Etsy routes through the hub SSO launch", async ({ page }) => {
    await openConfigure(page);
    const card = page.locator('.cfg-card[data-slot="Store_A"]');
    await card.locator(".cfg-card-head").click();
    const href = await card.locator('a.btn:has-text("Connect Etsy")').getAttribute("href");
    if (href !== "/api/config/etsy/connect/Store_A") {
      throw new Error(`unexpected connect href: ${href}`);
    }
  });
});
