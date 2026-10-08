import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  verifyUsername,
  verifyPassword,
  getSessionFromRequest,
  isPublicPath,
  buildLoginRedirect,
  newSessionCookieHeader,
  clearSessionCookieHeader,
  SESSION_TTL_SECONDS,
} from "./lib/auth.js";
import { computeProductionWarnings } from "./lib/productionGuardrails.js";
import {
  isValidTool,
  sanitizeNextPath,
  createSsoTicket,
  TOOL_SSO_CALLBACK_PATH,
} from "./lib/sso.js";
import { createConfigStore } from "./lib/db.js";
import { createConfigApi } from "./lib/configApi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local from the hub root so INQUEUE_* vars are available.
function loadEnvFile(filename) {
  const envPath = path.join(__dirname, filename);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const PORT = Number(process.env.PORT || 4000);
const PUBLIC_DIR = path.join(__dirname, "public");
const PREPLY_STORES_FILE = path.join(__dirname, "preply", "data", "stores.json");
// Public tool URLs (deployment-agnostic). Overrideable per environment:
//   local dev: separate ports, defaults below.
//   Render:    set to the public HTTPS URLs of each service.
const INQUEUE_HUB_URL  = process.env.INQUEUE_HUB_URL  || `http://localhost:${PORT}`;
const INKLY_BASE_URL   = process.env.INKLY_BASE_URL   || "http://localhost:5500";
const PREPLY_BASE_URL  = process.env.PREPLY_BASE_URL  || "http://localhost:3001";
const BATCHLY_BASE_URL = process.env.BATCHLY_BASE_URL || "http://localhost:3030";

// Where each tool lives, keyed by the tool slug the SSO launch route accepts.
const TOOL_BASE_URL = {
  inkly: INKLY_BASE_URL,
  preply: PREPLY_BASE_URL,
  batchly: BATCHLY_BASE_URL,
};

// Store Configuration source of truth. Postgres when INQUEUE_DATABASE_URL is
// set (Render); a local JSON file otherwise (dev only — the production
// guardrails fail closed on a missing DATABASE_URL in prod).
const configStore = createConfigStore();
const handleConfigRoute = createConfigApi({
  configStore,
  preplyBaseUrl: PREPLY_BASE_URL,
  batchlyBaseUrl: BATCHLY_BASE_URL,
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
};

function readPreplyStores() {
  try { return JSON.parse(fs.readFileSync(PREPLY_STORES_FILE, "utf8")); }
  catch { return []; }
}

// Forward the caller's session cookie: the shared INQUEUE_SESSION_SECRET makes
// the hub cookie valid on every tool service, and without it Batchly's
// middleware answers 401 for these server-to-server status calls.
async function fetchBatchlyStores(cookieHeader = "") {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BATCHLY_BASE_URL}/api/dashboard/summary`, {
      signal: ctrl.signal,
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.storeReadiness) ? data.storeReadiness : null;
  } catch { return null; }
}

// Fetch a tool's redacted /api/settings/status with the caller's cookie.
// Degrades per-service: {online:false, reason} instead of failing the page.
async function fetchToolStatus(baseUrl, cookieHeader) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${baseUrl}/api/settings/status`, {
      signal: ctrl.signal,
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    if (res.status === 401) return { online: true, status: null, reason: "unauthorized" };
    if (!res.ok) return { online: true, status: null, reason: `http_${res.status}` };
    return { online: true, status: await res.json(), reason: null };
  } catch (error) {
    return {
      online: false,
      status: null,
      reason: error?.name === "AbortError" ? "timeout" : "offline",
    };
  } finally {
    clearTimeout(timer);
  }
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const data = fs.readFileSync(filePath);
    res.setHeader("Content-Type", MIME[ext] || "text/plain");
    res.setHeader("Cache-Control", "no-cache");
    res.end(data);
  } catch { return false; }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) req.destroy(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Restrict CORS — no wildcard once auth is on. Public health/login still work
  // because the browser is same-origin, not cross-origin.
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  const pathname = url.pathname;

  // -------- Public routes: /login page + /api/login + /api/logout ----------
  if (pathname === "/api/login" && req.method === "POST") {
    let body;
    try { body = await readJsonBody(req); }
    catch { res.writeHead(400, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "Invalid request" })); }
    const username = String(body.username || "");
    const password = String(body.password || "");
    if (!verifyUsername(username) || !verifyPassword(password)) {
      // Same message for both cases — do not leak which one is wrong.
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid username or password." }));
    }
    const cookie = newSessionCookieHeader(username);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    });
    return res.end(JSON.stringify({ ok: true, expiresIn: SESSION_TTL_SECONDS }));
  }

  if (pathname === "/api/logout" && req.method === "POST") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookieHeader(),
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === "/api/auth/status") {
    const session = getSessionFromRequest(req);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ authenticated: Boolean(session), username: session?.u || null }));
  }

  if (pathname === "/login") {
    return serveFile(res, path.join(PUBLIC_DIR, "login.html"));
  }
  if (pathname === "/login.js") {
    return serveFile(res, path.join(PUBLIC_DIR, "login.js"));
  }
  if (pathname === "/styles.css") {
    // login page needs this asset before auth exists
    return serveFile(res, path.join(PUBLIC_DIR, "styles.css"));
  }

  // Public config snippet — tells the frontend where the four apps live so
  // dashboard links and logout redirects don't need to hard-code ports.
  // Served pre-auth so /login and every gated page can pick up the same URLs.
  if (pathname === "/config.js") {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    return res.end(
      `window.INQUEUE_CONFIG = ${JSON.stringify({
        hubUrl:     INQUEUE_HUB_URL,
        inklyUrl:   INKLY_BASE_URL,
        preplyUrl:  PREPLY_BASE_URL,
        batchlyUrl: BATCHLY_BASE_URL,
      })};\n`,
    );
  }

  // -------- SSO launch: hub mints a ticket, bounces to the tool ------------
  // The hub is the ONLY login screen. On Render each tool is a separate origin
  // that never receives the hub cookie, so we hand it a short-lived ticket it
  // can verify with the shared secret and exchange for its own first-party
  // session. This route does its own auth handling (below), so it must run
  // before the generic gate.
  if (pathname === "/auth/launch") {
    const tool = url.searchParams.get("tool") || "";
    if (!isValidTool(tool)) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Unknown tool");
    }
    const safeNext = sanitizeNextPath(url.searchParams.get("next")) || "/";
    const session = getSessionFromRequest(req);
    if (!session) {
      // Not logged in → hub login, then come back to this exact launch so the
      // ticket is minted only after auth. `next` here is a relative hub path.
      const launchPath = `/auth/launch?tool=${encodeURIComponent(tool)}&next=${encodeURIComponent(safeNext)}`;
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(launchPath)}` });
      return res.end();
    }
    const ticket = createSsoTicket({ username: session.u, tool, next: safeNext });
    const dest = new URL(TOOL_SSO_CALLBACK_PATH[tool], TOOL_BASE_URL[tool]);
    dest.searchParams.set("ticket", ticket);
    res.writeHead(302, { Location: dest.toString() });
    return res.end();
  }

  // -------------------------- Gate everything else -------------------------
  if (!isPublicPath(pathname)) {
    const session = getSessionFromRequest(req);
    if (!session) {
      if (pathname.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "UNAUTHENTICATED" }));
      }
      const fullUrl = `http://${req.headers.host}${req.url}`;
      res.writeHead(302, { Location: buildLoginRedirect(fullUrl, `http://${req.headers.host}`) });
      return res.end();
    }
  }

  // ---------------- Authenticated endpoints ---------------
  // Store Configuration API (Configure tab). Session-gated by the block above.
  if (pathname.startsWith("/api/config")) {
    try {
      if (await handleConfigRoute(req, res, url)) return;
    } catch (error) {
      console.error(`[config api] ${req.method} ${pathname}: ${error.message}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
    }
  }

  if (pathname === "/api/stores" && req.method === "GET") {
    const preplyStores = readPreplyStores();
    const batchlyStores = await fetchBatchlyStores(req.headers.cookie || "");
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      preplyStores,
      batchlyStores,
      batchlyOnline: batchlyStores !== null,
    }));
  }

  // Read-only connection-health aggregate for the Connections tab. The hub
  // stores no OAuth state itself; it relays each tool's redacted status.
  if (pathname === "/api/admin/status" && req.method === "GET") {
    const cookieHeader = req.headers.cookie || "";
    const [preply, batchly] = await Promise.all([
      fetchToolStatus(PREPLY_BASE_URL, cookieHeader),
      fetchToolStatus(BATCHLY_BASE_URL, cookieHeader),
    ]);
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      hub: {
        ok: true,
        production: process.env.NODE_ENV === "production" || process.env.INQUEUE_ENV === "production",
        urls: { inklyUrl: INKLY_BASE_URL, preplyUrl: PREPLY_BASE_URL, batchlyUrl: BATCHLY_BASE_URL },
        warnings: computeProductionWarnings(),
      },
      preply,
      batchly,
    }));
  }

  // ---------------------- Static files ------------------------------------
  let target = pathname === "/" ? "/index.html" : pathname;
  let filePath = path.join(PUBLIC_DIR, target);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  if (serveFile(res, filePath)) return;
  if (serveFile(res, filePath + ".html")) return;
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (!serveFile(res, indexPath)) {
    res.statusCode = 404;
    res.end("Not found");
  }
});

for (const w of computeProductionWarnings()) {
  console.warn(`[hub config ${w.level === "error" ? "ERROR" : "WARN"}] ${w.code}: ${w.message} Fix: ${w.fix}`);
}

// Initialize store-config storage (runs Postgres migrations when
// INQUEUE_DATABASE_URL is set; materializes the JSON file otherwise), then
// accept traffic. A hub that can't reach its own config store must not boot.
try {
  await configStore.init();
  console.log(`[store config] storage ready (${configStore.kind})`);
} catch (error) {
  console.error(`[store config] FATAL: storage init failed: ${error.message}`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`\n  inQueue hub  →  http://localhost:${PORT}   (auth: enforced)\n`);
});
