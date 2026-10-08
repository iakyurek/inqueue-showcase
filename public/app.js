/* inQueue landing page — app.js */

// ── Constants ────────────────────────────────────────────────────────────────
const TOOLS = ["inkly", "preply", "batchly"];
const STORAGE_KEY = "inqueue_progress_v1";

// ── State ────────────────────────────────────────────────────────────────────
let progress = loadProgress();

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  initNav();
  initProgress();
  initMarkButtons();
  renderProgress();
  wireToolLinks();

  // Load store data when stores section is opened
  document.querySelectorAll('[data-page="stores"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!document.getElementById("section-stores").classList.contains("_loaded")) {
        loadStores();
        document.getElementById("section-stores").classList.add("_loaded");
      }
    });
  });

  // Reset progress
  document.getElementById("resetProgressBtn").addEventListener("click", () => {
    if (confirm("Reset all workflow completion markers?")) {
      progress = { inkly: false, preply: false, batchly: false };
      saveProgress();
      renderProgress();
    }
  });

  // Refresh stores
  document.getElementById("refreshStoresBtn").addEventListener("click", () => {
    document.getElementById("section-stores").classList.remove("_loaded");
    loadStores();
    document.getElementById("section-stores").classList.add("_loaded");
  });

  // Load connection health when the Connections tab is opened
  document.querySelectorAll('[data-page="connections"]').forEach((btn) => {
    btn.addEventListener("click", () => loadConnections());
  });
  const refreshConnectionsBtn = document.getElementById("refreshConnectionsBtn");
  if (refreshConnectionsBtn) refreshConnectionsBtn.addEventListener("click", loadConnections);
});

// ── Tool link URLs — route through the hub's SSO launch ──────────────────────
// The links point at the hub's own /auth/launch (same origin), NOT the tool
// base URLs. Launch mints a short-lived ticket and bounces to the tool, which
// exchanges it for a first-party session cookie. This is what makes one-login
// SSO work when each tool is a separate Render origin.
function wireToolLinks() {
  for (const tool of TOOLS) {
    const el = document.getElementById(`toolLink-${tool}`);
    if (el) el.href = `/auth/launch?tool=${encodeURIComponent(tool)}&next=/`;
  }
  // Deep link into Preply's stamp-only Ready Mockups workflow.
  const ready = document.getElementById("toolLink-preply-ready");
  if (ready) ready.href = `/auth/launch?tool=preply&next=${encodeURIComponent("/ready-mockups")}`;
}

// ── Navigation ───────────────────────────────────────────────────────────────
function initNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      document.querySelectorAll(".nav-btn").forEach((b) => {
        b.classList.remove("active");
        b.removeAttribute("aria-current");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-current", "page");

      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
      document.getElementById(`section-${page}`).classList.add("active");
    });
  });
}

// ── Progress ─────────────────────────────────────────────────────────────────
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { inkly: false, preply: false, batchly: false };
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function initProgress() {}

function initMarkButtons() {
  TOOLS.forEach((tool) => {
    const btn = document.getElementById(`markbtn-${tool}`);
    if (!btn) return;
    btn.addEventListener("click", () => {
      progress[tool] = !progress[tool];
      saveProgress();
      renderProgress();
    });
  });
}

function renderProgress() {
  const completed = TOOLS.filter((t) => progress[t]).length;
  const pct = Math.round((completed / TOOLS.length) * 100);

  // Progress bar
  const fill = document.getElementById("progressFill");
  const label = document.getElementById("progressLabel");
  const bar = document.getElementById("progressBar");
  if (fill)  fill.style.width = `${pct}%`;
  if (label) {
    label.textContent = `${completed} / ${TOOLS.length} steps complete`;
    label.className = "progress-label" + (completed === TOOLS.length ? " done" : "");
  }
  if (bar) {
    bar.setAttribute("aria-valuenow", pct);
  }

  // Per-card updates
  TOOLS.forEach((tool, idx) => {
    const done = progress[tool];
    const prevDone = idx > 0 ? progress[TOOLS[idx - 1]] : true;

    const card = document.getElementById(`card-${tool}`);
    const dot = document.getElementById(`dot-${tool}`);
    const statusText = document.getElementById(`statustext-${tool}`);
    const markBtn = document.getElementById(`markbtn-${tool}`);

    if (card) {
      card.classList.toggle("complete", done);
    }

    if (dot && statusText) {
      if (done) {
        dot.className = "status-dot complete";
        statusText.className = "status-text complete";
        statusText.textContent = "Complete";
      } else if (prevDone) {
        dot.className = "status-dot active";
        statusText.className = "status-text active";
        statusText.textContent = tool === "inkly" ? "Ready to start" : "Ready — previous step done";
      } else {
        dot.className = "status-dot";
        statusText.className = "status-text dim";
        statusText.textContent = `Waiting for ${TOOLS[idx - 1]}`;
      }
    }

    if (markBtn) {
      markBtn.classList.toggle("marked", done);
      markBtn.setAttribute("aria-pressed", String(done));
      markBtn.textContent = done ? "✓ Complete" : "Mark complete";
    }
  });
}

// ── Store settings ────────────────────────────────────────────────────────────
async function loadStores() {
  const tbody = document.getElementById("storeTableBody");
  const banner = document.getElementById("batchlyStatusBanner");
  if (!tbody) return;

  tbody.innerHTML = `<tr class="skeleton-row"><td colspan="6" style="text-align:center;padding:32px;">Loading store data…</td></tr>`;
  if (banner) banner.hidden = true;

  let data;
  try {
    const res = await fetch("/api/stores");
    if (!res.ok) throw new Error("API error");
    data = await res.json();
  } catch {
    tbody.innerHTML = `<tr class="skeleton-row"><td colspan="6" style="text-align:center;padding:32px;color:var(--bad);">Failed to load store data. Is the inQueue server running on port 4000?</td></tr>`;
    return;
  }

  const { preplyStores = [], batchlyStores, batchlyOnline } = data;

  // Show Batchly connection status
  if (banner) {
    banner.hidden = false;
    if (batchlyOnline) {
      banner.className = "online-notice";
      banner.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
        <span><strong>Batchly is online</strong> — store data fetched live from the database.</span>`;
    } else {
      banner.className = "offline-notice";
      banner.innerHTML = `
        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3M8 10h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>
        <span><strong>Batchly is offline</strong> — Batchly DB data is unavailable. Start Batchly (<code>npm run dev</code> in the batchly folder, port 3000) and refresh to see live data.</span>`;
    }
  }

  // Build folder → preply store map
  const preplyMap = {};
  for (const s of preplyStores) {
    const folder = s.store_folder || s.storeFolder;
    if (folder) preplyMap[folder] = s;
  }

  // Build folder → batchly store map
  const batchlyMap = {};
  if (Array.isArray(batchlyStores)) {
    for (const s of batchlyStores) {
      if (s.folder) batchlyMap[s.folder] = s;
    }
  }

  // Collect all known folders in canonical order
  const allFolders = [...new Set([
    ...Object.keys(preplyMap).sort(),
    ...Object.keys(batchlyMap).sort(),
  ])].sort((a, b) => {
    // Sort Store_A, Store_B, … numerically
    const numA = parseInt(a.replace("Store_", ""), 36) || 0;
    const numB = parseInt(b.replace("Store_", ""), 36) || 0;
    return numA - numB;
  });

  if (allFolders.length === 0) {
    tbody.innerHTML = `<tr class="skeleton-row"><td colspan="6" style="text-align:center;padding:32px;">No store data found.</td></tr>`;
    return;
  }

  const rows = allFolders.map((folder) => {
    const ps = preplyMap[folder];
    const bs = batchlyMap[folder];
    const isPinned = folder === "Store_A"; // NorthWindUS safety pin

    // Determine mismatch: folder exists in one but not the other
    const onlyInPreply  = ps && !bs && batchlyOnline;
    const onlyInBatchly = !ps && bs;
    let statusBadge;
    if (!batchlyOnline) {
      statusBadge = `<span class="badge offline"><span class="dot"></span>Batchly offline</span>`;
    } else if (onlyInPreply) {
      statusBadge = `<span class="badge warn"><span class="dot"></span>Not in Batchly</span>`;
    } else if (onlyInBatchly) {
      statusBadge = `<span class="badge warn"><span class="dot"></span>Not in Preply</span>`;
    } else if (ps && bs) {
      statusBadge = `<span class="badge ok"><span class="dot"></span>Matched</span>`;
    } else {
      statusBadge = `<span class="badge warn"><span class="dot"></span>Unknown</span>`;
    }

    // Etsy connection status
    let etsyCell;
    if (!batchlyOnline) {
      etsyCell = `<span style="color:var(--text-3);font-size:12px;">—</span>`;
    } else if (bs) {
      if (bs.isConnected && bs.hasShop) {
        etsyCell = `<span class="badge ok"><span class="dot"></span>${escHtml(bs.shopName || "Connected")}</span>`;
      } else if (bs.isConnected) {
        etsyCell = `<span class="badge warn"><span class="dot"></span>Token only</span>`;
      } else {
        etsyCell = `<span class="badge offline"><span class="dot"></span>Not connected</span>`;
      }
    } else {
      etsyCell = `<span style="color:var(--text-3);font-size:12px;">—</span>`;
    }

    const preplyName = ps ? escHtml(ps.name || ps.storeName || "–") : `<span style="color:var(--text-3);">—</span>`;
    const preplySku  = ps ? `<span style="font-family:monospace;font-size:12px;color:var(--text-2);">${escHtml(ps.skuPrefix || ps.sku_prefix || "–")}</span>` : `<span style="color:var(--text-3);">—</span>`;
    const batchlyName = bs
      ? escHtml(bs.name || "–")
      : batchlyOnline
        ? `<span style="color:var(--bad);font-size:12px;">Missing</span>`
        : `<span style="color:var(--text-3);font-size:12px;">—</span>`;

    const pinnedWarning = isPinned
      ? `<span title="Critical: NorthWindUS Etsy credentials are bound to this slot" style="margin-left:6px;font-size:10px;color:var(--warn);font-weight:700;letter-spacing:.05em;">⚠ LOCKED</span>`
      : "";

    return `<tr${isPinned ? ' class="pinned"' : ''}>
      <td><span class="folder-badge${isPinned ? " highlight" : ""}">${escHtml(folder)}</span>${pinnedWarning}</td>
      <td class="store-name-cell">${preplyName}</td>
      <td>${preplySku}</td>
      <td class="store-name-cell">${batchlyName}</td>
      <td>${etsyCell}</td>
      <td>${statusBadge}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join("\n");
}

// ── Connections tab ───────────────────────────────────────────────────────────
// Read-only aggregate of /api/admin/status. All mutations (connect, test,
// disconnect) happen inside Preply/Batchly — the hub only links there.

function connBadge(kind, label) {
  const cls = kind === "ok" ? "ok" : kind === "warn" ? "warn" : kind === "bad" ? "error" : "offline";
  return `<span class="badge ${cls}"><span class="dot"></span>${escHtml(label)}</span>`;
}

function connRow(label, badgeHtml, detail = "") {
  return `<div class="conn-row">
    <span class="conn-row-label">${escHtml(label)}</span>
    <span class="conn-row-value">${badgeHtml}${detail ? `<span class="conn-row-detail">${escHtml(detail)}</span>` : ""}</span>
  </div>`;
}

function renderWarningsList(warnings) {
  if (!warnings?.length) return "";
  return `<ul class="conn-warning-list">${warnings.map((w) => `
    <li><strong style="color:${w.level === "error" ? "var(--bad)" : "var(--warn)"};">${w.level === "error" ? "Error" : "Warning"}</strong>
    — ${escHtml(w.message)} <span style="color:var(--text-3);">${escHtml(w.fix)}</span></li>`).join("")}</ul>`;
}

function renderOfflineCard(node, name, reason, openUrl) {
  const label = reason === "unauthorized"
    ? "Session not accepted — check that INQUEUE_SESSION_SECRET matches on all services"
    : reason === "timeout" ? "Timed out" : "Offline";
  node.innerHTML = `
    <div class="conn-card-head"><h2>${escHtml(name)}</h2>${connBadge("bad", reason === "offline" ? "Offline" : "Error")}</div>
    <p style="font-size:13px;color:var(--text-2);margin:10px 0;">${escHtml(label)}. Start the service and refresh.</p>
    ${openUrl ? `<a class="btn ghost sm" href="${openUrl}" target="_blank" rel="noopener">Open ${escHtml(name)}</a>` : ""}`;
}

function renderPreplyCard(node, result, urls) {
  if (!result.status) return renderOfflineCard(node, "Preply", result.reason, urls.preplyUrl);
  const s = result.status;
  const drive = s.drive || {};
  const pending = s.pendingFolder || {};
  const handoff = s.handoffMode || {};
  const driveBadge = drive.mode === "mock"
    ? connBadge("offline", "Local mock mode")
    : drive.connected ? connBadge("ok", "Connected") : connBadge("warn", "Needs setup");
  const pendingBadge = pending.lastTest?.ok
    ? connBadge("ok", "Tested")
    : pending.configured ? connBadge("warn", "Needs test") : connBadge("warn", "Needs setup");
  const handoffBadge = handoff.value === "local" && s.production
    ? connBadge("warn", `${handoff.value} (production!)`)
    : connBadge(handoff.value === "local" ? "offline" : "ok", handoff.value || "local");

  const storeRows = (s.stores || []).map((store) => {
    const badge = !store.active
      ? connBadge("offline", "Inactive")
      : store.ready ? connBadge("ok", "Ready") : connBadge("warn", "Needs setup");
    const missing = store.active && !store.ready && store.missing?.length
      ? ` — missing: ${store.missing.join(", ")}`
      : "";
    return connRow(`${store.name || store.id} (${store.store_folder || "no folder"})`, badge, missing);
  }).join("");

  node.innerHTML = `
    <div class="conn-card-head"><h2>Preply</h2>${connBadge("ok", "Online")}</div>
    ${connRow("Google Drive", driveBadge, drive.email || drive.error || "")}
    ${connRow("Pending-batches folder", pendingBadge, pending.value || "")}
    ${connRow("Handoff mode", handoffBadge, `source: ${handoff.source || "default"}`)}
    <div class="conn-divider"></div>
    <p class="conn-subhead">Stores</p>
    ${storeRows}
    ${renderWarningsList(s.warnings)}
    <div style="margin-top:14px;"><a class="btn ghost sm" href="${urls.preplyUrl}" target="_blank" rel="noopener">Open Preply Settings</a></div>`;
}

function renderBatchlyCard(node, result, urls) {
  if (!result.status) return renderOfflineCard(node, "Batchly", result.reason, urls.batchlyUrl);
  const s = result.status;
  const drive = s.drive || {};
  const pending = drive.pendingFolder || {};
  const driveBadge = drive.connected ? connBadge("ok", "Connected") : connBadge("warn", "Needs setup");
  const pendingBadge = pending.lastTest?.ok
    ? connBadge("ok", "Tested")
    : pending.configured ? connBadge("warn", "Needs test") : connBadge("warn", "Needs setup");

  const storeRows = (s.etsy?.stores || []).map((store) => {
    const badge = !store.connected
      ? connBadge("offline", "Not connected")
      : store.readinessMissing?.length ? connBadge("warn", "Setup incomplete") : connBadge("ok", "Ready");
    const detail = store.connected
      ? `${store.shopName || "shop pending"}${store.readinessMissing?.length ? ` — missing: ${store.readinessMissing.join(", ")}` : ""}`
      : "";
    return connRow(`${store.name} (${store.driveFolderName})`, badge, detail);
  }).join("");

  const duplicates = s.etsy?.duplicateDriveFolders?.length
    ? `<p style="font-size:12.5px;color:var(--bad);margin:8px 0;">Duplicate Drive folder assignment: ${escHtml(s.etsy.duplicateDriveFolders.join(", "))}</p>`
    : "";

  node.innerHTML = `
    <div class="conn-card-head"><h2>Batchly</h2>${connBadge("ok", "Online")}</div>
    ${connRow("Google Drive", driveBadge, drive.email || "")}
    ${connRow("Pending-batches folder", pendingBadge, pending.source ? `source: ${pending.source}` : "")}
    ${duplicates}
    <div class="conn-divider"></div>
    <p class="conn-subhead">Etsy stores</p>
    ${storeRows || '<p style="font-size:12.5px;color:var(--text-3);">No stores.</p>'}
    ${renderWarningsList(s.warnings)}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
      <a class="btn ghost sm" href="${urls.batchlyUrl}/settings" target="_blank" rel="noopener">Open Batchly Settings</a>
      <a class="btn ghost sm" href="${urls.batchlyUrl}/stores" target="_blank" rel="noopener">Open Batchly Stores</a>
    </div>`;
}

async function loadConnections() {
  const preplyCard = document.getElementById("connCard-preply");
  const batchlyCard = document.getElementById("connCard-batchly");
  const warningsBox = document.getElementById("connectionsWarnings");
  if (!preplyCard || !batchlyCard) return;

  preplyCard.innerHTML = '<p style="color:var(--text-3);font-size:13px;">Loading Preply status…</p>';
  batchlyCard.innerHTML = '<p style="color:var(--text-3);font-size:13px;">Loading Batchly status…</p>';

  let data;
  try {
    const res = await fetch("/api/admin/status");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    preplyCard.innerHTML = '<p style="color:var(--bad);font-size:13px;">Failed to load connection status. Is the hub running?</p>';
    batchlyCard.innerHTML = "";
    return;
  }

  const urls = { ...(window.INQUEUE_CONFIG || {}), ...(data.hub?.urls || {}) };

  if (warningsBox) {
    const hubWarnings = data.hub?.warnings || [];
    warningsBox.hidden = hubWarnings.length === 0;
    warningsBox.innerHTML = hubWarnings.length
      ? `<h3 style="margin:0 0 8px;font-size:14px;color:var(--warn);">Hub production configuration incomplete</h3>${renderWarningsList(hubWarnings)}`
      : "";
  }

  renderPreplyCard(preplyCard, data.preply || { status: null, reason: "offline" }, urls);
  renderBatchlyCard(batchlyCard, data.batchly || { status: null, reason: "offline" }, urls);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
