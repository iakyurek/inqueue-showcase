// Configure tab — Store Configuration UI.
// Data source: the hub's /api/config endpoints (see lib/configApi.js).
// Rendering strategy: full re-render from server state after every successful
// mutation, so what you see is always what is stored.

(function () {
  const SLOTS = ["Store_A", "Store_B", "Store_C", "Store_D", "Store_E", "Store_F"];
  let cfg = null;                 // last GET /api/config payload
  let loaded = false;
  const openSlots = new Set();    // accordion state survives re-renders
  let presetsOpen = false;

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function timeAgo(iso) {
    if (!iso) return "never";
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
  }
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, ok: res.ok, body: json };
  }
  function banner(message, kind) {
    const el = document.getElementById("cfgBanner");
    if (!el) return;
    if (!message) { el.hidden = true; return; }
    el.textContent = message;
    el.className = `cfg-banner${kind === "ok" ? " ok" : ""}`;
    el.hidden = false;
  }
  function chip(kind, label) {
    return `<span class="badge ${kind}"><span class="dot"></span>${esc(label)}</span>`;
  }

  // ── data ───────────────────────────────────────────────────────────────────
  async function loadConfig() {
    const { ok, body, status } = await api("GET", "/api/config");
    if (!ok) {
      banner(status === 401
        ? "Session expired — reload the page to sign in again."
        : "Store configuration is unavailable. Check that the hub can reach its storage, then refresh.");
      return;
    }
    cfg = body;
    banner(null);
    renderSyncStrip();
    renderPresets();
    renderCards();
  }

  function slotStore(slot) { return cfg.stores.find((s) => s.slot === slot); }

  // Meter segments mirror the readiness groups: Etsy · Drive · Prefix · Presets.
  function meterSegments(slot) {
    const missing = new Set(cfg.readiness[slot].missing);
    return [
      !missing.has("etsy_connected") && !missing.has("etsy_shop_identity")
        && !missing.has("etsy_taxonomy_id") && !missing.has("etsy_shipping_profile_id")
        && !missing.has("etsy_readiness_state_id"),
      !missing.has("drive_folder_id") && !missing.has("drive_folder_test"),
      !missing.has("sku_prefix"),
      !missing.has("presets_valid"),
    ];
  }

  // ── sync strip ─────────────────────────────────────────────────────────────
  function syncChip(tool) {
    const s = cfg.sync?.[tool];
    if (!s || (!s.lastAttemptAt && !s.lastSuccessAt)) {
      return `<span class="sync-chip"><span class="dot"></span>${esc(tool)}: never synced</span>`;
    }
    const inSync = s.ackedConfigVersion === cfg.configVersion && !s.lastError;
    const kind = inSync ? "ok" : s.lastError ? "error" : "warn";
    const label = inSync
      ? `${tool}: synced ${timeAgo(s.lastSuccessAt)}`
      : s.mode === "dry-run"
        ? `${tool}: dry-run (local mode)`
        : s.lastError
          ? `${tool}: ${s.lastError}`
          : `${tool}: out of sync`;
    return `<span class="sync-chip ${kind}" title="pushed v${s.pushedConfigVersion ?? "–"} · acked v${s.ackedConfigVersion ?? "–"}"><span class="dot"></span>${esc(label)}</span>`;
  }

  function renderSyncStrip() {
    const el = document.getElementById("cfgSyncStrip");
    el.innerHTML = `
      ${syncChip("preply")}
      ${syncChip("batchly")}
      <button class="btn ghost sm" data-action="sync-now">Sync now</button>`;
  }

  // ── presets panel ──────────────────────────────────────────────────────────
  function selectField(id, label, value, options, help) {
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <select id="${id}">${options.map((o) => `<option value="${esc(o)}"${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>
      ${help ? `<span class="help">${esc(help)}</span>` : ""}</div>`;
  }
  function inputField(id, label, value, opts = {}) {
    return `<div class="field"><label for="${id}">${esc(label)}</label>
      <input id="${id}" type="${opts.type || "text"}" value="${esc(value)}"${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ""}${opts.mono ? ' class="mono"' : ""}>
      ${opts.help ? `<span class="help">${esc(opts.help)}</span>` : ""}</div>`;
  }
  function checkField(id, label, checked) {
    return `<div class="field checkbox"><input id="${id}" type="checkbox"${checked ? " checked" : ""}><label for="${id}">${esc(label)}</label></div>`;
  }

  function renderPresets() {
    const p = cfg.presets;
    const el = document.getElementById("cfgPresetsPanel");
    el.className = `store-panel cfg-presets${presetsOpen ? " open" : ""}`;
    el.innerHTML = `
      <button class="cfg-presets-head" data-action="toggle-presets" aria-expanded="${presetsOpen}">
        <div>
          <h2>Draft presets</h2>
          <p class="sub">Applied to every store when Batchly creates Etsy drafts. Per-store values live on the store cards below.</p>
        </div>
        <div class="cfg-chips">
          ${chip(cfg.readiness.Store_A.missing.includes("presets_valid") ? "warn" : "ok",
                 cfg.readiness.Store_A.missing.includes("presets_valid") ? "Needs review" : "Valid")}
          <svg class="cfg-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>
      <div class="cfg-body-clip"><div class="cfg-body-inner"><div class="cfg-body">

        <div class="cfg-group">
          <div class="cfg-group-head"><h3>Listing defaults</h3><span class="hint">Used for every draft unless the manifest overrides it</span></div>
          <div class="field-grid">
            ${selectField("pv-whoMade", "Who made it", p.listing.whoMade, ["i_did", "someone_else", "collective"])}
            ${selectField("pv-whenMade", "When made", p.listing.whenMade, ["made_to_order", "2020_2026", "2010_2019", "2007_2009", "before_2007"])}
            ${selectField("pv-listingType", "Listing type", p.listing.listingType, ["physical", "download", "both"])}
            ${selectField("pv-renewalOption", "Renewal", p.listing.renewalOption, ["automatic", "manual"])}
            ${inputField("pv-defaultPrice", "Default price (USD)", p.listing.defaultPrice, { help: "Used when the manifest has no price." })}
            ${inputField("pv-defaultQuantity", "Default quantity", p.listing.defaultQuantity, { type: "number" })}
            ${inputField("pv-materials", "Materials", p.listing.materials, { help: "Comma-separated." })}
            ${checkField("pv-isPersonalizable", "Personalizable", p.listing.isPersonalizable)}
          </div>
          <div class="field-grid" style="margin-top:12px;">
            ${inputField("pv-itemWeight", "Weight", p.listing.itemWeight, { type: "number" })}
            ${selectField("pv-itemWeightUnit", "Weight unit", p.listing.itemWeightUnit, ["oz", "lb", "g", "kg"])}
            ${inputField("pv-itemLength", "Length", p.listing.itemLength, { type: "number" })}
            ${inputField("pv-itemWidth", "Width", p.listing.itemWidth, { type: "number" })}
            ${inputField("pv-itemHeight", "Height", p.listing.itemHeight, { type: "number" })}
            ${selectField("pv-itemDimensionsUnit", "Dimensions unit", p.listing.itemDimensionsUnit, ["in", "ft", "mm", "cm", "m"])}
          </div>
          <div class="field" style="margin-top:12px;">
            <label for="pv-descriptionTemplate">Description template</label>
            <textarea id="pv-descriptionTemplate" rows="3" placeholder="Appended to the listing title in every draft description.">${esc(p.listing.descriptionTemplate)}</textarea>
          </div>
        </div>

        <div class="cfg-group">
          <div class="cfg-group-head"><h3>Variations</h3><span class="hint">Same structure across all stores</span></div>
          <div class="field-grid">
            ${checkField("pv-varEnabled", "Enable variations", p.variation.enabled)}
            ${inputField("pv-var1Name", "Variation 1 name", p.variation.variation1Name)}
            ${inputField("pv-var1PropertyId", "Variation 1 property ID", p.variation.variation1PropertyId, { mono: true, help: "Required when variations are enabled." })}
            ${inputField("pv-var1Options", "Variation 1 options", p.variation.variation1Options)}
            ${inputField("pv-var2Name", "Variation 2 name", p.variation.variation2Name)}
            ${inputField("pv-var2PropertyId", "Variation 2 property ID", p.variation.variation2PropertyId, { mono: true, help: "Required when variations are enabled." })}
            ${inputField("pv-var2Options", "Variation 2 options", p.variation.variation2Options)}
            ${inputField("pv-qtyPerVariation", "Quantity per variation", p.variation.quantityPerVariation, { type: "number" })}
            ${selectField("pv-priceMode", "Price mode", p.variation.priceMode, ["manifest", "fixed"])}
            ${selectField("pv-skuMode", "SKU mode", p.variation.skuMode, ["base-option-combo", "base"])}
          </div>
        </div>

        <div class="cfg-group">
          <div class="cfg-group-head"><h3>Supplemental images</h3><span class="hint">Size charts and promo images appended after mockups</span></div>
          <div class="field-grid">
            ${checkField("pv-supEnabled", "Enable supplemental images", p.supplemental.enabled)}
            ${checkField("pv-supSizeCharts", "Include size charts", p.supplemental.includeSizeCharts)}
            ${inputField("pv-supSizeChartCount", "Required size charts", p.supplemental.sizeChartRequiredCount, { type: "number" })}
            ${checkField("pv-supPromo", "Include promo images", p.supplemental.includePromoImages)}
            ${inputField("pv-supSizeChartFolder", "Size chart folder", p.supplemental.sizeChartFolder, { mono: true })}
            ${inputField("pv-supPromoFolder", "Promo folder", p.supplemental.promoFolder, { mono: true })}
            ${inputField("pv-supMax", "Max supplemental images", p.supplemental.maxSupplementalImages, { type: "number" })}
          </div>
          <div class="cfg-actions">
            <button class="btn sm" data-action="save-presets">Save presets</button>
            <span class="result" id="presetsResult"></span>
          </div>
        </div>

      </div></div></div>`;
  }

  function collectPresets() {
    const num = (id) => Number(document.getElementById(id).value);
    const val = (id) => document.getElementById(id).value;
    const chk = (id) => document.getElementById(id).checked;
    return {
      listing: {
        whoMade: val("pv-whoMade"), whenMade: val("pv-whenMade"),
        listingType: val("pv-listingType"), renewalOption: val("pv-renewalOption"),
        isPersonalizable: chk("pv-isPersonalizable"),
        defaultQuantity: num("pv-defaultQuantity"), defaultPrice: val("pv-defaultPrice"),
        descriptionTemplate: val("pv-descriptionTemplate"), materials: val("pv-materials"),
        itemWeight: num("pv-itemWeight"), itemWeightUnit: val("pv-itemWeightUnit"),
        itemLength: num("pv-itemLength"), itemWidth: num("pv-itemWidth"), itemHeight: num("pv-itemHeight"),
        itemDimensionsUnit: val("pv-itemDimensionsUnit"),
      },
      variation: {
        enabled: chk("pv-varEnabled"),
        variation1Name: val("pv-var1Name"), variation1PropertyId: val("pv-var1PropertyId"), variation1Options: val("pv-var1Options"),
        variation2Name: val("pv-var2Name"), variation2PropertyId: val("pv-var2PropertyId"), variation2Options: val("pv-var2Options"),
        quantityPerVariation: num("pv-qtyPerVariation"),
        priceMode: val("pv-priceMode"), skuMode: val("pv-skuMode"),
      },
      supplemental: {
        enabled: chk("pv-supEnabled"), includeSizeCharts: chk("pv-supSizeCharts"),
        sizeChartRequiredCount: num("pv-supSizeChartCount"), includePromoImages: chk("pv-supPromo"),
        sizeChartFolder: val("pv-supSizeChartFolder"), promoFolder: val("pv-supPromoFolder"),
        maxSupplementalImages: num("pv-supMax"),
      },
    };
  }

  // ── store cards ────────────────────────────────────────────────────────────
  function headerChips(store) {
    const r = cfg.readiness[store.slot];
    const chips = [];
    chips.push(`<span class="cfg-meter" title="Etsy · Drive · Prefix · Presets" aria-hidden="true">${
      meterSegments(store.slot).map((done) => `<span${done ? ' class="done"' : ""}></span>`).join("")}</span>`);
    chips.push(store.etsyConnected
      ? chip("ok", store.etsyShopName || "Etsy connected")
      : chip("offline", "Etsy not connected"));
    if (store.driveFolderId) {
      chips.push(store.driveTestStatus === "ok" ? chip("ok", "Drive ok")
        : store.driveTestStatus === "failed" ? chip("error", "Drive failed") : chip("warn", "Drive untested"));
    }
    if (store.skuPrefix) chips.push(`<span class="folder-badge">${esc(store.skuPrefix)}</span>`);
    chips.push(r.ready
      ? `<span class="badge ok b-ready"><span class="dot"></span>Ready</span>`
      : `<span class="badge warn b-ready"><span class="dot"></span>${r.missing.length} to go</span>`);
    if (store.enabled) chips.push(chip("ok", "Enabled"));
    return chips.join("");
  }

  function readinessListHtml(slot) {
    const missing = new Set(cfg.readiness[slot].missing);
    return `<ul class="readiness-list">${Object.entries(cfg.readinessLabels).map(([key, label]) => `
      <li class="${missing.has(key) ? "missing" : "done"}">
        <span class="mark">${missing.has(key) ? "!" : "✓"}</span>${esc(label)}
      </li>`).join("")}</ul>`;
  }

  function cardBody(store) {
    const slot = store.slot;
    const ids = store.etsyIds || {};
    const r = cfg.readiness[slot];
    return `
      <div class="cfg-group">
        <div class="cfg-group-head"><h3>Store identity</h3></div>
        <div class="field-grid">
          ${inputField(`f-${slot}-displayName`, "Display name", store.displayName, { placeholder: "e.g. NorthwindUS" })}
          ${inputField(`f-${slot}-notes`, "Notes", store.notes, { placeholder: "Internal notes (optional)" })}
        </div>
        <div class="cfg-actions">
          <button class="btn sm" data-action="save-identity" data-slot="${slot}">Save identity</button>
          <span class="result" id="r-${slot}-identity"></span>
        </div>
        <div class="cfg-enable-row" style="margin-top:14px;">
          <div>
            <div class="lbl">${store.enabled ? "Store is enabled" : "Store is disabled"}</div>
            <div class="sub">${store.enabled
              ? "Preply and Batchly include this store in the workflow."
              : r.ready ? "All checks pass — this store can be enabled." : "Complete the readiness checklist before enabling."}</div>
          </div>
          <button class="btn ${store.enabled ? "ghost" : ""} sm" data-action="toggle-enabled" data-slot="${slot}"${!store.enabled && !r.ready ? " disabled" : ""}>
            ${store.enabled ? "Disable store" : "Enable store"}
          </button>
        </div>
        <span class="result" id="r-${slot}-enable"></span>
      </div>

      <div class="cfg-group">
        <div class="cfg-group-head"><h3>Etsy connection</h3>
          <span class="hint">${store.etsyStatusCheckedAt ? `Checked ${timeAgo(store.etsyStatusCheckedAt)}` : "Not checked yet"}</span></div>
        <div class="conn-row"><span class="conn-row-label">Status</span>
          <span class="conn-row-value">${store.etsyConnected
            ? `${chip("ok", "Connected")} <span class="mono">${esc(store.etsyShopName || "")} ${store.etsyShopId ? `(#${esc(store.etsyShopId)})` : ""}</span>`
            : chip("offline", "Not connected")}</span></div>
        <div class="cfg-actions">
          <a class="btn sm" href="/api/config/etsy/connect/${slot}">Connect Etsy</a>
          <button class="btn ghost sm" data-action="test-etsy" data-slot="${slot}">Test connection</button>
          <button class="btn ghost sm" data-action="refresh-ids" data-slot="${slot}">Refresh IDs from Batchly</button>
          <span class="result" id="r-${slot}-etsy"></span>
        </div>
        <div class="field-grid" style="margin-top:14px;">
          ${inputField(`f-${slot}-taxonomyId`, "Taxonomy ID", ids.taxonomyId ?? "", { mono: true })}
          ${inputField(`f-${slot}-shippingProfileId`, "Shipping profile ID", ids.shippingProfileId ?? "", { mono: true })}
          ${inputField(`f-${slot}-readinessStateId`, "Readiness state ID", ids.readinessStateId ?? "", { mono: true })}
          ${inputField(`f-${slot}-returnPolicyId`, "Return policy ID", ids.returnPolicyId ?? "", { mono: true, help: "Optional." })}
          ${inputField(`f-${slot}-sectionId`, "Section ID", ids.sectionId ?? "", { mono: true, help: "Optional." })}
        </div>
        <div class="cfg-actions">
          <button class="btn sm" data-action="save-ids" data-slot="${slot}">Save Etsy IDs</button>
          <span class="result" id="r-${slot}-ids"></span>
        </div>
      </div>

      <div class="cfg-group">
        <div class="cfg-group-head"><h3>Drive SKU folder</h3>
          <span class="hint">${store.driveTestedAt ? `Tested ${timeAgo(store.driveTestedAt)} — ${esc(store.driveTestStatus)}` : "Not tested yet"}</span></div>
        <div class="field-grid">
          ${inputField(`f-${slot}-driveFolderId`, "Google Drive folder ID", store.driveFolderId, {
            mono: true,
            placeholder: "e.g. 1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV",
            help: "Paste the folder ID from the Drive URL. Saving a new ID resets the access test.",
          })}
        </div>
        <div class="cfg-actions">
          <button class="btn sm" data-action="save-drive" data-slot="${slot}">Save folder</button>
          <button class="btn ghost sm" data-action="test-drive" data-slot="${slot}"${store.driveFolderId ? "" : " disabled"}>Test access</button>
          <span class="result" id="r-${slot}-drive"></span>
        </div>
        ${store.driveTestStatus === "failed" && store.driveTestDetail
          ? `<pre class="cfg-detail err">${esc(store.driveTestDetail)}</pre>`
          : ""}
      </div>

      <div class="cfg-group">
        <div class="cfg-group-head"><h3>SKU prefix</h3>
          <span class="hint">${!store.skuPrefix ? "Not set" : store.skuPrefixSource === "inferred_confirmed" ? "Inferred from Drive, confirmed" : "Set manually"}</span></div>
        <div class="field-grid">
          ${inputField(`f-${slot}-skuPrefix`, "Prefix", store.skuPrefix, { mono: true, placeholder: "e.g. CU", help: "1–6 uppercase letters. New SKUs continue from the highest number in the Drive folder." })}
        </div>
        <div class="cfg-actions">
          <button class="btn sm" data-action="save-prefix" data-slot="${slot}">Save prefix</button>
          <button class="btn ghost sm" data-action="infer-prefix" data-slot="${slot}"${store.driveFolderId ? "" : " disabled"}>Scan folder for prefix</button>
          <span class="result" id="r-${slot}-prefix"></span>
        </div>
        <div id="candidates-${slot}"></div>
      </div>

      <div class="cfg-group">
        <div class="cfg-group-head"><h3>Readiness</h3>
          <span class="hint">${r.ready ? "All checks pass" : `${r.missing.length} of ${Object.keys(cfg.readinessLabels).length} checks missing`}</span></div>
        ${readinessListHtml(slot)}
      </div>`;
  }

  function renderCards() {
    const wrap = document.getElementById("cfgCards");
    wrap.innerHTML = SLOTS.map((slot) => {
      const store = slotStore(slot);
      const open = openSlots.has(slot);
      const configured = store.displayName || store.skuPrefix || store.driveFolderId || store.etsyConnected;
      return `
        <div class="cfg-card${open ? " open" : ""}${store.enabled ? " enabled" : ""}" data-slot="${slot}">
          <button class="cfg-card-head" data-action="toggle-card" data-slot="${slot}" aria-expanded="${open}">
            <span class="cfg-card-title">
              <span class="folder-badge${slot === "Store_A" ? " highlight" : ""}">${slot}</span>
              <span class="cfg-card-name">${configured ? esc(store.displayName || "(unnamed)") : '<span class="unset">Not configured</span>'}</span>
            </span>
            <span class="cfg-chips">${configured ? headerChips(store) : `${chip("offline", "Not configured")}`}</span>
            <svg class="cfg-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="cfg-body-clip"><div class="cfg-body-inner"><div class="cfg-body">${open ? cardBody(store) : ""}</div></div></div>
        </div>`;
    }).join("");
  }

  // ── actions ────────────────────────────────────────────────────────────────
  function result(slot, group, message, kind) {
    const el = document.getElementById(`r-${slot}-${group}`);
    if (!el) return;
    el.textContent = message;
    el.className = `result${kind ? ` ${kind}` : ""}`;
  }

  async function put(slot, patch, group) {
    const store = slotStore(slot);
    const { status, body } = await api("PUT", `/api/config/stores/${slot}`, { ...patch, expectedRowVersion: store.rowVersion });
    if (status === 200) { await loadConfig(); return true; }
    if (status === 409) { banner("This store changed elsewhere — reloading the latest values."); await loadConfig(); return false; }
    if (status === 422 && body?.error === "NOT_READY") {
      result(slot, group, `Not ready — complete the checklist first (${body.missing.length} missing).`, "err");
      return false;
    }
    if (status === 422) {
      result(slot, group, body?.errors?.map((e) => `${e.field}: ${e.message}`).join("; ") || "Validation failed.", "err");
      return false;
    }
    result(slot, group, `Save failed (${status}).`, "err");
    return false;
  }

  const idVal = (id) => {
    const v = document.getElementById(id)?.value?.trim();
    return v === "" || v === undefined ? null : v;
  };

  const actions = {
    "toggle-card": (slot) => {
      openSlots.has(slot) ? openSlots.delete(slot) : openSlots.add(slot);
      renderCards();
    },
    "toggle-presets": () => { presetsOpen = !presetsOpen; renderPresets(); },
    "save-presets": async () => {
      const el = document.getElementById("presetsResult");
      const { status, body } = await api("PUT", "/api/config/presets", collectPresets());
      if (status === 200) { presetsOpen = true; await loadConfig(); }
      else if (el) {
        el.textContent = body?.errors?.map((e) => `${e.field}: ${e.message}`).join("; ") || `Save failed (${status}).`;
        el.className = "result err";
      }
    },
    "save-identity": (slot) => put(slot, {
      displayName: document.getElementById(`f-${slot}-displayName`).value,
      notes: document.getElementById(`f-${slot}-notes`).value,
    }, "identity"),
    "toggle-enabled": (slot) => put(slot, { enabled: !slotStore(slot).enabled }, "enable"),
    "save-ids": (slot) => put(slot, {
      etsyIds: {
        taxonomyId: idVal(`f-${slot}-taxonomyId`),
        shippingProfileId: idVal(`f-${slot}-shippingProfileId`),
        readinessStateId: idVal(`f-${slot}-readinessStateId`),
        returnPolicyId: idVal(`f-${slot}-returnPolicyId`),
        sectionId: idVal(`f-${slot}-sectionId`),
      },
    }, "ids"),
    "save-drive": (slot) => put(slot, { driveFolderId: document.getElementById(`f-${slot}-driveFolderId`).value.trim() }, "drive"),
    "save-prefix": (slot) => put(slot, {
      skuPrefix: document.getElementById(`f-${slot}-skuPrefix`).value.trim().toUpperCase(),
      skuPrefixSource: "manual",
    }, "prefix"),
    "test-drive": async (slot) => {
      result(slot, "drive", "Testing folder access…");
      const { status, body } = await api("POST", `/api/config/stores/${slot}/test-drive`);
      if (status === 200) await loadConfig();
      else result(slot, "drive", body?.error === "PREPLY_UNREACHABLE" ? "Preply is unreachable — start it and retry." : `Test failed (${status}).`, "err");
    },
    "test-etsy": async (slot) => {
      result(slot, "etsy", "Checking connection via Batchly…");
      const { status, body } = await api("POST", `/api/config/stores/${slot}/test-etsy`);
      if (status === 200 && body.persisted === false) result(slot, "etsy", "Batchly is unreachable — start it and retry.", "err");
      else if (status === 200) await loadConfig();
      else result(slot, "etsy", `Check failed (${status}).`, "err");
    },
    "refresh-ids": async (slot) => {
      result(slot, "etsy", "Importing IDs from Batchly…");
      const { status, body } = await api("POST", `/api/config/stores/${slot}/refresh-etsy-ids`);
      if (status === 200 && body.persisted !== false) await loadConfig();
      else result(slot, "etsy", body?.persisted === false ? "Batchly is unreachable — start it and retry." : `Import failed (${status}).`, "err");
    },
    "infer-prefix": async (slot) => {
      result(slot, "prefix", "Scanning Drive folder…");
      const { status, body } = await api("POST", `/api/config/stores/${slot}/infer-prefix`);
      const box = document.getElementById(`candidates-${slot}`);
      if (status !== 200) {
        result(slot, "prefix", body?.error === "PREPLY_UNREACHABLE" ? "Preply is unreachable — start it and retry." : `Scan failed (${status}).`, "err");
        return;
      }
      result(slot, "prefix", "");
      if (!body.candidates.length) {
        box.innerHTML = `<p class="help" style="margin-top:10px;">No SKU-shaped folders found (looking for names like CU16). Set the prefix manually.</p>`;
        return;
      }
      box.innerHTML = `
        <ul class="candidate-list">${body.candidates.map((c, i) => `
          <li><input type="radio" name="cand-${slot}" id="cand-${slot}-${i}" value="${esc(c.prefix)}"${i === 0 ? " checked" : ""}>
            <label for="cand-${slot}-${i}"><span class="mono">${esc(c.prefix)}</span></label>
            <span class="meta">${c.count} folders · highest ${esc(c.example)}</span></li>`).join("")}
        </ul>
        <div class="cfg-actions">
          <button class="btn sm" data-action="confirm-prefix" data-slot="${slot}">Use selected prefix</button>
        </div>`;
    },
    "confirm-prefix": async (slot) => {
      const chosen = document.querySelector(`input[name="cand-${slot}"]:checked`);
      if (!chosen) return;
      await put(slot, { skuPrefix: chosen.value, skuPrefixSource: "inferred_confirmed" }, "prefix");
    },
    "sync-now": async () => {
      banner("Syncing configuration to Preply and Batchly…", "ok");
      const { status, body } = await api("POST", "/api/config/sync", {});
      if (status !== 200) { banner(`Sync failed (${status}).`); return; }
      const parts = body.results.map((r) => {
        if (r.applied) return `${r.tool}: applied v${r.appliedVersion}`;
        if (r.mode === "dry-run") return `${r.tool}: dry-run — ${r.diff?.length ?? 0} pending change${(r.diff?.length ?? 0) === 1 ? "" : "s"} (tool is in local mode)`;
        return `${r.tool}: ${r.error || "not applied"}`;
      });
      banner(`Sync finished — ${parts.join(" · ")}`, body.results.every((r) => r.applied) ? "ok" : undefined);
      await loadConfig();
    },
  };

  // ── wiring ─────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const section = document.getElementById("section-configure");
    if (!section) return;
    document.querySelectorAll('[data-page="configure"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        if (loaded) return;
        loaded = true;
        loadConfig();
      });
    });
    section.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target || target.disabled) return;
      const handler = actions[target.dataset.action];
      if (handler) handler(target.dataset.slot);
    });

    // Returning from the Batchly-brokered Etsy OAuth flow: the callback sends
    // the browser to  <hub>/configure?etsy=connected|error&store=Store_X[&reason=]
    // (the hub serves index.html for /configure). Open the tab, report the
    // outcome, then clean the URL so a refresh doesn't replay the message.
    const params = new URLSearchParams(window.location.search);
    const onConfigurePath = window.location.pathname === "/configure";
    if (onConfigurePath || window.location.hash === "#configure" || params.has("etsy")) {
      const configureBtn = document.querySelector('.nav-btn[data-page="configure"]');
      if (configureBtn) configureBtn.click();
      if (params.has("etsy")) {
        const outcome = params.get("etsy");
        const slot = params.get("store") || "";
        const label = slot ? `${slot}: ` : "";
        // Banner is set after the config load so the render doesn't clear it.
        setTimeout(() => banner(etsyReturnMessage(outcome, params.get("reason"), label),
                                outcome === "connected" ? "ok" : undefined), 300);
      }
      window.history.replaceState(null, "", "/configure");
    }
  });

  // Translate the callback's status codes into something the operator can act on.
  function etsyReturnMessage(outcome, reason, label) {
    if (outcome === "connected") {
      return `${label}Etsy connected. Run "Test connection" on the store card to pull the shop identity into the hub.`;
    }
    const help = {
      // Batchly has no row for this slot yet (e.g. a fresh database).
      store_not_synced: 'this store has not reached Batchly yet. Click "Sync now" above, then try Connect Etsy again.',
      missing_credentials: "Batchly is missing ETSY_CLIENT_ID / ETSY_CLIENT_SECRET.",
      shop_already_connected: "that Etsy shop is already connected to a different store slot.",
      invalid_store_folder: "the store slot was not recognized.",
      access_denied: "the Etsy authorization was declined.",
    }[reason || ""];
    return `${label}Etsy connection failed — ${help || reason || "unknown error"}`;
  }
})();
