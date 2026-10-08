# Batchly — Project State

## Project Overview

Internal Etsy batch listing hub. Replaces Etsiolabs. Runs locally on port 3030. No cloud hosting for MVP.

---

## Completed Phases

### Phase 9E.1 — Professional Stores + Metrics Dashboard ✓ COMPLETE

**Dark graphite command-center theme on `/dashboard` and `/stores`. Store cards redesigned into polished SaaS management cards. Dashboard now shows 8 real metrics plus a per-store readiness overview.**

- **`/stores` — dark graphite page** (`bg-[#111318]`) with dark `TopBar`, dark inline banners, dark workflow hint strip.
- **Store cards** — fully self-contained dark cards (`bg-[#1b1e27]`) with Online/Offline badge, Etsy shop name + ID, IDs progress bar (`x/4 configured`), and readiness hint. Ready stores get emerald border highlight.
- **Expand/collapse details panel** — clicking "Details ›" smoothly expands an inline panel with a pill tab nav (Overview | Etsy IDs | Auto Setup | QA | Advanced). All existing functionality (AutoSetup, IDs form, QA panel, disconnect) preserved.
- **`/dashboard` — dark command center** — Hero with drive status pill, two rows of 4 metric cards each, Store Readiness overview list, Latest Batch Run breakdown (Created/Failed/Partial/Skipped), Quick Actions, How Batchly Works, safety strip.
- **8 metric cards** — Ready Stores, Connected, Missing IDs, Local Batches, All-time Drafts, All-time Failed, All-time Skipped, Latest Status.
- **`GET /api/dashboard/summary`** — new API endpoint returning all dashboard metrics for external access.
- **`TopBar` — dark prop** — `dark={true}` switches to `bg-[#161a24]/95 border-white/[0.07] text-slate-100`.
- **Settings and Batches pages unchanged** — remain in light theme.

### Phase 9E — Premium UI Theme + Batchly Brand Polish ✓ COMPLETE

**Batchly now uses a finished premium silver/charcoal internal SaaS theme across the primary workflow.**

- **Global theme** — app background moved to soft silver (`#f4f6f8`), cards remain white with subtle silver borders, shadows are lighter, focus rings are cleaner, and transitions run at 150–250ms.
- **Typography** — switched from remote Google font loading to bundled Geist (`GeistVF.woff` + `GeistMonoVF.woff`) for a cleaner local build and more polished headings, labels, buttons, and table text.
- **Batchly logo** — `BatchlyLogo.tsx` now renders a premium inline SVG basket mark with an integrated dark-gray "B", silver basket body, and dark/light text variants for sidebar and dashboard use.
- **Sidebar and TopBar** — sidebar uses a restrained charcoal palette with white active state, smoother hover states, and a product-style footer; TopBar uses a white/silver surface with clearer type hierarchy.
- **Reusable UI primitives** — `SoftCard`, `MetricCard`, `StatusBadge`, `StepPill`, buttons, action cards, and notices tightened to 8px cards, consistent shadows, and subtle hover lift.
- **Dashboard** — upgraded into the command center with six metric cards: connected stores, ready stores, local batches, latest run status, latest drafts created, and latest failed rows. Quick actions and "How Batchly Works" now match the final workflow.
- **Stores** — store cards use cleaner Online/Offline badges, connected shop details, IDs readiness summary, primary setup actions, improved tab styling, and a new Advanced tab while preserving reconnect, disconnect, refresh, Auto Setup, QA, and ID editing.
- **Batches** — workflow panels now read as the final Detect/Validate/Select/Run/Progress experience, with softer cards, blue/green-only success/action accents, smoother expandable states, clearer empty/error/success states, and old test wording removed.
- **Settings** — listing preset, description template, materials, weight/dimensions, supplemental images, variations, inventory, Drive, Etsy API, and workspace sections are now light, readable, and grouped in clean cards with modern input/textarea styling.
- **Operator Guide** — refreshed to match the premium theme and removed the old advanced mini-batch section from user-facing guidance.

### Phase 9D — Per-Store Etsy OAuth Fix + Disconnect Store Button ✓ COMPLETE

**Root cause identified: Etsy reuses the browser's signed-in session silently. Code correctly routes OAuth to the right store via PKCE state. Fix: duplicate-shop guard blocks re-using a shop already connected elsewhere; disconnect button lets operator clear a wrong connection; UI warning explains browser session issue.**

- **`POST /api/etsy/disconnect-store`** (new) — clears `accessToken`, `refreshToken`, `tokenExpiresAt`, `etsyShopId`, `etsyShopName` from the store record. Preserves `StoreEtsyIds`, batch history, and the store record itself.
- **`GET /api/auth/etsy/callback`** — added duplicate-shop guard: after fetching shop identity, checks if `etsyShopId` is already linked to a different store. If so, redirects to `/stores?etsy=error&reason=shop_already_connected&conflictStore=…&shopName=…` without saving tokens.
- **`/stores` page** — new `shop_already_connected` error banner (red, explains which shop is already taken and which store owns it, instructs to sign out of Etsy in browser); connected shop name + shop ID shown prominently in card header; `PageProps.searchParams` extended with `conflictStore` and `shopName`.
- **`StoreCardTabs.tsx` Connection tab** — added `DisconnectButton` component with two-phase confirmation (idle → confirm panel → loading → done/error); blue session-warning callout ("Etsy silently reuses whichever account is currently signed in your browser — to connect a different account, disconnect, sign out of Etsy, then reconnect"); Connect/Reconnect button text changed to "Connect Etsy Shop" / "Reconnect Etsy Shop" (blue solid instead of ghost); disconnect and warning only shown when a token already exists.
- Smoke test 11/11 pass. TypeScript 0 errors. Build clean.

### Phase 9C — Final UI Theme + Product Experience Polish ✓ COMPLETE

### Phase 1 — UI Dashboard with Mock Data
- Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui
- 8 pages: Dashboard, Batches, Batch Detail, Stores, Upload Queue, Errors/Review, Settings, Final Report
- Dark theme (zinc palette)
- All navigation functional; data driven by `src/lib/mock-data.ts`

### Phase 2 — Prisma + SQLite
- Prisma 5 + SQLite (`prisma/dev.db`)
- Models: Store, Batch, BatchStore, Design, Listing, ListingImage, BatchLog
- All pages wired to live DB via `src/lib/data.ts` (mock-data no longer used by pages)
- Seed: 8 stores (Store_A–H), 4 batches, 10 designs/batch, 80 listings/batch, 6 BatchLogs

### Phase 3 — Manifest Parser + Local Folder Validator
- `src/lib/services/manifest.ts` — papaparse CSV parser with column + per-row validation
- `src/lib/services/validator.ts` — walks `workspace/sample-batches/<name>/`, checks store folders, design folders, image counts
- `src/app/api/validate/route.ts` — POST /api/validate with path sanitisation
- `src/components/batches/ValidationPanel.tsx` — "Validate Folder" button on Batch Detail page
- `scripts/validate-batch.ts` — CLI runner
- Sample batch: `workspace/sample-batches/Batch-001-Sample/` with `batch_manifest.csv`

### Phase 4A — Google Drive OAuth + Folder Listing
- `src/lib/services/drive.ts` — OAuth2 client, token I/O, `isConnected()`, `getDriveClient()`, `listBatchFolders()`
- `src/app/api/auth/google/route.ts` — `GET` redirects to Google consent screen
- `src/app/api/auth/google/callback/route.ts` — exchanges code, writes `.tokens/google.json`, redirects to `/settings?drive=connected`
- `src/app/api/drive/status/route.ts` — `GET` returns `{ connected: boolean }`
- `src/app/api/drive/folders/route.ts` — `GET` lists batch subfolders from `GOOGLE_DRIVE_PENDING_FOLDER_ID`
- `src/components/drive/DriveConnectionStatus.tsx` — connection badge + "Connect Google Drive" button on Settings page
- `src/components/drive/DriveImportPanel.tsx` — collapsible panel on Batches page; lists Drive folders with all 5 UI states
- `.env.example` — template with all four required variable names (never commit real secrets)
- Token storage: `.tokens/google.json` (gitignored); shape = `OAuth2Client.credentials`

### Phase 4B — Drive Folder Download + Validate
- `src/lib/services/drive.ts` — added `downloadBatchFolder()`: walks Drive tree (store → design → images), downloads `batch_manifest.csv` + `.jpg/.jpeg/.png` sequentially into `workspace/downloads/{folderName}/`, sanitizes all path segments, idempotent
- `src/app/api/drive/download/route.ts` — POST `/api/drive/download`; sanitizes input, calls `downloadBatchFolder()` then `validateBatchFolder()`, returns combined result; `maxDuration = 300`
- `src/components/drive/DriveImportPanel.tsx` — "Download & Validate" button per folder; idle/downloading/done/error states; shows filesDownloaded, filesSkipped, validation errors/warnings, missing folders/images (first 10 each); console.logs full result for debugging
- `workspace/downloads/` added to `.gitignore`

### Phase 5A — Etsy OAuth PKCE Store Connection ✓ TESTED
- `src/lib/services/etsy.ts` — PKCE helpers (`generateCodeVerifier`, `generateCodeChallenge`), PKCE state file I/O (`.tokens/etsy-pkce-<state>.json`), auth URL builder, token exchange, two-step shop identity lookup (`fetchShopIdentity`: `/users/me` → `/shops/{shopId}`), `saveEtsyTokens`, `refreshAccessToken`, `isStoreConnected`
- `src/app/api/auth/etsy/start/route.ts` — `GET /api/auth/etsy/start?storeId=`: validates store, generates PKCE state, redirects to Etsy consent screen
- `src/app/api/auth/etsy/callback/route.ts` — exchanges code + verifier, calls `fetchShopIdentity`, saves all token fields to Store record, redirects to `/stores` with success/warning/error params
- `src/app/stores/page.tsx` — Connect/Reconnect single `<a href>` per store; three badge states: **Connected** (token + shop), **Token saved** (yellow, token only), **Not connected**; success/warning/error banners via `searchParams`; missing-credentials warning if `ETSY_CLIENT_ID` not set
- Prisma migration `20260625050506_add_etsy_token_fields` — adds `tokenExpiresAt DateTime?` and `etsyShopId String?` to Store model
- `.env.example` — `ETSY_CLIENT_ID`, `ETSY_CLIENT_SECRET` (unused in PKCE flow, kept as placeholder), `ETSY_REDIRECT_URI`, `ETSY_SCOPES`
- **Store A tested and confirmed**: `accessToken`, `refreshToken`, `tokenExpiresAt`, `etsyShopId`, and `etsyShopName` all populated after OAuth

### Phase 6B — GlobalListingPreset + StoreEtsyIds ✓ COMPLETE

- Added `GlobalListingPreset` Prisma model — one record, shared listing defaults for all stores (`whoMade`, `whenMade`, `listingType`, `renewalOption`, `isPersonalizable`, `defaultQuantity`, `defaultPrice`)
- Added `StoreEtsyIds` Prisma model — per-store Etsy numeric IDs stored as `String?` fields (`taxonomyId`, `shippingProfileId`, `readinessStateId`, `returnPolicyId`, `sectionId`)
- Added `Store.etsyIds` relation to `StoreEtsyIds`
- Prisma migration: `20260626195931_add_listing_preset_models`
- Seed updated: upserts one `GlobalListingPreset` + one `StoreEtsyIds` per store; does not overwrite Store OAuth tokens
- `GET/POST /api/settings/listing-preset` — view/edit global preset
- `GET/POST /api/etsy/store-ids` — view/edit per-store Etsy IDs
- `src/components/settings/GlobalListingPresetForm.tsx` — editable form on `/settings`
- `src/components/etsy/StoreEtsyIdsForm.tsx` — per-store ID entry on Store A card (`/stores`)
- `POST /api/etsy/draft-test` updated: reads from `GlobalListingPreset` + `StoreEtsyIds` DB; requires all three IDs (`taxonomyId`, `shippingProfileId`, `readinessStateId`); `ETSY_TEST_*` env vars no longer required
- Phase 6B audit fix (commit `83413d3`): `shippingProfileId` made required (was silently optional)

### Phase 8D — End-to-End Operator Finalization ✓ COMPLETE

**Final usability and execution pass. `/batches` is now a finished internal production tool.**

- **`/batches` page rebuilt (full polish pass):**
  - Numbered workflow sections: `1. Detect Drive Batches` / `2. Select & Validate Batch` / `3. Batch Run Progress` — removes "A./B./C./D." naming
  - Safety strip at page top: "Draft-only — nothing published or activated · Max 30 listings/store · Duplicates skipped automatically · Progress saved to database"
  - `SectionHeader` component with step circles keeps all panels visually connected
  - **Inline `RunConfirmModal`** replaces `window.confirm()` — shows store-by-store breakdown (estimated new, duplicates skipped), totals, variation/supplemental settings, safety reminders, Cancel/Start Run buttons
  - **`RowTable`** component in expanded store cards — shows active running row (blue, with spinner), all terminal rows with design ID, SKU, status badge, listing ID (select-all), title, image count, variation/supplemental status, errors
  - **Per-store mini progress bars** in `StoreProgressCard` — live bar during run, color-coded by status
  - **`StoreProgressCard`** shows active-store highlight (blue border + spinner on current designId), per-store counts (created/partial/failed/skipped)
  - **Completion screen** — prominent listing IDs block (select-all), "Run Listing QA at Stores →" link, retry button with inline confirmation panel before retrying
  - **Retry confirmation** — replaces immediate retry with a "Confirm Retry" inline card showing which rows will reset, Cancel/Retry buttons
  - `StoreValidationCard` — improved per-store display with IDs, fix links, error messages with `/stores` deep-link
  - `ValidationDashboard` — better summary grid (Est. new drafts in green, skip in blue), per-store breakdown in confirm modal, "Fix in Stores →" link when no stores ready
  - Validate button shows "Validating…" with spinner while in progress
  - "← Validation" button in progress panel to return without losing validation state
  - `RecentRunsSection` — shows per-store folder list per run
  - `showRunConfirm` state manages confirm modal lifecycle; `handleBackToValidation` resets without full page state clear
- **Operator guide rewritten** — 12 steps covering full end-to-end workflow (one-time setup steps 1–3, batch workflow steps 4–12), Troubleshooting section with 5 common issues, updated Quick Reference
- TypeScript: 0 errors. Build: clean (`/batches` 9.37 kB). Smoke test: 10/10 pass.

### Phase 8C — Full Workflow Stabilization + Button/Route QA Pass ✓ COMPLETE

**Engineering QA pass — 5 service bugs fixed, UI edge cases handled, smoke test added, operator guide updated.**

- **`batchRunService.ts` hardened (5 bugs fixed):**
  - Lock-busy branch: removed incorrect `failRow` call that left rows with `queued` status but populated `completedAt` and `errors`. Now cleanly requeues: `{ status: "queued", startedAt: null }`.
  - `isDone` check simplified from `remainingQueued === 0 && progress.status !== "queued"` to `remainingQueued === 0` — the status guard was always true.
  - `failRow` renamed `_markRowFailed`; removed unused `storeRunId` and `runId` parameters and `void` suppressions.
  - Removed `void active;` dead code from `_updateStoreCounts`.
  - `_updateStoreCounts` fixed: `...(allDone ? { completedAt: new Date() } : {})` — previously would clear a previously set `completedAt` when `allDone` is false.
  - `retryFailedRows` now also resets `imagesAttempted: 0, imagesUploaded: 0` on retry.
  - Better missing-config error message shows which items are missing.
- **`/batches` page UI fixes:**
  - Validation dashboard correctly hidden when a run is in progress (`!runProgress && !startingRun`).
  - Run error panel shows "Dismiss to see validation results" button when no active run.
  - Zero-row run: dedicated empty-state panel instead of empty progress panel — shows explanation + "← Back to validation" button.
- **Operator guide rewritten** (`/operator-guide`) — centered on Phase 8B `/batches` workflow (10-step primary). Kept Phase 7E mini-batch as an "Advanced / Debug" section. Updated safety badges, quick reference, and back link.
- **`scripts/smoke-batches.ts`** (new): Non-destructive smoke test for all batch APIs — 6 sections, 10 tests, covers settings presets, local batch scanner, validation, run history, Drive status, and input validation (path traversal, missing batchFolder, nonexistent run ID). Run with `npm run smoke:batches`.
- **`package.json`**: Added `smoke:batches` script.
- TypeScript: 0 errors. Build: clean.

### Phase 8B — Durable Batch Runs, Progress Tracking, and Retry ✓ COMPLETE

**Step-based batch runner with per-row DB tracking. Failed rows can be retried. Full progress UI with auto-advance, store cards, and listing IDs.**

- **Prisma models added** (`BatchRun`, `BatchRunStore`, `BatchRunRow`): migration `add_durable_batch_runs`. Tracks status (queued/running/completed/partial/failed/canceled), started/completed timestamps, counts (attempted/created/skipped/partial/failed), listing IDs, row-level errors, image/variation/supplemental statuses. Separate from existing `DraftCreationRun`/`DraftCreationRecord` (mini-batch) models.
- **`src/lib/services/batchRunService.ts`** (new): Core service with `createBatchRun()`, `processNextRow()`, `getBatchRunProgress()`, `retryFailedRows()`. Step-based design: each call to `processNextRow()` handles one queued row, updates DB, returns progress. Avoids HTTP timeouts on large batches (up to 240 rows). Writes `DraftCreationRecord` per created row for cross-run duplicate protection.
- **`POST /api/batches/run`** (replaced): Now creates a `BatchRun` record (queued status) and returns `{ runId, totalRows, totalStores }` immediately. No synchronous listing creation.
- **`GET /api/batches/runs`**: Lists 20 most recent `BatchRun` records with store summaries.
- **`GET /api/batches/runs/[runId]`**: Returns full `BatchRunProgress` — status, percent complete, current store/designId, per-store and per-row breakdowns.
- **`POST /api/batches/runs/[runId]/step`**: Processes next queued row. Frontend calls this in a tight loop (50ms yield) until `done: true`.
- **`POST /api/batches/runs/[runId]/retry-failed`**: Resets failed rows to queued, resets run/store statuses to running. Frontend re-enters the step loop.
- **`/batches` page rebuilt**: Start Batch Run button with confirmation summary (stores, est. listings, duplicates, variation/supplemental status). Progress panel shows percent bar, current store/designId, per-store cards with row dots (color-coded by status), listing IDs on created rows, failed row details. Retry Failed Rows button. Refresh Status button. Recent Batch Runs list at bottom. Auto-advances via step loop while running.
- **Safety unchanged:** draft-only, no publishing, no activation, max 30/store, no all-store automation, no Google Drive changes, no secrets logged.

### Phase 8A — Batch Detection, Validation, Run Foundation ✓ COMPLETE

**Main operator workflow page. `/batches` becomes the primary entrypoint.**

- `GET /api/batches/local` — scans `workspace/downloads`, returns batch folders with manifest row counts and store subfolders
- `POST /api/batches/validate` — deep per-store validation: manifest parse, global/variation/supplemental preset checks, per-store Etsy connection + ID setup + row eligibility + duplicate count
- `/batches` page: Drive detect/download (A), local batch list (B), validation dashboard (C)
- Sidebar footer updated to Phase 8A · Batch workflow

### Phase 7E — Preflight Checks + One-Draft Real Test Mode ✓ COMPLETE

**Stronger pre-create safety layer. Server-side preflight enforcement added. One-draft test selector added. Operator guide updated. Draft-only safety, max 3 cap, and no publishing/activation unchanged.**

- **Preflight helper:** `src/lib/services/preflightHelpers.ts` — `buildPreflight()` takes store, storeEtsyIds, manifest rows, selectedDesignIds, preset, variationPreset, supplementalPreset. Runs ~20 checks across store setup, row eligibility, description, tags, supplemental images, and variation inventory. Returns `{ status, canCreate, checks[], summary }`.
- **Preflight API route:** `POST /api/etsy/store-mini-batch-preflight` — validates storeId and designIds, loads the same data as preview, calls `buildPreflight()`, returns result. Read-only: no Etsy API calls, no writes.
- **Server-side enforcement in create route:** `store-mini-batch-create/route.ts` now runs `buildPreflight()` before acquiring the per-store lock. If `canCreate=false` or `status="fail"`, returns 400 with full preflight result and blocks all Etsy calls, image uploads, and inventory updates. Warnings are non-fatal — allow creation.
- **StoreMiniBatchPreview UI (`StoreMiniBatchPreview.tsx`):**
  - New preflight flow: select rows → Run Preflight Check → show pass/warning/fail panel → Create button only enables after passing/warning preflight for the current selection.
  - Preflight panel shows status badge, summary grid (selected count, max images, supplemental availability, variation combos), fail/warn checks surfaced, toggle to show all checks.
  - Selection change after preflight invalidates the result and requires re-run (client-side comparison of sorted design IDs).
  - Create button is disabled until preflight has been run and passed/warned for the exact current selection. `title` attribute on create button explains why it's disabled.
  - Confirmation dialog now includes preflight status summary.
- **One-draft test mode:** "Select first eligible row for one-draft test" button selects only the first eligible, not-yet-created row. Does not create anything. Operator must still run preflight and confirm creation.
- **Post-create QA recommendation:** After successful creation — if 1 listing created: "Run QA for this draft before creating more." If multiple: "Run QA on at least one draft from this run before continuing."
- **Operator guide updated** (`/operator-guide`): Steps rewritten as the 12-step recommended real-use workflow (7E era). New steps: confirm description template, confirm variation preset, confirm supplemental images, use one-draft test selector, run preflight, create, run QA, verify in Etsy, then scale. Safety badge adds "Preflight required". Quick reference adds preflight and one-draft test as safe operations.
- **Safety unchanged:** draft-only, no publishing, no activation, max 3 rows, no all-store automation, no Google Drive changes, no Prisma schema changes.
- Latest commit: (see `phase 7e preflight one draft test mode`)

### Phase 7D — Listing QA + Draft Verification Dashboard ✓ COMPLETE

**Read-only verification layer. No listing creation, editing, publishing, activation, image upload, or inventory update. Max 3 cap preserved.**

- **Read-only Etsy helpers** added to `src/lib/services/etsy.ts`: `getListingDetails` (GET `/application/listings/{id}` — state, title, description, price, quantity, taxonomyId, shippingProfileId, tags), `getListingImages` (GET `/application/listings/{id}/images` — count, ranks), `getListingInventory` (GET `/application/listings/{id}/inventory` — product count, hasVariations, propertyNames; 404/400 treated as no-inventory). No secrets or tokens logged.
- **QA logic** (`runListingQA`) in `src/app/api/etsy/listing-qa/route.ts`: 10 checks — listing state (fail if active/published), title, description first line, description length (proxy for template presence), tags, image count (fail if 0, warn if >10), supplemental image hint (if preset enabled), variation inventory (if preset enabled), taxonomy ID match against StoreEtsyIds, shipping profile ID match. Returns `{ qaStatus: "pass"|"warning"|"fail", checks[], summary }`.
- **Route:** `GET /api/etsy/listing-qa?storeId=&listingId=` — validates storeId/listingId, checks store is enabled+connected, calls `runListingQA`.
- **Route:** `GET /api/etsy/recent-run-qa?storeId=&runId=` — loads `DraftCreationRun` + its records with listingIds, runs QA on up to 3, returns per-listing results + overall status. No schema changes needed.
- **UI component:** `src/components/etsy/ListingQAPanel.tsx` — store prop + listing ID input + "Run QA Check" button. Shows overall QA status badge (pass/warning/fail), 6-cell summary grid (state, images, tags, description length, inventory, price), check list with pass/warning/fail messages per check. Compact mode for embedding. Header reads: "This is read-only. It does not edit, publish, activate, upload images, or update inventory."
- **Stores page:** `ListingQAPanel` added to every connected Store_A–H card (after EtsyStoreConfigPanel, before DeveloperTestTools).
- **StoreMiniBatchPreview:** Result cards refactored into `ResultCard` sub-component. "Run QA for this draft" link appears on cards with a listingId; expands `ListingQAPanel` in compact mode pre-filled with that listing ID.
- **Run history:** Each completed/partial run shows "QA created drafts in this run" button → calls `recent-run-qa`, shows inline pass/warning/fail per listing, non-pass checks highlighted.
- **Safety unchanged:** read-only toward Etsy, draft-only listing flow preserved, max 3 cap preserved, no publishing/activation.
- Latest commit: (see `phase 7d listing qa dashboard`)

### Phase 7C — Global Supplemental Images: Size Chart + Promo ✓ COMPLETE

**Batchly now supports uploading shared size chart and promo images after design/mockup images on each new draft listing. Disabled by default. Draft-only safety unchanged.**

- **Prisma model:** `GlobalSupplementalImagePreset` — `enabled`, `includeSizeCharts`, `includePromoImages`, `sizeChartFolder`, `promoFolder`, `maxSupplementalImages`. Migration: `20260627040410_add_global_supplemental_image_preset`.
- **Seed:** `GlobalSupplementalImagePreset` created with `enabled=false`, both includes true, folders at `workspace/supplemental-images/{size-charts,promo}`, max 4.
- **Local folders:** `workspace/supplemental-images/size-charts/` and `workspace/supplemental-images/promo/` created. Gitignored.
- **Helper:** `src/lib/services/supplementalImageHelpers.ts` — `resolveSupplementalFolder` (path traversal guard), `listSupplementalImagesForPreset` (sorted, capped, size-charts first then promo), `validateSupplementalImagePreset` (warnings/errors). Accepted exts: `.jpg`, `.jpeg`, `.png`.
- **API routes:**
  - `GET/POST /api/settings/supplemental-images` — load and save preset; POST validates types, path safety (must be under `workspace/supplemental-images`), `maxSupplementalImages` 0–10. Returns saved preset plus warnings.
  - `GET /api/settings/supplemental-images/preview` — lists files found in configured folders with counts and warnings. No Etsy calls, no writes.
- **Settings UI:** `GlobalSupplementalImagePresetForm.tsx` — enabled toggle, include checkboxes, folder fields, max images field, save button, "Preview Files" helper that shows filenames/counts without reloading.
- **Settings page:** Global Supplemental Images section added below Global Variation Preset.
- **store-mini-batch-create:** Supplemental images uploaded after design/mockup images, before inventory update. Ranks continue after design images. Total capped at 10. Failure is non-blocking — row marked `partial` but continues. All early-exit result pushes include `supplementalImageStatus: "skipped"`. Result object adds `supplementalImageStatus`, `supplementalImagesAttempted`, `supplementalImagesUploaded`, `supplementalImageErrors`.
- **store-mini-batch-preview:** Loads supplemental preset; includes `supplementalImagesEnabled`, `supplementalImagesAvailableCount`, `supplementalImageFiles`, `supplementalImageWarnings`, `supplementalImageErrors` in response.
- **StoreMiniBatchPreview UI:** Supplemental images status banner (active/disabled/no-files-found/errors). Result cards show upload count, partial/failed state, and per-file errors.
- **Safety unchanged:** draft-only, no publishing/activation, max 3 rows, no all-store automation, no Google Drive changes.
- Latest commit: (see `phase 7c supplemental listing images`)

### Phase 7B — Variations + Inventory Preset ✓ COMPLETE

**Batchly now supports Size/Color variation inventory updates on new draft listings via GlobalVariationPreset. Disabled by default. Draft-only safety unchanged.**

- **Prisma model:** `GlobalVariationPreset` — `enabled`, `variation1Name/PropertyId/Options`, `variation2Name/PropertyId/Options`, `quantityPerVariation`, `priceMode`, `skuMode`. Migration: `20260627034913_add_global_variation_preset`.
- **Helper:** `src/lib/services/inventoryHelpers.ts` — `parseVariationOptions`, `buildSkuForVariation`, `buildDraftInventoryProducts` (max 100 combinations, price as {amount, divisor, currency_code}).
- **etsy.ts:** `updateListingInventory` — PUT `/application/listings/{id}/inventory`. No tokens logged.
- **API routes:** `GET/POST /api/settings/variation-preset` (validates property IDs if enabled, combo guard); `GET /api/etsy/taxonomy-properties?taxonomyId=` (API-key only, returns variation-supporting properties).
- **Settings UI:** `GlobalVariationPresetForm.tsx` — enabled toggle (warns if property IDs missing), Size/Color fields, combination counter, taxonomy lookup table.
- **store-mini-batch-create:** Inventory update wired after image upload, non-blocking.
- Latest commit: `93820ca`

### Phase 7A.1 — Generic Etsy ID Helpers for All Connected Stores ✓ COMPLETE

**Readiness/processing profile helper and store config helper are now generic across all connected stores (Store_A–Store_H). No listing creation, publishing, or activation added.**

- **New route:** `src/app/api/etsy/store-readiness-profile/route.ts` — `POST /api/etsy/store-readiness-profile { storeId }` — works for any enabled and connected store. Calls `findOrCreateMadeToOrderReadinessProfile`, returns `{ success, storeId, storeName, storeFolder, etsyShopId, found, profile, message }`.
- **New route:** `src/app/api/etsy/store-config/route.ts` — `GET /api/etsy/store-config?storeId=` — generic version of the old Store A-only config endpoint. Returns shipping profiles, sections, return policies.
- **Old routes preserved:** `store-a-readiness-profile` and `store-a-config` kept as-is for backward compatibility.
- **`EtsyStoreConfigPanel`** now accepts optional `storeName` and `storeFolder` props. Calls generic routes (`/api/etsy/store-config`, `/api/etsy/store-readiness-profile`). UI wording is dynamic (uses `storeName` instead of hardcoded "Store A"). Confirm dialog uses store name.
- **`stores/page.tsx`** now renders `EtsyStoreConfigPanel` for all connected + enabled stores (Store_B–Store_H), not just Store A. `DeveloperTestTools` remains Store A-only.
- **StoreEtsyIds persistence confirmed:** `readinessStateId` saved via "Save to Store Etsy IDs" button persists on page refresh via DB-backed `StoreEtsyIds` record.
- **Safety unchanged:** no listing creation, no publishing, no activation, max 3 cap preserved, no all-store automation.
- Latest commit: `eafb474` (eafb474 = targeted readiness fix) + this phase (see below).

### Phase 7A — Global Description Template + Listing Description Builder ✓ COMPLETE

**Batchly now builds Etsy listing descriptions from the manifest row title + a shared preset template stored in the DB. No publishing, no activation, no cap increase.**

- **Prisma schema:** Added `descriptionTemplate String?` to `GlobalListingPreset` model
- **Migration:** `add_description_template_to_global_preset`
- **Seed:** `prisma/seed.ts` now seeds `descriptionTemplate` with the shared preset body (ORDERING, CARE INSTRUCTIONS, PRODUCTION AND SHIPPING, RETURN POLICY sections). The title line is NOT included — it is injected dynamically per listing.
- **Helper:** `buildListingDescription(title, descriptionTemplate?)` added to `src/lib/services/draftFlowHelpers.ts`
  - Format: `<manifest row title>\n\n<template body>`
  - If no template, falls back to title only
- **All 3 draft creation routes updated:**
  - `src/app/api/etsy/draft-from-manifest/route.ts`
  - `src/app/api/etsy/draft-from-manifest-with-images/route.ts`
  - `src/app/api/etsy/store-mini-batch-create/route.ts`
  - Each now calls `buildListingDescription(row.title, preset.descriptionTemplate)` for the Etsy description field
- **Preview updated:** `RowPreview` now includes `descriptionSource` ("global_preset" | "title_only") and `finalDescriptionPreview` (first 120 chars). `descriptionLength` reflects the final built description length.
- **IP/trademark check:** `checkTrademarkWarnings` now also scans the final built description in all flows
- **Settings UI:** `GlobalListingPresetForm.tsx` now includes a resizable textarea for `descriptionTemplate` with helper text: "The listing title is automatically inserted as the first line. Do not include the title line here."
- **Settings API:** `POST /api/settings/listing-preset` now accepts and saves `descriptionTemplate`
- **Safety unchanged:** draft-only, no publishing/activation, max 3 rows, no all-store run, no Google Drive changes
- TypeScript: 0 errors. Build: clean.

### Phase 6N — Real-Use Dry Run and Operator Rollout ✓ COMPLETE

**Batchly now has a guided dry-run workflow page, per-store dry-run readiness summary, first-run recommendations in the preview panel, and updated confirmation messaging. No new automation power added.**

- **New page:** `src/app/operator-guide/page.tsx`
  - 12-step dry run workflow: connect store → save Etsy IDs → confirm manifest/images → load preview → review rows → review IP warnings → select 1 row → create draft → verify in Etsy → repeat slowly → respect max 3 cap → delete test drafts
  - Safety banner: draft-only, no publishing, no activation, max 3 rows, manual confirm required
  - Quick reference table: what's safe in Batchly vs. what must be done in Etsy
  - Links back to `/stores`, `/settings`, `/dashboard`
- **Updated `Sidebar.tsx`:**
  - Added "Operator Guide" nav item (📋) linking to `/operator-guide`
  - Updated footer label from "Phase 1 · Mock data" to "Phase 6N · Draft workflow"
- **Updated `StoreSetupStatus.tsx`:**
  - `readyForCreation` now also requires `etsyShopName` (connected shop) — previously only checked IDs + mini-batch enabled
  - Summary line changed from "Ready for preview and draft creation" → **"Ready for dry run"**
  - Not-ready state now lists each missing item as a bullet (Etsy shop not connected, taxonomyId not saved, etc.) instead of a generic message
- **Updated `StoreMiniBatchPreview.tsx`:**
  - Added first-run recommendation banner: shown when `eligibleCount > 0 && alreadyCreatedCount === 0` — "For first real use, select only 1 row and verify the Etsy draft before creating more." with link to Operator Guide
  - Confirmation dialog updated: if 1 row selected, shows "✓ Good — selecting 1 row is recommended for a first dry run." If >1 rows, gently suggests starting with 1 first. Added duplicate protection reminder to dialog text.
- **Updated `OperatorSafetyChecklist.tsx`:**
  - Added "Operator Guide →" link in the panel header row so operators can access the guide without expanding the checklist
- **Updated `PRE_PRODUCTION_CHECKLIST.md`:**
  - Updated store setup checklist to reference "Ready for dry run" (matching new UI text)
  - Added Section 6: Real-Use Dry Run Checklist — 15-item checklist covering first single-row dry run, Etsy verification, duplicate protection confirmation, and scale-up guidance
- **Confirmed safety:** no publishing/activation added, no all-store automation, max 3 cap preserved, no schema changes, no Google Drive changes
- TypeScript: 0 errors. Build: clean (34 routes).
- Latest commit: `2c10762`

### Phase 6M — Final Pre-Production Audit and Cleanup ✓ COMPLETE

**Batchly has been audited for safety, secret handling, route behavior, UI clarity, and gitignore coverage. No new automation power was added.**

- **Secret/log safety audit completed:**
  - Inspected all Etsy API routes and service files (`etsy.ts`, `draftFlowHelpers.ts`, `manifest.ts`, all `/api/etsy/*` routes, `/api/auth/etsy/callback`)
  - Confirmed: no access tokens, refresh tokens, Authorization headers, x-api-key values, client secrets, or shared secrets are logged anywhere
  - Safe logs confirmed: route names, storeId, storeFolder, etsyShopId (already displayed in UI), listingId, status codes, count summaries, file basenames
  - Etsy error response bodies (non-sensitive) are logged at appropriate log levels only
- **Gitignore audit completed:**
  - Added `.env` (bare) and `.env.*` patterns to `.gitignore` — previously only `.env*.local` was covered
  - Confirmed existing coverage: `.tokens/`, `prisma/dev.db`, `prisma/dev.db-journal`, `workspace/downloads/`, `node_modules/`, `.next/`
- **Route safety audit completed:**
  - Preview route (`GET /api/etsy/store-mini-batch-preview`) confirmed read-only — no Etsy API calls, no DB writes
  - Creation route (`POST /api/etsy/store-mini-batch-create`) confirmed POST-only with required `storeId`
  - `storeFolder` always derived from DB (`store.driveFolderName`), never from client input
  - Max 3 cap enforced server-side (`MAX_SELECTED = 3`) before any Etsy call
  - No publish/activate endpoint exists anywhere in the codebase
  - Each store uses its own OAuth token and `etsyShopId` via `createDraftListing(storeId, ...)`
  - Duplicate guard (`DraftCreationRecord` unique check) runs before each Etsy draft call
  - Per-store in-memory lock released in `finally` block
- **UI safety audit completed:**
  - Normal workflow (mini-batch preview/create) is visually primary
  - `DeveloperTestTools` defaults collapsed (`useState(false)`)
  - `OperatorSafetyChecklist` defaults collapsed, placed at page top
  - Draft-only language visible in mini-batch panel footer and confirmation dialog
  - Confirmation dialog explicitly states "will NOT be published or activated"
  - Max 3 cap visible in OperatorSafetyChecklist and mini-batch panel
  - Setup errors visible via `StoreSetupStatus` component
  - Already-created duplicate protection visible via "Already Created" badge
- **`PRE_PRODUCTION_CHECKLIST.md` created:**
  - Section 1: Environment checklist (`.env.local`, secrets local only, gitignore coverage)
  - Section 2: Store setup checklist (OAuth, IDs, ready status)
  - Section 3: Batch checklist (manifest, folders, images, validation)
  - Section 4: Creation checklist (preview first, select ≤3, confirm draft-only, verify in Etsy)
  - Section 5: Safety checklist (no publish flow, no all-store run, duplicate protection, run history)
- **Confirmed safety:** no publishing/activation added, no all-store automation added, max 3 cap preserved, no schema changes, no Google Drive changes
- TypeScript: 0 errors. Build: clean.
- Latest commit: `ae18843`

### Phase 6L — Final Safe Multi-Store Workflow Polish ✓ COMPLETE

**Batchly now has a cleaner production-oriented store workflow. Test tools are out of the primary flow. Safety guidance is visible at the page level.**

- **New component:** `src/components/etsy/OperatorSafetyChecklist.tsx`
  - Collapsible panel rendered near the top of `/stores`, above all store cards
  - Defaults collapsed for clean daily use; expand to review 8 safety reminders:
    draft-only, no publishing, review in Etsy before publishing, OAuth authorization, ID setup, trademark warnings, max-3 cap, and test draft cleanup
- **New component:** `src/components/etsy/DeveloperTestTools.tsx`
  - Collapsible panel, defaults collapsed, placed at the bottom of Store A card only
  - Houses the three one-off test buttons (Create Test Draft, Create Draft from Manifest, Create Draft + Upload Images) with warning: "Development/test tools only. Use mini-batch preview for the normal workflow."
  - Routes and underlying components untouched — still available for regression testing
- **Updated `src/app/stores/page.tsx`:**
  - `OperatorSafetyChecklist` rendered at page top before the store grid
  - Store A card order: StoreSetupStatus → StoreAMiniBatchPreview → StoreMiniBatchPreview → StoreEtsyIdsForm → EtsyStoreConfigPanel → DeveloperTestTools
  - Normal workflow is now visually primary; test tools are de-emphasized
- **Updated `StoreMiniBatchPreview.tsx`:**
  - Workflow guidance added at panel top: "Load preview → review errors/warnings → select eligible rows → create draft listings with images → review drafts in Etsy"
  - Setup warning text updated: "This store is not ready for draft creation. Save taxonomyId, shippingProfileId, and readinessStateId below, then reload the preview."
  - Confirm dialog adds: "After creation, review all drafts inside Etsy before publishing"
- **Confirmed existing behavior preserved:**
  - Store A one-off test buttons still exist inside DeveloperTestTools
  - Mini-batch preview/create works for all enabled connected stores
  - Max 3 selected rows per request remains
  - Duplicate protection remains
  - Run history remains
- **Confirmed safety:** draft-only, no publishing, no activation, no all-store run, no automatic creation, no cap increase, no Google Drive changes, no schema changes
- TypeScript: 0 errors. Build: clean.
- Latest commit: `a3549dd`

### Phase 6K — Production Hardening for Multi-Store Draft Creation ✓ COMPLETE

**Batchly now has clearer setup visibility, confirmation messaging, result summaries, run history, and duplicate messaging for controlled multi-store draft creation.**

- **New component:** `src/components/etsy/StoreSetupStatus.tsx`
  - Renders on every connected store card (before the mini-batch panel)
  - Shows: Etsy shop name ✓/✗, `taxonomyId` ✓/✗, `shippingProfileId` ✓/✗, `readinessStateId` ✓/✗, mini-batch enabled ✓/✗, and a ready/not-ready summary line
  - Not-ready state shows: "Not ready — save missing Etsy IDs below before creating drafts"
- **Updated `GET /api/etsy/store-mini-batch-preview`:** now returns `setupStatus` object: `{ hasTaxonomyId, hasShippingProfileId, hasReadinessStateId, isReadyForCreation }` — used by the UI to show store-level setup warnings without string-matching row errors
- **Updated `POST /api/etsy/store-mini-batch-create`:** now returns `partialCount` (listings created but with some image upload failures)
- **Updated `GET /api/etsy/draft-creation-runs`:** removed Store A–only restriction; now returns run history for any store; adds `storeFolder` to each run record
- **Updated `StoreMiniBatchPreview.tsx`:**
  - Store-level setup warning driven by `setupStatus.isReadyForCreation` (replaced string-matching hack from Phase 6J)
  - Stronger confirmation dialog — includes store label, selected design IDs, selected count vs. max cap, and explicit "will NOT be published or activated" note
  - Result summary: shows `partialCount`, clarifies duplicate vs. skipped vs. failed; listing IDs and run IDs are `select-all cursor-text` for easy copying
  - Run history: displays design ID chips, `storeFolder`, copyable run ID, created/skipped/failed counts
  - Already Created row detail: "Already Created — Duplicate protected" callout with existing listing ID, status, and timestamp
  - Footer note updated: "Draft-only. Manually selected rows only. Max 3 listings per request. No publishing."
- **Confirmed safety:**
  - Draft-only — no publishing, no activation
  - No all-store run button
  - No automatic creation
  - Max 3 selected rows per request remains
  - No Google Drive changes
  - No Prisma schema changes
- TypeScript: 0 errors. Build: clean.
- Latest commit: `245a87e`

### Phase 6J — Expand Controlled Mini-Batch to Store_A Through Store_H ✓ COMPLETE

**Batchly now supports controlled mini-batch preview and selected draft creation for all 8 stores (Store_A through Store_H). This is still per-store manual operation — not all-store automation.**

- **Server-side enablement constant:** `MINI_BATCH_ENABLED_STORE_FOLDERS = new Set(["Store_A", "Store_B", "Store_C", "Store_D", "Store_E", "Store_F", "Store_G", "Store_H"])` in `draftFlowHelpers.ts`; replaced the earlier `ALLOWED_MINI_BATCH_FOLDERS`
- **Generic routes unchanged** — now serve all 8 stores:
  - `GET /api/etsy/store-mini-batch-preview?storeId=`
  - `POST /api/etsy/store-mini-batch-create`
- **Generic UI component unchanged** — `src/components/etsy/StoreMiniBatchPreview.tsx`
- **`stores/page.tsx` updated:**
  - Store_A connected card: keeps all existing one-off buttons + `StoreAMiniBatchPreview` + `StoreMiniBatchPreview` + `StoreEtsyIdsForm` + `EtsyStoreConfigPanel`
  - Store_B through Store_H connected cards: render `StoreMiniBatchPreview` + `StoreEtsyIdsForm` (for entering required Etsy IDs)
  - Unconnected stores: no mini-batch UI shown
- **Setup hint added in `StoreMiniBatchPreview`:** when all rows are ineligible due to missing Etsy IDs, a yellow callout tells the user to save `taxonomyId`, `shippingProfileId`, and `readinessStateId` for that store in the Etsy IDs form below
- **Error messages genericised:** `buildRowPreview` and `loadPresetAndIds` error strings no longer say "Store A" — now generic so they are correct for any store
- **Confirmed safety:**
  - `storeFolder` always derived from `DB Store.driveFolderName` — no open-ended client parameter
  - Each store uses its own OAuth token, `etsyShopId`, and `StoreEtsyIds` — no cross-store credential leakage
  - Per-store in-memory lock: `${storeFolder}/mini-batch` — each store has its own lock key
  - `DraftCreationRecord` unique guard `@@unique([storeId, batchFolder, designId])` prevents duplicate drafts across restarts for all stores
  - Max 3 selected rows per request cap remains in place
  - Preview-first workflow — no creation without explicit user selection and confirm dialog
  - Draft-only — no publishing, no activation
  - No all-store run button
  - No automatic creation
  - No Google Drive changes
  - No Prisma schema changes
- **Existing Store A one-off routes/buttons remain intact:** Create Test Draft, Create Draft from Manifest, Create Draft + Upload Images
- TypeScript: 0 errors. Build: clean.
- Latest commit: `d0290f7`

### Phase 6I — Expand Controlled Mini-Batch to Store_A + Store_B ✓ COMPLETE

**Introduced generic routes and generic UI component for mini-batch preview/create. Enabled Store_A and Store_B; Store_C–H excluded at this phase.**

- Generic routes created: `GET /api/etsy/store-mini-batch-preview`, `POST /api/etsy/store-mini-batch-create`
- Generic component created: `src/components/etsy/StoreMiniBatchPreview.tsx` with props `{ storeId, storeFolder, storeLabel }`
- Server-side allowlist at the time: `ALLOWED_MINI_BATCH_FOLDERS = new Set(["Store_A", "Store_B"])`
- Latest commit: `221bf8a`

### Phase 6H — Persistent Mini-Batch Run History + Duplicate Prevention ✓ COMPLETE

**Batchly now persists mini-batch draft creation history in the database. Already-created rows are detected across page refreshes and server restarts. Duplicate Etsy draft creation is blocked before any API call.**

- **New Prisma models:**
  - `DraftCreationRun` — one record per mini-batch request (`storeId`, `storeFolder`, `batchFolder`, `requestedDesignIds`, `status`, `createdCount`, `skippedCount`, `failedCount`, `startedAt`, `completedAt`)
  - `DraftCreationRecord` — one record per successfully created draft; unique guard `@@unique([storeId, batchFolder, designId])` prevents duplicate drafts across restarts
- **New migration:** `20260626215436_add_draft_creation_history`
- **Duplicate prevention:**
  - Before each Etsy draft call, `DraftCreationRecord` is checked by unique key
  - If record exists, row is returned as `status: "duplicate"` with the existing listing ID — no Etsy call made
  - Failed pre-create rows do not write a record, so retries remain possible
- **Updated `POST /api/etsy/store-a-mini-batch-create`:**
  - Creates `DraftCreationRun` at start with `status: "started"`
  - Writes `DraftCreationRecord` only for `created` / `partial` rows
  - Updates run with final status, counts, and `completedAt`
  - Response now includes `runId` and `duplicateCount`
- **Updated `GET /api/etsy/store-a-mini-batch-preview`:**
  - Loads all `DraftCreationRecord`s for the batch in one query
  - Each row includes `alreadyCreated`, `existingListingId`, `existingStatus`, `existingCreatedAt`
  - `eligibleCount` excludes already-created rows; summary includes `alreadyCreatedCount`
- **New route:** `GET /api/etsy/draft-creation-runs?storeId=` — returns last 5 runs for Store A
- **Updated UI (`StoreAMiniBatchPreview`):**
  - Already-created rows show `Already Created` badge and cannot be selected
  - After creation, preview auto-reloads from DB to reflect new state
  - Result summary includes run ID and duplicate count
  - `Show last 5 runs` history panel at the bottom of the preview
- Latest commit: `2d776f6`
- No publishing, activation, schema changes beyond new models, or Google Drive changes

### Phase 6G — Controlled Selected Mini-Batch Draft Creation ✓ COMPLETE (Store A only, max 3 rows)

**Batchly now supports manually selected mini-batch draft creation for Store A. User selects eligible rows from the preview, confirms, and drafts are created sequentially with images. No publishing. No activation. Capped at 3 rows per request.**

- **New route:** `POST /api/etsy/store-a-mini-batch-create` — accepts `{ storeId, designIds[] }` (max 3); validates eligibility via `buildRowPreview`; creates Etsy drafts + uploads images sequentially; returns per-row results; uses `Store_A/mini-batch` in-memory lock
- **Updated UI:** `src/components/etsy/StoreAMiniBatchPreview.tsx` — checkboxes for eligible rows only, selection cap enforced at 3, confirm dialog, per-row result cards with status badges and listing IDs
- **Confirmed behavior:**
  - User must load preview first before selection is available
  - Only eligible Store_A rows show checkboxes; ineligible rows are locked out
  - Selection hard-capped at 3 rows per request; additional checkboxes disabled at cap
  - Draft creation is manual — requires confirm dialog
  - Drafts created sequentially (not in parallel)
  - Images uploaded sequentially per listing
  - Per-row result status: `created` | `skipped` | `failed` | `partial`
  - Rows created in current UI session get `Created` badge and cannot be re-selected
  - Route-level in-memory lock (`Store_A/mini-batch`) prevents overlapping requests — returns 409
- **Confirmed safety:**
  - Draft-only — no publishing, no activation
  - Store A only — no Store_B through Store_H
  - No all-row auto-processing
  - No variations or inventory
  - No schema changes
  - No Google Drive changes
- Latest commit: `d661a2b`

### Phase 6F — Store A Mini-Batch Preview ✓ COMPLETE (read-only)

**Read-only preview of all Store_A rows from the newest downloaded batch. Evaluates eligibility, warnings, and errors per row without making any Etsy calls.**

- **New route:** `GET /api/etsy/store-a-mini-batch-preview?storeId=` — reads manifest, filters Store_A rows, evaluates eligibility/warnings/errors; no Etsy calls, no DB writes
- **New component:** `src/components/etsy/StoreAMiniBatchPreview.tsx` — load button, summary bar (total / eligible / warnings / errors), clickable row table with eligible status badges, expandable per-row detail
- **New helpers in `draftFlowHelpers.ts`:** `findLatestManifestFolder()`, `findImagesForDesign()` (returns basenames only), `buildRowPreview()` (eligibility + errors + warnings per row)
- Placed on Store A card in `/stores`, below existing three draft buttons
- Latest commit: `e45eb1b`

### Phase 6E — Harden One-Listing Creation ✓ COMPLETE (Store A / D001 only)

**One-listing creation flow hardened with shared helpers, duplicate prevention, and non-blocking IP/trademark warnings. Store A only. D001 only. No schema changes. No publishing or activation.**

- **New helper file:** `src/lib/services/draftFlowHelpers.ts` — shared logic for all Store A / D001 draft routes
- **Helper coverage:**
  - `TEST_STORE_FOLDER = "Store_A"`, `TEST_DESIGN_ID = "D001"` — scope constants
  - `cleanTags(raw)` — split by comma, trim, truncate to 20 chars, cap at 13
  - `buildTestTitle(rawTitle)` — prefixes `Batchly Test - `, validates starts with letter/number, throws on empty
  - `findManifestData(storeFolder, designId, includeImages?)` — unified manifest + optional image discovery from `workspace/downloads/`
  - `loadPresetAndIds(storeId)` — loads `GlobalListingPreset` + `StoreEtsyIds`, returns typed error on missing fields
  - `checkTrademarkWarnings(texts)` — non-blocking case-insensitive check for 13 risky terms (World Cup, FIFA, NFL, NBA, MLB, NHL, NCAA, Disney, Nike, Adidas, Cristiano Ronaldo, Lionel Messi, Neymar)
  - `acquireDraftLock(key)` / `releaseDraftLock(key)` — in-memory `Set`-based duplicate lock
- **Duplicate prevention:**
  - Both manifest draft routes (`draft-from-manifest`, `draft-from-manifest-with-images`) acquire lock on `"Store_A/D001"` before starting
  - Duplicate in-progress request returns `409`: `"A Store A / D001 draft creation is already in progress. Wait for it to finish."`
  - Lock always released in `finally` blocks
  - Hardcoded `draft-test` route intentionally has no lock
- **Warnings:**
  - `warnings: string[]` returned in success response from both manifest routes
  - UI buttons display a yellow IP/trademark warning box when risky terms are detected
  - Non-blocking — does not prevent draft creation
- **Routes refactored:** `draft-from-manifest`, `draft-from-manifest-with-images` now delegate to helpers; `draft-test` imports `TEST_STORE_FOLDER` constant only
- **All three working buttons remain intact:** Create Test Draft, Create Draft from Manifest, Create Draft + Upload Images
- Latest commit: `8efc3db`
- No publishing, no activation, no batch processing, no schema changes, no Google Drive changes

### Phase 6D — Draft + Image Upload ✓ COMPLETE (Store A / D001 only)

**Batchly successfully created one Etsy draft listing from a real manifest row and uploaded one local mockup image. Store A only. D001 only. Draft was not published or activated.**

- **Manifest row used:** `store_folder=Store_A`, `design_id=D001`, `title=USA Soccer Game Day Shirt`, `sku=SA-D001-CU5`
- **Image folder used:** `workspace/downloads/2026-06-24_Batch-001/Store_A/D001/`
- **Confirmed:** `mockup_01.jpg` uploaded successfully to the Etsy draft listing
- **Payload assembled from:** GlobalListingPreset DB row + StoreEtsyIds DB row + manifest row + Store A OAuth tokens + local image files
- `uploadListingImage(storeId, listingId, imagePath, rank)` added to `src/lib/services/etsy.ts` — multipart/form-data POST to `/application/shops/{shopId}/listings/{listingId}/images`; uses native `Blob`/`FormData`; `overwrite=true`; no tokens logged; logs only `shopId`, `listingId`, `rank`, `basename`, HTTP status
- `src/app/api/etsy/draft-from-manifest-with-images/route.ts` — `POST /api/etsy/draft-from-manifest-with-images`; validates all gates including image folder existence + at least one image before creating draft; creates draft first, then uploads images sorted by filename (capped at 10); continues on image failure; returns `{ listingId, imagesAttempted, imagesUploaded, imageErrors }`
- `src/components/etsy/EtsyDraftWithImagesButton.tsx` — "Create Draft + Upload Images (Store A · D001)" button on Store A card; confirm dialog; partial-success display (shows listing ID + per-image errors); disabled after success
- All three prior buttons remain intact: Create Test Draft, Create Draft from Manifest, Create Draft + Upload Images
- No publishing, no activation, no batch processing

### Phase 6C — Draft from Manifest Row ✓ COMPLETE (Store A / D001 only)

**Batchly successfully created one Etsy draft listing from one real manifest row. Store A only. D001 only. Draft was not published or activated.**

- **Manifest row used:** `store_folder=Store_A`, `design_id=D001`, `title=USA Soccer Game Day Shirt`, `sku=SA-D001-CU5`
- **Payload assembled from:** GlobalListingPreset DB row + StoreEtsyIds DB row + manifest row + Store A OAuth tokens
- `src/app/api/etsy/draft-from-manifest/route.ts` — `POST /api/etsy/draft-from-manifest`; Store A–only guard; scans `workspace/downloads/` newest-first for `batch_manifest.csv`; finds first `Store_A / D001` row; validates all required fields before calling Etsy; tags split/trimmed/truncated to 20 chars/capped at 13; title prefixed with `Batchly Test - `; returns `listingId`, `manifestFolder`, `title`, `sku`, `storeFolder`, `designId`
- `src/components/etsy/EtsyDraftFromManifestButton.tsx` — client button on Store A card; confirm dialog; shows listing ID, title, SKU, and source folder on success; disables after success
- `src/app/stores/page.tsx` — "Create Draft from Manifest (Store A · D001)" button added below existing "Create Test Draft" button
- Existing `POST /api/etsy/draft-test` route and `EtsyDraftTestButton` left intact as a hardcoded baseline
- No image uploads, no publishing, no activation, no batch processing

### Phase 6A — Create One Etsy Draft Listing ✓ TESTED (Store A only)

**Store A successfully created one Etsy draft listing from Batchly. Test draft listing ID: `4528140917`. Draft was not published or activated.**

- `src/lib/services/etsy.ts` — added `createDraftListing(storeId, payload)`, `EtsyDraftListingPayload` (with `readiness_state_id`), `EtsyDraftListingResult`; payload sent as `application/x-www-form-urlencoded` via `URLSearchParams`; key-only debug logging before Etsy call
- `src/app/api/etsy/draft-test/route.ts` — `POST /api/etsy/draft-test`; Store A–only guard (`driveFolderName === "Store_A"`); requires `ETSY_TEST_TAXONOMY_ID` and `ETSY_TEST_READINESS_STATE_ID`; hardcoded safe test payload; no Prisma writes; returns `etsyListingId`
- `src/components/etsy/EtsyDraftTestButton.tsx` — client component with `window.confirm`, loading state, success/error display; button stays disabled after success
- `src/app/stores/page.tsx` — "Create Test Draft" button on Store A card when `connected && hasShop`; disabled state + env var hint if `ETSY_TEST_TAXONOMY_ID` not set
- **Confirmed required Etsy fields for physical draft listings:**
  - `taxonomy_id` (integer — must be a valid leaf node from seller taxonomy)
  - `shipping_profile_id` (integer — must exist in the connected Etsy shop)
  - `readiness_state_id` (integer — processing profile for physical listings)
  - `who_made=i_did`
  - `when_made=made_to_order`
  - `title` must start with a letter or number (Etsy rejects `[`, `(`, etc.)
  - Body must be `application/x-www-form-urlencoded` (not JSON)
- **Helper tools added (Store A card → "Etsy IDs" panel):**
  - Shipping profile ID helper — `GET /api/etsy/store-a-config` fetches and displays `shipping_profile_id` values with click-to-copy
  - Readiness/processing profile helper — `POST /api/etsy/store-a-readiness-profile` creates a made-to-order profile and returns `readiness_state_id` with click-to-copy
  - Taxonomy search helper — `GET /api/etsy/taxonomy-search?q=<query>` searches the full Etsy seller taxonomy tree; results show full path + copyable `taxonomy_id`
- `.env.example` — `ETSY_TEST_TAXONOMY_ID`, `ETSY_TEST_SHIPPING_PROFILE_ID`, `ETSY_TEST_READINESS_STATE_ID`

---

## Latest Stable Commits

```
a3549dd  feat: Phase 6L — final safe multi-store workflow polish
245a87e  feat: Phase 6K — production hardening for multi-store draft creation
d0290f7  feat: Phase 6J — expand mini-batch to all stores via MINI_BATCH_ENABLED_STORE_FOLDERS
221bf8a  feat: Phase 6I — expand mini-batch preview + create to Store_A + Store_B
2d776f6  feat: Phase 6H — persistent draft history + duplicate prevention
d661a2b  feat: Phase 6G — controlled selected mini-batch draft creation (Store A, max 3 rows)
e45eb1b  feat: Phase 6F — Store A mini-batch preview (read-only, no listing creation)
8efc3db  feat: Phase 6E — harden one-listing creation (Store A / D001 only)
0652f2d  feat: Phase 6D — draft + image upload (Store A / D001 only)
6ea978b  docs: update PROJECT_STATE.md — Phase 6B and 6C complete, next Phase 6D
f673b44  feat: Phase 6C — draft from manifest row (Store A / D001 only)
83413d3  fix: Phase 6B audit — require all three Etsy IDs before calling draft API
55f2950  chore: update Claude Code allowed permissions for Phase 6B tooling
10298d7  feat: Phase 6B — GlobalListingPreset + StoreEtsyIds DB models and UI
46e06e9  docs: Phase 6A complete — test draft 4528140917, confirmed required fields and helpers
99e9d1c  fix: Phase 6A draft title — must start with letter or number per Etsy validation
70ec8ae  feat: Phase 6A taxonomy helper — search Etsy seller taxonomy nodes
d518ac8  fix: Phase 6A draft payload — add readiness_state_id, require env var
e9b184b  feat: Phase 6A readiness profile helper — create made-to-order processing profile
916ffa8  fix: Phase 6A draft payload — when_made=made_to_order, switch to form-encoded body
617400c  feat: Phase 6A helper — read-only Etsy ID fetcher for Store A
34d67f0  Phase 6A: create one Etsy draft listing for Store A only
75b783a  Phase 5A: Etsy OAuth PKCE store connection
cb718b4  Phase 4B: Drive folder download + validate
a1c940e  Phase 4A: Google Drive OAuth + folder listing
edc6e65  Phase 3: local manifest parser + folder validator + ValidationPanel
```

---

## Current App Status

- **Dev server:** `npm run dev` → http://localhost:3030
- **All 8 pages render correctly**
- **Batch Detail page** includes the Folder Validation panel (Phase 3)
- **POST /api/validate** — accepts `{ batchName, batchId }`, returns `ValidationResult` JSON
- **GET /api/drive/folders** — lists pending Drive batch folders
- **POST /api/drive/download** — downloads selected Drive folder + runs validator
- **GET /api/auth/etsy/start** — initiates Etsy PKCE OAuth for a store
- **GET /api/auth/etsy/callback** — completes token exchange, saves shop identity
- **POST /api/etsy/draft-test** — creates one hardcoded Etsy draft listing for Store A only (reads from DB; baseline test)
- **POST /api/etsy/draft-from-manifest** — creates one Etsy draft listing from manifest row Store_A/D001 (reads GlobalListingPreset + StoreEtsyIds + manifest row)
- **POST /api/etsy/draft-from-manifest-with-images** — creates one Etsy draft listing from manifest row Store_A/D001 then uploads local images from the matching design folder
- **GET /api/settings/listing-preset** — returns GlobalListingPreset record
- **POST /api/settings/listing-preset** — upserts GlobalListingPreset record
- **GET /api/etsy/store-ids?storeId=** — returns StoreEtsyIds for a store
- **POST /api/etsy/store-ids** — upserts StoreEtsyIds for a store
- **GET /api/etsy/store-a-config** — fetches shipping profiles, shop sections, return policies for Store A
- **POST /api/etsy/store-a-readiness-profile** — creates made-to-order processing profile for Store A
- **GET /api/etsy/taxonomy-search?q=** — searches Etsy seller taxonomy tree (no OAuth required)
- **GET /api/etsy/store-mini-batch-preview?storeId=** — generic mini-batch preview for any enabled store (Store_A–H); returns `setupStatus`
- **POST /api/etsy/store-mini-batch-create** — generic selected draft creation for any enabled store (max 3 rows, draft-only); returns `partialCount`
- **GET /api/etsy/draft-creation-runs?storeId=** — last 5 runs for any store (previously Store A only)
- TypeScript: `npx tsc --noEmit` passes with 0 errors
- Build: `npm run build` passes with 0 errors

---

## Current Database Status

- **Engine:** SQLite via Prisma 5
- **File:** `prisma/dev.db` (gitignored)
- **Seeded data:**
  - 8 stores: Store_A through Store_H (skuPrefixes SA–SH)
  - 4 batches: statuses DONE, PROCESSING, READY, PENDING
  - 40 designs total (10 per batch, D001–D010)
  - 320 listings total (80 per batch, mixed statuses)
  - 6 BatchLogs on the PROCESSING batch
- **Models added in Phase 6B:** `GlobalListingPreset` (one record, shared listing defaults), `StoreEtsyIds` (per-store Etsy IDs as `String?`)
- **Migrations:**
  - `prisma/migrations/20260624201437_init/migration.sql`
  - `prisma/migrations/20260625050506_add_etsy_token_fields/migration.sql` — adds `tokenExpiresAt`, `etsyShopId` to Store
  - `prisma/migrations/20260626195931_add_listing_preset_models/migration.sql` — adds `GlobalListingPreset`, `StoreEtsyIds`

---

## Current Validation System Status

- **CSV columns validated:** `store_folder, design_id, sku, title, description, tags, price, product_type`
- **Per-row checks:** store_folder matches `Store_[A-H]`, design_id matches `D\d{3}`, positive price, non-empty required fields
- **Folder checks:** batch folder exists, store folders exist, design folders exist, ≥1 image per design folder
- **Image types checked:** `.jpg`, `.jpeg`, `.png`
- **Warnings:** >10 images in a design folder, product_type ≠ PHYSICAL
- **ValidationResult written to BatchLog** after each run (non-fatal — DB failure does not fail the response)

---

## Listing Architecture (LOCKED — do not deviate)

Every Etsy draft listing is assembled from three layers:

```
GlobalListingPreset   +   StoreEtsyIds (per store)   +   ManifestRow   +   Images
        ↓                          ↓                          ↓               ↓
shared defaults for         Etsy numeric IDs          title, description,   mockup
all stores (business        that differ by shop:      sku, tags, price,     images
policy, who_made,           shipping_profile_id,      product_type          (Phase 6D+)
when_made, renewal,         return_policy_id,
type, etc.)                 section_id, etc.
```

### GlobalListingPreset — one record, shared by every store

| Field | Value |
|---|---|
| `who_made` | `i_did` |
| `item_type` | finished product |
| `when_made` | `made_to_order` |
| `renewal_option` | automatic |
| `listing_type` | physical |
| `is_personalizable` | false |
| `section` | none (default) |
| `return_policy` | no returns or exchanges |
| `variation_preset` | custom variation |

**Not in GlobalListingPreset:** title, description, sku, tags, price, images — these come from the manifest row.

### StoreEtsyIds — lightweight per-store mapping for Etsy numeric IDs

Even though listing defaults are global, some Etsy IDs are shop-specific integers that vary per store:

| Field | Type | Source |
|---|---|---|
| `shipping_profile_id` | integer | Etsy Seller Dashboard → Shipping settings |
| `return_policy_id` | integer | Etsy Seller Dashboard → Return policies |
| `section_id` | integer | Etsy shop section (optional) |

These are stored as a separate `StoreEtsyIds` record (or as fields on the `Store` model) — **not** duplicated as full preset copies per store.

### What does NOT belong in GlobalListingPreset

- Etsy numeric IDs (shipping_profile_id etc.) → StoreEtsyIds
- Title, description, sku, tags, price → manifest row
- Images → local files from workspace/downloads/

### Phase 6A env vars (replaced in Phase 6B — no longer required)

Phase 6A used three env vars as a temporary scaffold. Phase 6B replaced them with DB records:
- `ETSY_TEST_TAXONOMY_ID` → now `StoreEtsyIds.taxonomyId`
- `ETSY_TEST_SHIPPING_PROFILE_ID` → now `StoreEtsyIds.shippingProfileId`
- `ETSY_TEST_READINESS_STATE_ID` → now `StoreEtsyIds.readinessStateId`

These env vars can be removed from `.env.local`. The draft routes read from DB only.

---

## Etsy OAuth Status

- **Flow:** Authorization Code + PKCE (no client secret used in token exchange)
- **PKCE state files:** `.tokens/etsy-pkce-<state>.json` (gitignored, deleted after use)
- **Token storage:** `Store.accessToken`, `Store.refreshToken`, `Store.tokenExpiresAt`, `Store.etsyShopId`, `Store.etsyShopName` — DB only, never serialized to client
- **Shop identity lookup:** `GET /users/me` → extract `shop_id` → `GET /shops/{shopId}` → get `shop_name`; fallback name `Shop {shopId}` if shop name endpoint fails
- **Token refresh helper:** `refreshAccessToken(storeId)` in `etsy.ts` — checks expiry with 60s buffer, calls Etsy refresh endpoint, updates DB
- **Scopes:** `shops_r listings_r listings_w`
- **Localhost redirect:** `http://localhost:3030/api/auth/etsy/callback` — supported by Etsy developer portal

---

## Important Commands

```bash
# Development
npm run dev               # Start dev server on port 3030

# Build
npm run build             # Production build

# Database
npm run db:migrate        # Run Prisma migrations (prisma migrate dev)
npm run db:seed           # Seed the database (tsx prisma/seed.ts)
npm run db:studio         # Open Prisma Studio GUI
npm run db:reset          # Reset DB and re-seed

# Validation CLI
npm run validate -- "Batch-001-Sample"   # Validate a local batch folder
```

> Note: The package.json script key is `validate`, not `validate-batch`.
> Run as: `npm run validate -- "<folder-name>"`

---

## Sample Batch Structure

```
workspace/
  sample-batches/
    README.md                              ← documents expected structure
    Batch-001-Sample/
      batch_manifest.csv                   ← 3 rows: Store_A/D001, Store_A/D002, Store_B/D001
      Store_A/
        D001/                              ← empty placeholder (no images committed)
        D002/                              ← empty placeholder
      Store_B/
        D001/                              ← empty placeholder
  downloads/                               ← gitignored; populated by Phase 4B Drive download
```

Real image files are excluded from git via `.gitignore` (`workspace/sample-batches/*/Store_*/`, `workspace/downloads/`).
The validator correctly reports "no images" errors on the skeleton — this is expected and intentional.

### Phase 9A — Final Product Workflow + Presets + Auto Setup

**Real final product workflow now live:**

1. User opens `/batches`
2. Detect available Google Drive batches
3. Download/sync a batch to `workspace/downloads/`
4. Validate the batch — checks manifest, images, Etsy connection, IDs, presets, size charts
5. **Select stores** via checkbox table — "Select All Ready" or individual checkboxes
6. **Run Batch for Selected Stores** — only selected stores run
7. Batchly creates up to 30 Etsy draft listings per selected store
8. User reviews drafts in Etsy manually

**Changes:**
- `GlobalListingPreset` now includes: `materials` (Cotton,bella canvas,gildan), `itemWeight`/`itemWeightUnit` (4 oz), `itemLength`/`itemWidth`/`itemHeight`/`itemDimensionsUnit` (13×10×1 in)
- `GlobalSupplementalImagePreset`: `sizeChartRequiredCount` (default 3), `enabled=true` by default, `includePromoImages=false` by default
- `createDraftListing` sends materials + item_weight + item_weight_unit + item_length + item_width + item_height + item_dimensions_unit to Etsy API
- `createBatchRun` accepts `selectedStoreFolders: string[]` — only those stores run; others are skipped with reason "not selected for this run"
- `autoSetupStoreEtsyIds(storeId, force?)` — fetches and saves taxonomy ID (T-shirt search), shipping profile (first available), readiness profile (made_to_order, find or create), return policy
- `/api/etsy/auto-setup-store` POST — triggers auto-setup per store
- `/stores` page: removed old developer test tools (DeveloperTestTools, StoreAMiniBatchPreview, StoreMiniBatchPreview); added `AutoSetupButton` per store; shows to all connected stores, not just Store_A
- `/batches` page: `ValidationDashboard` shows store selection table with checkboxes; "Select All Ready" / "Clear" buttons; "Run Batch for Selected Stores" button
- `/settings` page: GlobalListingPresetForm shows materials + weight + dimensions fields
- Validation: checks materials, weight/dimensions set; size chart count vs required count; warns if fewer than 3 size chart images
- Seed: updated with new preset defaults
- Migration: `20260627194754_phase9a_materials_dimensions_size_chart_count`

### Phase 9B — Final QA Coverage + Real Batch Readiness

**Goal:** Make Batchly ready for the first real Store A batch test.

**Changes:**

- **Listing QA extended** — `getListingDetails` now returns `materials`, `itemWeight/Unit`, `itemLength/Width/Height/DimensionsUnit`; QA route adds checks 11–15: materials presence, expected material tags (Cotton, bella canvas, gildan), item weight (expected 4 oz), item dimensions (expected 13×10×1 in), size chart file count (fail if required count missing), image cap (≤10)
- **ListingQAPanel** — summary grid updated with Materials, Weight, Dimensions cards; Images shown as `N/10`
- **AutoSetupResult enhanced** — each field returns `{ value, status: "saved" | "already_set" | "not_found" | "failed", label }`; `taxonomyAutoSelected` flag added
- **AutoSetupButton rewritten** — two explicit buttons: "Auto Setup Missing IDs" (fills only missing fields) and "Refresh IDs" (re-fetches with confirmation dialog); per-field status row with saved/already-set/not-found/failed indicators; taxonomy auto-selection warning shown when applicable
- **Size chart validation** — batch validate route issues are prefixed "SIZE CHARTS REQUIRED:" for prominence; `sizeChartCount` and `sizeChartRequired` added to `supplementalPreset` result; batches page shows `N/M` in red when insufficient
- **Confirmation modal** — supplemental images tag now shows `N/M size charts`; red border if insufficient
- **StoreEtsyIdsForm** — removed stale "Used by Create Test Draft" help text
- **INTERNAL_MVP_README.md** — rewritten to Phase 9B; added recommended first/second/third real test sequence
- **PRE_PRODUCTION_CHECKLIST.md** — Phase 9A section updated to 9B; Auto Setup step updated to "Auto Setup Missing IDs"; Listing QA step now mentions specific field checks

### Phase 9C — Final UI Theme + Product Experience Polish

**Goal:** Make Batchly feel like a real polished internal product.

**Changes:**

- **Global theme** — removed `className="dark"` from `<html>`; body/main switched to `bg-slate-50 text-slate-900`; all zinc/dark Tailwind classes converted to slate/light equivalents across all pages
- **BatchlyLogo** — new `src/components/layout/BatchlyLogo.tsx`: blue rounded-square (rx=8) SVG with 3 white stacked bars; renders in sidebar and dashboard hero
- **Sidebar redesigned** — `bg-slate-900 border-slate-800/60` dark sidebar with logo, clean SVG icons, blue active state, slate inactive/hover states; removed Upload Queue, Errors, Reports nav links; footer shows "Phase 9C · Internal"
- **TopBar** — converted to `bg-white border-slate-200` light bar
- **Dashboard rewritten** — logo hero header; 4 StatCards (Connected Stores, Ready Stores, Local Batches, Drive); Latest Run display; Quick Actions; "How Batchly Works" 4-step guide; Safety note
- **Stores page rewritten** — server component reads Prisma directly; `StoreStatusBadge` (Online/Token-only/Offline); `IdsReadySummary` pill badges; card grid with `border-emerald-200` for fully-ready stores; tab interface via `StoreCardTabs` (Connection | Etsy IDs | Auto Setup | QA); removed unused `getStores()` legacy import
- **StoreCardTabs** — new `src/components/etsy/StoreCardTabs.tsx` client component with 4 tabs, `IdRow` sub-component showing label/value/status dot
- **Batches page light theme** — systematic zinc→slate conversion (38+ pattern replacements); SectionHeader step circles now blue; Start Run button now solid green; StatusBadge updated to light bg variants (emerald-50/amber-50/blue-50/red-50); ProgressBar track converted to `bg-slate-200`
- **Settings page light theme** — zinc→slate conversion; section cards now `bg-white rounded-xl shadow-sm`; read-only inputs use `bg-slate-50`
- **Operator Guide light theme** — zinc→slate conversion; step circles blue; Note/Tip/SafetyBadge updated to light backgrounds
- **Cleanup script** — `scripts/cleanup-mvp-test-data.ts` + `npm run cleanup:test-data`; dry-run by default; deletes BatchRun + child records matching test/demo name patterns; never touches Store/Etsy tokens/presets
- **Bug fix** — `/api/batches/runs/[runId]` route now correctly returns 404 for non-existent IDs (was returning 500 on invalid cuid format)
- **Smoke tests** — 11/11 passing (drive/status was 404 due to stale dev server; nonexistent-id now 404 not 500)

---

## Core Constraints (Permanent)

- Listings remain Etsy drafts. **Never publish or activate.**
- Do not log secrets/tokens.
- Do not delete data.
- Max 30 listings per store per run.

---

## Known Issues / TODOs

- Auto-setup taxonomy search uses "t-shirt" keyword match; a yellow warning is shown when taxonomy was auto-selected — verify the ID in Etsy and use "Refresh IDs" to update if needed
- `ETSY_CLIENT_SECRET` is in `.env.example` but unused by the PKCE flow — kept as a documented placeholder
- Old dev test component files (`EtsyDraftTestButton`, `DeveloperTestTools`, `StoreAMiniBatchPreview`, `StoreMiniBatchPreview`, and related one-off draft buttons) were removed from `src/components/etsy/` in Phase 9E. Backend draft routes remain untouched for historical compatibility.
