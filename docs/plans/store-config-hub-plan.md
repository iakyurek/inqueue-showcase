# Store Configuration Hub — Implementation Plan

> Status: approved 2026-07-10 · branch `feature/hub-store-config`
> Phases P0–P5 implemented in this branch; P6 items deferred (see Implementation phases).

## Context

The inQueue suite (hub + Inkly + Preply + Batchly) runs the workflow Preply → Batchly → Etsy
draft listings. Store setup today is scattered: Preply keeps store mappings in
`preply/data/stores.json` (its own editable Store Settings tab), Batchly keeps Etsy
connection/tokens + per-store Etsy resource IDs + shared listing presets in its Prisma DB,
and the hub only aggregates read-only status. The user wants the hub to become the single
place to configure stores — a new **Configure** tab with 6 fixed store slots
(Store_A..Store_F), backed by Postgres as source of truth — with Preply and Batchly
automatically consuming that configuration, and a strict readiness model gating which
stores the tools may use. Store_A (NorthWindUS, prefix CU, the only live store) must
keep working unchanged until the new path is proven.

## Current repo findings (verified by exploration)

**Hub (root)** — pure Node stdlib server (`server.js` ~310 lines), **zero runtime deps**, static
`public/` vanilla JS. Read-only aggregator: `GET /api/stores` fs-reads `preply/data/stores.json` +
fetches Batchly `/api/dashboard/summary` (cookie-forwarded, 3s timeout); `GET /api/admin/status`
polls tools. Auth = HMAC cookie (`lib/auth.js`) + `isPublicPath` allow-list gate (unauth `/api/*` → 401).
`lib/sso.js` = hub-brokered SSO. `lib/productionGuardrails.js` = prod env warnings. Tabs are generic:
`.nav-btn[data-page]` + `.section#section-<page>` via `initNav()` — a new tab needs no nav JS changes.
Design tokens in `styles.css` (dark, Inter, `--accent #8fb6ff`, `.badge.ok/.warn/.error/.offline`,
`.store-panel`, `.btn/.ghost/.sm`, `.folder-badge`). Tests = plain node scripts (`node:assert/strict`)
+ HTTP tests that spawn `server.js` on a scratch port + root Playwright (baseURL :4000).

**Preply** — 3506-line single-file Node server, deps only `googleapis`+`jszip`, **no DB** (flat JSON).
Already has a full store-config subsystem: `data/stores.json` = 6 stores
(`id, name, code/skuPrefix, active, skuRootFolderId, store_folder Store_A..F, logo*, sku-scan fields, notes`,
dual camelCase/snake_case aliases via `normalizeStore` :676). Store_A = northwindus, prefix **CU**,
only `active:true`, only real Drive folder (scanned CU16 → next CU17); B–F have `mock-drive-*` placeholders.
`saveStores()` (:837) enforces ≤8 active, unique `store_folder`, and the activation gate
`activeStoreReadinessError()` (:817: active ⇒ prefix + real Drive folder + store_folder + logo).
Endpoints: `POST /api/stores`, `POST /api/stores/:id/test-drive` (**mutates store — don't reuse directly**),
`POST /api/stores/:id/scan-sku` (regex `^<prefix>(\d+)$` over Drive child folders),
`GET /api/settings/status` (per-store `{ready, missing[]}`). Drive adapter modes mock/service_account/oauth
(`GOOGLE_DRIVE_AUTH_MODE`); OAuth user mode is the working one. `saveStores`/`activeStoreReadinessError`
are exported → sync endpoint is unit-testable.

**Batchly** — Next.js + Prisma; SQLite dev, Postgres planned for prod (docs/deployment.md §3; prod
guardrail rejects `file:` DATABASE_URL). `Store {cuid, name, etsyShopName?, driveFolderName @unique
(join key; 8 seeded Store_A..Store_H), skuPrefix, accessToken?, refreshToken?, tokenExpiresAt?, etsyShopId?}`
+ per-store `StoreEtsyIds {taxonomyId?, shippingProfileId?, readinessStateId?, returnPolicyId?, sectionId?}`.
**No NorthWindUS string anywhere; no per-store enabled bool** — enablement is the hardcoded
`MINI_BATCH_ENABLED_STORE_FOLDERS` Set (currently ALL 8) in `src/lib/services/draftFlowHelpers.ts:16-25`,
plus legacy Store_A-only routes. Etsy OAuth: working PKCE (single-use state files `.tokens/etsy-pkce-*.json`,
duplicate-shop guard, tokens ON the Store row, `refreshAccessToken(storeId)` per-store mutex with rotated-token
writeback). Presets: single-row `GlobalListingPreset` + `GlobalVariationPreset` + `GlobalSupplementalImagePreset`;
draft creation (`loadPresetAndIds`, draftFlowHelpers.ts:151) hard-requires listing preset + taxonomyId +
shippingProfileId + readinessStateId. Readiness consumed by hub = dashboard `storeReadiness[]`
(`fullyReady = isConnected && hasShop && 3 required IDs`). `AppSetting` KV = DB-overrides-env pattern.
Middleware = shared or first-party SSO cookie; Edge-compatible HMAC verify already exists (reusable for
service tokens).

**Confirmed user decisions:** ① Etsy OAuth brokered through Batchly (not rebuilt in hub);
② storage adapter — Postgres when `INQUEUE_DATABASE_URL` set, local JSON file in dev;
③ presets stay shared/global (matching Batchly's engine), per-store = the 5 Etsy resource IDs.

## Recommended architecture & reasoning

**Hub = Postgres-backed source of truth + orchestrator. Tools stay executors. Config flows by
PUSH-SYNC into each tool's existing local store through new service-token-authenticated internal
endpoints that reuse the tools' existing validated save paths.**

Why not the alternatives:
- **Tools reading shared Postgres directly** — Preply has no DB layer at all (adding one is high-risk churn);
  for Batchly it would put a second writer (hub raw-SQL migrations) into a Prisma-owned schema across two
  codebases with no shared migration ordering, and it breaks local dev where Batchly is SQLite.
- **Tools calling hub API at runtime** — puts the hub in the draft-creation money path and breaks the tools'
  offline-tolerant design.
- **Push-sync** keeps hot paths byte-identical (Preply keeps reading `stores.json`; Batchly keeps reading
  Prisma), keeps each schema self-owned, makes fallback trivial (local config always present), and is
  independently testable.

Key protocol decisions (from design pass):
- **Full-state replace, not deltas** — retries and drift recovery are trivial; re-applying the same payload
  is a no-op by construction.
- **Partial failure = visible drift, never rollback** — hub save always commits locally; per-tool
  `sync_state` shows "out of sync since X" with a Sync-now button.
- **Etsy brokering is the permanent design, not a stopgap** — Batchly is the only Etsy API consumer; its
  registered redirect URI points at Batchly; moving tokens buys nothing and risks the refresh-mutex/
  rotation machinery. Hub owns *connection status + shop identity* (mirrored, always shown with
  `checked_at` staleness); Batchly is the token custodian. Hub token custody stays documented as a
  contingency only.

## Database / schema (hub-owned)

New `lib/db.js`: storage adapter interface (`load`, `saveStore(slot,patch)`, `savePresets`,
`recordSync`, `nextVersion`) with two impls — **Postgres** (`pg`, hub's first runtime dep) and
**JSON file** `data/store-config.json` (dev). One shared validation layer above both.
Migration runner (~50 lines): numbered `migrations/*.sql`, `pg_advisory_lock` around the run,
each applied in a transaction, recorded in `schema_migrations`; runs at hub boot when
`INQUEUE_DATABASE_URL` is set. **Guardrail fails closed:** in production a missing/`file:`/localhost
`INQUEUE_DATABASE_URL` is a startup error — never a silent JSON fallback.

`migrations/001_init.sql` (abridged; full DDL from design pass):
- `store_config` — PK `slot` CHECK `^Store_[A-F]$`; `display_name`, `enabled` (default false);
  `sku_prefix` CHECK `^[A-Z]{1,6}$` + `sku_prefix_source` (`unset|manual|inferred_confirmed`);
  `drive_folder_id` CHECK `^[A-Za-z0-9_-]{10,100}$` + `drive_test_status` (`untested|ok|failed`)
  + `drive_test_detail` + `drive_tested_at`;
  Etsy mirror: `etsy_shop_id`, `etsy_shop_name`, `etsy_connected`, `etsy_status_checked_at`
  (status only — **no tokens**); per-store Etsy resource IDs (5 bigint columns);
  `notes`, `row_version` (optimistic concurrency), timestamps.
- `presets` — PK `scope` default `'global'` (future per-store overrides = new rows, not a redesign);
  `listing`/`variation`/`supplemental` JSONB.
- `config_meta` — single row, `config_version` bumped on every write.
- `sync_state` — PK `tool` (`preply|batchly`); attempt/success timestamps, last_error,
  `pushed_config_version` vs `acked_config_version`, reported `mode`.
- `schema_migrations`.

Future encryption slot-in: `lib/crypto.js` — AES-256-GCM `encryptSecret`/`decryptSecret`, key env
`INQUEUE_CONFIG_ENC_KEY` (base64 32 bytes), versioned format `enc:v1:<iv>:<tag>:<ct>`. Near-term best
use is **inside Batchly** to encrypt `Store.accessToken/refreshToken` at rest (legacy plaintext values
detected by missing prefix, re-encrypted on next write) — independently shippable (P6).

## Hub API surface (all behind existing auth gate; unauth `/api/*` → 401)

| Route | Purpose / key rules |
|---|---|
| `GET /api/config` | Full state: `{configVersion, stores[], presets, sync:{preply,batchly}, readiness per slot {ready, missing[]}}` |
| `PUT /api/config/stores/:slot` | Partial update + `expectedRowVersion` (409 on mismatch). Server-side validation: slot regex, name ≤80, prefix `^[A-Z]{1,6}$`, folder-id regex, IDs positive ints. Changing `driveFolderId` resets drive test to `untested`. **Enable gate:** `enabled:true` → 422 `{missing:[...]}` unless readiness passes |
| `PUT /api/config/presets` | Validates exactly what Batchly's draft path consumes (whoMade/whenMade enums, qty 1–999, price > 0, variation propertyIds required when enabled…) |
| `POST /api/config/stores/:slot/test-drive` | Proxies Preply `/api/internal/drive/test-folder` (service token, 5s timeout); persists result |
| `POST /api/config/stores/:slot/infer-prefix` | Proxies Preply infer endpoint; returns candidates; **does not write** — client PUTs prefix with `skuPrefixSource:'inferred_confirmed'` after user confirms |
| `POST /api/config/stores/:slot/test-etsy` | Proxies Batchly test-connection; persists mirror + `checked_at`; unreachable → `{connected:false, reason:'unreachable'}`, mirror untouched (never fake either direction) |
| `POST /api/config/stores/:slot/refresh-etsy-ids` | Imports current `StoreEtsyIds` from Batchly into hub row (keeps Batchly's `auto-setup-store` usable; hub imports rather than fights it) |
| `GET /api/config/etsy/connect/:slot` | 302 → Batchly `/api/auth/etsy/start?storeFolder=<slot>&returnTo=<INQUEUE_HUB_URL>/#configure`. returnTo built **server-side from env**, never from request input |
| `POST /api/config/sync` | Push full-state payload to one/both tools; returns per-tool `{applied, appliedVersion, mode, diff?, error?}` |

**Service auth:** new `lib/serviceAuth.js` (follows `lib/sso.js` conventions) —
`createServiceToken({svc:'hub', aud, exp: now+60s})` HMAC-SHA256 with `INQUEUE_SESSION_SECRET`, sent as
`Authorization: Bearer`; `verifyServiceToken(token, expectedAud)` on the tool side (Preply: ~30-line
node:crypto copy; Batchly: reuses the subtle-crypto HMAC helpers already in `middleware.ts`).

## Sync protocol

Payload: `{configVersion, generatedAt, stores:[{slot, displayName, enabled, skuPrefix, driveFolderId,
notes, etsyIds{...}}], presets:{listing, variation, supplemental}}` → both tools, same shape.
Response: `{applied, mode:'hub'|'dry-run'|'local-disabled', appliedVersion?, diff?, error?, warnings?}`.

- **Idempotency:** tools persist `lastAppliedVersion` (Preply `data/hub-config-state.json`; Batchly
  `AppSetting` key). Stale version → `applied:false, error:'stale'`. Full-state ⇒ replays converge.
- **Store_A protection, concretely:**
  1. Feature flag `INQUEUE_STORE_CONFIG_SOURCE=local` (default, both tools): sync endpoint validates and
     returns a **dry-run diff** (`{slot, field, current, incoming}`) without writing. Only `=hub` applies.
  2. Preply apply path goes **through `saveStores()`** — all existing invariants self-enforce; gate
     rejection → `applied:false` + error surfaced in hub UI, `stores.json` untouched. Hub-unowned fields
     (logo, SKU-scan state) are merge-preserved.
  3. Preply writes a timestamped backup (`data/backups/stores-<ts>.json`, keep 10) before every apply.
  4. **Flip runbook:** seed hub from live values → Sync (local flag) → confirm **empty diff for Store_A** →
     flip flag → sync → verify Preply `/api/settings/status` + Batchly summary unchanged.

## Etsy OAuth (brokered)

Hub "Connect Etsy" → hub 302 route → Batchly `/api/auth/etsy/start` (SSO-protected as today) → Etsy →
Batchly callback → back to hub Configure tab. Batchly changes:
- `start/route.ts`: accept `storeFolder` alternative to `storeId` (resolve via `driveFolderName` — hub never
  learns cuids); accept `returnTo` validated **origin-exact against `INQUEUE_HUB_URL`** else dropped; persist
  in the single-use PKCE state file (`writePkceState` already the natural carrier).
- `callback/route.ts`: read `returnTo` from the state file (**never from callback query — anti-open-redirect**);
  all terminal redirects (success + every error branch) honor it with `?etsy=connected|error&reason=`.
- New `POST /api/internal/etsy/test-connection {storeFolder}`: no refreshToken → `{connected:false,
  reason:'not_connected'}`; else `refreshAccessToken` + fetch shop identity (read-only vs shop data; the token
  refresh is an auth call, within the no-writes constraint).

## Drive folder test + SKU prefix scan (via Preply)

Preply owns the working Drive OAuth client. Two **new, pure** internal endpoints (no store mutation —
factor the Drive call out of the existing `:3109` handler rather than reusing it):
- `POST /api/internal/drive/test-folder {folderId}` — `files.get` + one-page children list via the existing
  adapter (works in mock mode for tests). Read-only.
- `POST /api/internal/drive/infer-prefix {folderId}` — single page `pageSize:100` (the "limited scan" bound),
  match `^([A-Z]{1,6})(\d+)$`, return `candidates:[{prefix,count,maxNumber,example}]` sorted by count.
  No writes; hub UI shows candidates ("CU — 16 folders, highest CU16"), user confirms before saving.

## Hub Configure tab UI

- `public/index.html`: add `.nav-btn[data-page="configure"]` + `section#section-configure` + new
  `public/configure.js` (initNav handles switching for free). New CSS section in `styles.css` reusing
  tokens/`.badge.*`/`.btn`/`.store-panel`/`.folder-badge`; new `.config-card`, `.chip-row`,
  `.accordion-body`, `.field/.field-grid`, `.candidate-list`, `.readiness-list`.
- Top of tab: **shared Draft Presets panel** (explicit copy: "Presets apply to all stores") + **sync strip**
  (per-tool chips ok/out-of-sync/unreachable with timestamps + Sync now).
- Six fixed accordion cards (`.store-panel.config-card[data-slot]`):
  - Header (a `<button>`, `aria-expanded`): `.folder-badge` Store_X · display name · chips: readiness,
    Enabled/Disabled, Etsy (shop name or "Not connected"), Drive (ok/failed/untested) · chevron.
  - Body, five groups, each with its own Save (PUT + `expectedRowVersion`; 409 → "Reload — changed elsewhere"):
    1. **Identity** — display name, notes, Enabled toggle (disabled until ready; 422 `missing[]` rendered
       as inline checklist).
    2. **Etsy Connection** — status block w/ "checked N min ago", `Connect via Batchly`, `Test Connection`,
       `Refresh IDs from Batchly`, five resource-ID inputs.
    3. **Drive SKU Folder** — folder-ID input + `Test access` + last result; editing visibly resets to untested.
    4. **SKU Prefix** — value + source chip, `Infer from Drive` → radio candidates + Confirm; manual always available.
    5. **Readiness** — checklist of the predicate with per-item ok/missing.
  - Empty state: "Not configured" `.badge.offline` + Set-up CTA. Error states: inline `.badge.error` + retry;
    page banner if `GET /api/config` fails.
- Load `frontend-design` skill at implementation time for the visual pass.

**Canonical readiness predicate (hub):** `enabled && etsy_connected && shop identity present &&
taxonomyId && shippingProfileId && readinessStateId && drive_folder_id set && drive_test_status='ok' &&
sku_prefix valid && presets valid` → `{ready, missing[]}` per slot.

## Preply integration

`preply/server.js`: service-token verify (before session gate) + 3 internal endpoints
(config-sync w/ dry-run/apply/backup as above; drive test-folder; infer-prefix) +
`configSource`/`lastAppliedVersion` added to `/api/settings/status`. Store Settings tab: when
`configSource==='hub'`, warning banner "Managed by Hub Configure — local edits overwritten on next sync";
form stays editable as a documented emergency escape hatch.

## Batchly integration

- Prisma migration: `Store.configEnabled Boolean?` (nullable tri-state; null = never synced).
- New `src/app/api/internal/config-sync/route.ts`: verify service token; flag-aware dry-run/apply; upsert
  `Store.name/skuPrefix/configEnabled` + `StoreEtsyIds` per slot + the three `Global*Preset` singletons;
  write appliedVersion to `AppSetting`. **Never touches accessToken/refreshToken/etsyShopId.**
- New `src/app/api/internal/etsy/test-connection/route.ts` (above).
- `middleware.ts`: `/api/internal/*` → verify service Bearer token (aud `batchly`) instead of cookies;
  invalid → 401. NOT added to `EXEMPT_PATHS`.
- `draftFlowHelpers.ts`: new `isStoreFolderEnabled(storeFolder)` — flag `hub` ⇒ `store.configEnabled === true`;
  flag `local`/unset ⇒ existing `MINI_BATCH_ENABLED_STORE_FOLDERS` behavior **byte-for-byte**. Replace Set
  reads at call sites (`store-mini-batch-create`, `store-mini-batch-preflight`; legacy `store-a-*` routes are
  Store_A-only and keep working). Boot warning if flag=hub but no store has non-null `configEnabled`.
- OAuth `storeFolder`/`returnTo` changes (above).

## Backward compatibility / migration

1. `scripts/seed-store-config.mjs` seeds hub storage from live `preply/data/stores.json` (Etsy mirror
   populated later via test-etsy/refresh-ids). Store_A starts enabled+correct; B–F disabled.
2. Both tools default `INQUEUE_STORE_CONFIG_SOURCE=local` — dry-run only; nothing changes in behavior.
3. Flip per tool only after the empty-diff check (runbook in §Sync). Preply first, then Batchly.
4. `stores.json` remains Preply's runtime source (hub is the writer of record) — it IS the fallback.
5. Batchly Store_G/H: once flag flips, they become disabled (today they're in the hardcoded Set but
   unconnected). Intended, called out in runbook.

## Security model

- All config APIs behind existing hub session gate; server-side validation of slot/prefix/folder-id/IDs/presets;
  JSON body size caps (existing 100KB reader).
- Service-to-service: short-lived HMAC Bearer tokens (aud-scoped, 60s exp) — no cookies server-to-server.
- No tokens in hub DB (Batchly custodian); mirror is status-only; UI always shows `checked_at`.
- OAuth returnTo: server-built on hub side; origin-exact validated + state-file-carried on Batchly side. No open redirects.
- No hardcoded URLs — all via `INQUEUE_HUB_URL`/`<TOOL>_BASE_URL`; guardrails extended (below).
- ⚠️ Pre-existing, surfaced loudly: real secrets are committed in `preply/` (service-account key, OAuth client
  secret, live refresh token). Rotation+purge is an independent urgent workstream (P6 note) — not buried.

## Env vars & guardrails

New: `INQUEUE_DATABASE_URL` (hub; prod-required), `INQUEUE_STORE_CONFIG_SOURCE=local|hub` (each tool,
default `local`), `INQUEUE_CONFIG_ENC_KEY` (reserved for P6). Reused: `INQUEUE_SESSION_SECRET`,
`INQUEUE_HUB_URL`, `PREPLY_BASE_URL`/`BATCHLY_BASE_URL`. Update `.env.example` (placeholders only) + docs.
`lib/productionGuardrails.js`: prod error on missing/`file:`/localhost `INQUEUE_DATABASE_URL`; warn on
malformed enc key; tools warn if flag=hub but sync never applied.

## Test plan (repo-native styles)

- **Node assert scripts**: `lib/service-auth.test.mjs` (sign/verify/aud/exp/tamper);
  `lib/store-config-validation.test.mjs` (slot/prefix/folder-id rules, enable gate 422, readiness predicate);
  migration-runner unit (ordering, idempotent re-run, fake pg client).
- **HTTP spawn tests** (pattern: `auth-http.test.mjs`): hub on scratch port with JSON adapter — CRUD, 401
  unauth, 422 enable-gate `missing[]`, 409 rowVersion, proxy timeout/degradation against stub tool servers,
  sync dry-run diff rendering.
- **Preply**: unit-test sync mapping via exported `saveStores`/`activeStoreReadinessError`;
  `GOOGLE_DRIVE_AUTH_MODE=mock` for test-folder/infer-prefix; dry-run vs apply; backup creation.
- **Batchly**: thin routes over service functions; config-sync upsert/diff + enablement fallback tests
  (match Batchly's existing tsx-script test convention); **returnTo origin-validation unit test mandatory**.
- **Playwright** (root): Configure tab renders 6 cards, expand/collapse, save round-trip, enable toggle
  surfaces missing checklist, sync chips, presets panel labeled shared.
- Skills to use during implementation: `frontend-design` (UI pass), `code-review` + `verify` before handoff,
  `playwright-qa` for the e2e pass.

## Implementation phases (each independently shippable, Store_A-safe order)

- **P0 — Service auth**: `lib/serviceAuth.js` + tests. No behavior change.
- **P1 — Hub storage + APIs**: `package.json` (+`pg`), `lib/db.js`, `migrations/001_init.sql`,
  `lib/storeConfig.js` (validation+readiness), `server.js` routes, seed script, guardrails, tests.
  Nothing calls the tools yet.
- **P2 — Configure tab UI**: `index.html`, `configure.js`, `styles.css`. Proxy-backed buttons disabled
  with "available after tool integration" tooltips.
- **P3 — Preply integration**: internal endpoints + banner + status fields; hub proxies + sync push wired.
  Flag stays `local` (dry-run).
- **P4 — Batchly integration**: Prisma migration, internal routes, middleware service-token branch,
  OAuth storeFolder/returnTo, `isStoreFolderEnabled` refactor (flag `local` = today's behavior).
- **P5 — Flip**: runbook execution (Preply → Batchly), Playwright e2e, docs (`docs/deployment.md` env
  matrix + Render notes: hub + Render Postgres, boot migrations under advisory lock, no new inbound ports).
- **P6 — Deferred, documented**: Batchly token encryption at rest; per-store preset overrides
  (`presets.scope`); hub token custody contingency; **rotate committed Preply Google credentials (urgent)**.

## Files likely to change

- Hub: `server.js`, `package.json`, new `lib/serviceAuth.js`, `lib/db.js`, `lib/storeConfig.js`,
  `migrations/001_init.sql`, `scripts/seed-store-config.mjs`, `public/index.html`, new `public/configure.js`,
  `public/styles.css`, `lib/productionGuardrails.js`, `.env.example`, `docs/deployment.md`,
  new `docs/plans/store-config-hub-plan.md` (this doc), new tests in `lib/`.
- Preply: `preply/server.js` (internal endpoints, status fields), `preply/public/` (banner), tests.
- Batchly: `prisma/schema.prisma` (+migration), new `src/app/api/internal/config-sync/route.ts`,
  new `src/app/api/internal/etsy/test-connection/route.ts`, `src/middleware.ts`,
  `src/app/api/auth/etsy/start/route.ts`, `.../callback/route.ts`, `src/lib/services/etsy.ts` (state type),
  `src/lib/services/draftFlowHelpers.ts`, tests.

## Risks & open questions

- **StoreEtsyIds authority**: Batchly `auto-setup-store` writes IDs locally; under flag=hub the next sync
  overwrites them. Decision: keep auto-setup usable, hub `refresh-etsy-ids` imports after; runbook states
  hub is authoritative. (Revisit at P4 if awkward.)
- **Store_G/H disabled on Batchly flip** — intended; confirm at flip time.
- **Preply Store Settings editable under hub mode** (escape hatch w/ banner) vs hard read-only — decide at P3.
- **Variation propertyIds are taxonomy-scoped** — global preset assumes shared taxonomy; becomes the forcing
  function for per-store presets later.
- **Etsy status mirror staleness** — UI must always show `checked_at`, never present the mirror as live.
- **Hub's first runtime dep (`pg`)** — philosophical change vs zero-dep hub; accepted, documented.
- **Committed Preply secrets** — pre-existing; rotate+purge independently and soon.
- Postgres not provisioned yet — JSON adapter carries dev; Render Postgres provisioning happens at deploy
  (aligns with docs/deployment.md §3 which also migrates Batchly to the same instance).

## Verification (end-to-end)

1. Unit + HTTP spawn tests above (`node lib/*.test.mjs`).
2. Boot hub (JSON adapter) + Preply (mock Drive) + Batchly dev; seed script; open Configure tab.
3. Exercise: edit Store_B fields → save → sync (dry-run diff shown) → flip flags in dev env → sync applies →
   verify `preply/data/stores.json` updated via saveStores invariants + Batchly rows upserted → enable gate
   blocks until readiness → Playwright suite green.
4. Store_A regression: before/after flip, `GET preply /api/settings/status` and Batchly dashboard summary
   byte-compare for Store_A; existing test suites (`sso`, `auth`, guardrails) still green.
5. `/verify` + `/code-review` skills before handing over; no live Etsy/Drive writes anywhere in the flow
   (mock/dry-run modes in dev; Drive test endpoint is read-only by construction).
