# Batchly — Pre-Production Checklist

Use this checklist before running Batchly with real Etsy shops and real batch folders.
All items must be confirmed before any draft creation is performed.

---

## 1. Environment Checklist

- [ ] `.env.local` file exists locally (never committed to git)
- [ ] `ETSY_CLIENT_ID` is set in `.env.local`
- [ ] `ETSY_CLIENT_SECRET` is set in `.env.local` (kept for reference; PKCE does not use it in exchange)
- [ ] `ETSY_REDIRECT_URI` is set in `.env.local` (e.g., `http://localhost:3030/api/auth/etsy/callback`)
- [ ] `ETSY_SCOPES` is set in `.env.local` (e.g., `shops_r listings_r listings_w`)
- [ ] Google Drive credentials are local only (`.tokens/google.json` is gitignored)
- [ ] No secrets appear in any committed file (`git diff HEAD` shows no `.env` content)
- [ ] `.gitignore` covers `.env`, `.env.*`, `.env*.local`, `.tokens/`, `prisma/dev.db`, `workspace/downloads/`

---

## 2. Store Setup Checklist

Repeat for each store (Store A through Store H) before creating drafts for that store.

- [ ] Shop owner has authorized Batchly through Etsy OAuth (`/stores` → Connection tab → "Connect Etsy Shop")
- [ ] Store shows **Connected** badge (green) with shop name and shop ID visible in the card header
- [ ] Confirmed that the correct Etsy shop is connected (check shop name in card header matches expected shop)
- [ ] If the wrong shop was connected: clicked "Disconnect Etsy Shop", signed out of Etsy in browser, reconnected
- [ ] `taxonomyId` saved in Store Etsy IDs form for this store
- [ ] `shippingProfileId` saved in Store Etsy IDs form for this store
- [ ] `readinessStateId` saved in Store Etsy IDs form for this store
- [ ] Store Setup Status panel shows **Ready for dry run**
- [ ] Etsy IDs belong to the correct Etsy shop for this store (verify in Etsy Seller Dashboard)

---

## 3. Batch Checklist

- [ ] Batch folder downloaded from Google Drive (`/settings` → Drive → Download & Validate)
- [ ] `workspace/downloads/<batch-folder>/batch_manifest.csv` exists
- [ ] Store folders exist: `Store_A/` through `Store_H/` (only stores included in the batch)
- [ ] Design folders exist inside each store folder (e.g., `Store_A/D001/`, `Store_A/D002/`)
- [ ] Image files (`.jpg`, `.jpeg`, `.png`) exist in each design folder
- [ ] Validation panel shows no blocking errors (warnings are acceptable)

---

## 4. Creation Checklist

Repeat per store, per mini-batch request.

- [ ] Load mini-batch preview for the store first (click **Load … Mini-Batch Preview**)
- [ ] Review all errors and warnings in the preview before selecting rows
- [ ] Select only eligible rows (rows without blocking errors)
- [ ] Confirm selected row count is ≤ 3 (max 3 per request)
- [ ] Review any IP/trademark warnings — decide whether to proceed
- [ ] Confirm the dialog clearly states "Draft-only — will NOT be published or activated"
- [ ] After creation, open each draft in Etsy Seller Dashboard and verify it looks correct
- [ ] Review draft title, description, tags, price, and images inside Etsy
- [ ] If drafts are test/development drafts, delete them from Etsy before publishing real ones

---

## 5. Safety Checklist

- [ ] Batchly has no publish or activate flow — confirmed by reviewing routes (`store-mini-batch-create` returns `status: "draft"` only)
- [ ] No all-store run button exists in the UI
- [ ] Duplicate protection is active — already-created rows show **Already Created** badge and cannot be selected
- [ ] Run history is visible in the mini-batch panel (Show last 5 runs)
- [ ] Draft-only workflow confirmed — OperatorSafetyChecklist reviewed
- [ ] No listing is activated, published, or set live by Batchly at any point
- [ ] Operator has read and understood all 8 items in the Operator Safety Checklist on `/stores`

---

## 6. Real-Use Dry Run Checklist

Complete this checklist before scaling to multiple stores or multiple rows per request.

- [ ] Choose one connected and configured store (Store Setup Status shows **Ready for dry run**)
- [ ] Load mini-batch preview for that store
- [ ] Identify at least one eligible row with no blocking errors
- [ ] Review any IP/trademark warnings on that row
- [ ] Select **only 1 row** for the first dry run
- [ ] Read the confirmation dialog carefully before confirming
- [ ] Confirm the dialog states "Draft-only — will NOT be published or activated"
- [ ] After creation, copy the Listing ID from the result card
- [ ] Open Etsy Seller Dashboard → Listings → Drafts and find the draft by ID
- [ ] Verify: correct Etsy shop, status is Draft (not active), title/description/tags/price correct, images attached
- [ ] Verify: the listing is NOT published or set live in any way
- [ ] Reload the Batchly preview and confirm the row now shows **Already Created** (duplicate protection working)
- [ ] If the dry run draft is correct, proceed to additional rows or stores
- [ ] If the dry run draft is incorrect, delete it in Etsy and investigate before continuing
- [ ] Do not scale to 3 rows per request until at least one single-row dry run is confirmed

---

## 7. Listing Description Checklist (Phase 7A)

- [ ] `GlobalListingPreset.descriptionTemplate` is populated in the DB (run `npm run db:seed` if missing)
- [ ] Open `/settings` → Global Listing Preset → confirm the **Listing Description Template** textarea is not empty
- [ ] Verify the template does NOT start with a specific listing title (the title is injected dynamically per listing)
- [ ] After creating a draft, open it in Etsy and confirm: first line is the manifest row title, second line is blank, then the shared template body follows
- [ ] Confirm the description does NOT contain "World Cup Shirt, Country Shirt..." as a hardcoded first line
- [ ] If the template needs editing, update it in `/settings` and click **Save preset**

---

## 8. Store Etsy IDs Setup Checklist (Phase 7A.1)

Repeat for each store before creating drafts. Each store must have its own Etsy IDs saved.

- [ ] Go to `/stores` → find the target store card
- [ ] Confirm the store shows **Connected** badge with a shop name
- [ ] Click **Load** in the Etsy IDs helper panel to fetch shipping profiles
- [ ] Copy the correct `shipping_profile_id` and paste it into the **Saved Etsy IDs** form
- [ ] Use **Taxonomy Search** to find the right `taxonomy_id` and paste it into the **Saved Etsy IDs** form
- [ ] Click **Find or Create Made-to-Order Processing Profile** to get the `readiness_state_id`
- [ ] Click **Save to Store Etsy IDs** in the profile result (or paste the ID into the form manually)
- [ ] Click **Save IDs** in the Saved Etsy IDs form to persist all IDs
- [ ] Reload the page and confirm the IDs are still present in the Saved Etsy IDs form
- [ ] Confirm Store Setup Status shows **Ready for dry run**
- [ ] Repeat for each store that will be used in mini-batch creation

---

## 9. Listing QA Checklist (Phase 7D)

Run QA after creating each new draft to confirm it is complete and correct. QA is read-only — it does not modify listings.

- [ ] After creating a draft, click **Run QA for this draft** on the result card
- [ ] Confirm **QA Status: PASS** (or review warnings)
- [ ] Confirm **state** is `draft` or `inactive` — never `active`
- [ ] Confirm **image count** is ≥ 1 and ≤ 10
- [ ] Confirm **description length** is > 200 chars (template present)
- [ ] Confirm **description first line** matches the manifest row title
- [ ] If supplemental images are enabled, confirm image count reflects supplemental images were included
- [ ] If variation preset is enabled, confirm inventory product count is > 0 and `hasVariations` is true
- [ ] If variation preset is disabled, confirm inventory check shows "not required"
- [ ] Confirm **no listing was published or activated** (QA will show FAIL if state is active)
- [ ] On the Stores page → Listing QA panel: enter a listing ID and confirm QA passes for an older draft
- [ ] Run QA on the latest run via the run history "QA created drafts in this run" button

---

## 10. Variation Inventory Checklist (Phase 7B)

Skip this section if `GlobalVariationPreset.enabled` is false (default).

- [ ] Go to `/settings` → **Global Variation Preset**
- [ ] Click **Load Properties** to fetch variation-supporting property IDs for your taxonomy ID
- [ ] Find the property ID for Size and enter it in **Variation 1 Property ID**
- [ ] Find the property ID for Color and enter it in **Variation 2 Property ID**
- [ ] Confirm Size options (S, M, L, XL, 2XL, 3XL) and Color options are correct
- [ ] Confirm combination count does not exceed 100
- [ ] Check the **Enable variation + inventory update** checkbox
- [ ] Click **Save Variation Preset**
- [ ] Create one test draft and confirm inventory is set in Etsy with the correct variants
- [ ] Confirm row status shows `created` (not `partial`) when inventory succeeds

---

## 11. Supplemental Images Checklist (Phase 7C)

Skip this section if `GlobalSupplementalImagePreset.enabled` is false (default).

- [ ] Create folders if not present:
  - `workspace/supplemental-images/size-charts/`
  - `workspace/supplemental-images/promo/`
- [ ] Place size chart image(s) (`.jpg`/`.jpeg`/`.png`) in `size-charts/`
- [ ] Place promo image(s) (`.jpg`/`.jpeg`/`.png`) in `promo/`
- [ ] Go to `/settings` → **Global Supplemental Images**
- [ ] Click **Preview Files** and confirm the expected files are listed
- [ ] Adjust **Max supplemental images** if needed (0–10; combined with design images must not exceed 10)
- [ ] Check the **Enable supplemental image upload** checkbox
- [ ] Click **Save Supplemental Image Preset**
- [ ] Go to `/stores`, load preview for a configured store
- [ ] Confirm the supplemental images banner shows "active — N files ready"
- [ ] Select 1 eligible row and create a draft
- [ ] Confirm result card shows `Supplemental: N/N uploaded`
- [ ] Open the draft in Etsy and verify size chart / promo images appear after the design images
- [ ] Confirm total listing images do not exceed 10
- [ ] Confirm listing remains a draft — nothing was published or activated

---

## 12. Preflight Checklist (Phase 7E)

Run before every create session. Preflight is read-only — it makes no Etsy API calls and creates nothing.

- [ ] Load mini-batch preview for the target store
- [ ] Click **Select first eligible row for one-draft test** to auto-select the first eligible row (for initial setup)
- [ ] Click **Run Preflight Check** with 1–3 rows selected
- [ ] Confirm preflight panel shows **PASS** or **WARNING** (not FAIL)
- [ ] If FAIL: read the fail messages, fix the issues (save missing IDs, add images, fix variation config), re-run preflight
- [ ] If WARNING: review warnings (e.g., IP/trademark, description sections) and decide whether to proceed
- [ ] Confirm selected count in preflight summary matches your intended selection
- [ ] Confirm supplemental images available count is as expected (0 if disabled, N if enabled)
- [ ] Confirm variation combination count is correct (0 if disabled, ≤ 100 if enabled)
- [ ] Only click **Create Selected Drafts + Images** after preflight passes or warns for the current selection
- [ ] If selection changes after preflight, re-run preflight before creating
- [ ] Confirm the create button's tooltip says "Fix issues" only if there is actually a fail

---

---

## 14. Phase 9C — UI Theme + Product Polish

- [x] Light professional theme applied across all pages (dashboard, batches, stores, settings, operator guide)
- [x] Batchly logo added to sidebar and dashboard
- [x] Stores page redesigned with tab interface (Connection / Etsy IDs / Auto Setup / QA)
- [x] Batches page converted to light theme with solid action buttons
- [x] `npm run cleanup:test-data` script added for safe test data removal
- [x] `/api/batches/runs/[runId]` correctly returns 404 for non-existent IDs
- [x] Smoke tests: 11/11 passing
- [x] tsc: clean
- [x] build: clean

---

## 13. Phase 9B — Batch Run Checklist (Final QA + Real Batch Readiness)

**Use this for all real Store A+ testing from Phase 9A onwards.**

### Pre-flight
- [ ] All stores to be used show **Connected** badge in `/stores`
- [ ] Click **Auto Setup Missing IDs** for each connected store and confirm all 4 IDs are saved (taxonomyId, shippingProfileId, readinessStateId, returnPolicyId)
- [ ] If taxonomy was auto-selected (yellow warning shown), verify the taxonomy ID is correct for your product in Etsy before running
- [ ] Go to `/settings` → Global Listing Preset → confirm `materials`, `itemWeight`, `itemLength/Width/Height` are set
- [ ] Go to `/settings` → Global Supplemental Images → confirm size chart images exist (at least 3 in `workspace/supplemental-images/size-charts/`)
- [ ] Download/sync batch from Drive to `workspace/downloads/` via `/batches` → Step 1

### Validate
- [ ] Click **Validate** on the batch
- [ ] Review the Release Readiness card — Drive, stores, latest run
- [ ] Review the Validation Dashboard — manifest rows, per-store status
- [ ] Confirm 0 blocking errors for stores you intend to run
- [ ] Check warnings (missing images, description template, size chart count)

### Select Stores + Run
- [ ] Use the store selection table to select specific stores (or click **Select All Ready**)
- [ ] Confirm selected stores show green ✓ Ready in the table
- [ ] Click **Run Batch for Selected Stores**
- [ ] Review the confirmation modal — correct stores, estimated count, settings flags
- [ ] Click **Confirm** to start the run
- [ ] Watch progress panel — rows should move from queued → created or skipped
- [ ] If any rows show `failed`: click **Retry N Failed Rows** to re-process pre-creation failures
- [ ] If any rows show `partial`: review in Etsy Seller Dashboard → Drafts manually (never retry partial rows)

### QA
- [ ] After run completes, go to Etsy Seller Dashboard → Listings → Drafts
- [ ] Verify each draft: correct title, description, tags, price, images, materials, dimensions
- [ ] Confirm listings are in **Draft** state — NOT active or published
- [ ] Run Listing QA on `/stores` per store to confirm field values — check materials (Cotton, bella canvas, gildan), weight (4 oz), dimensions (13×10×1 in), tags, image count, draft state
- [ ] Only publish listings manually after full review

---

## Notes

- **Max 30 listings per store per run** is enforced server-side. Cannot be bypassed from the client.
- **Selected stores only** — unselected stores are skipped with reason "not selected for this run."
- **Partial rows** (listingId set) must never be retried — they already exist as Etsy drafts.
- **Auto Setup** fills Etsy IDs automatically; use the **Force Reconfigure** button to overwrite if IDs change.
- **Each store uses its own OAuth token and Etsy shop ID.** There is no cross-store credential sharing.
- **Draft listings created by Batchly start with "Batchly Test - "** as a title prefix for easy identification during testing. Remove or rename this prefix before publishing real listings.
- **Listing descriptions are built as:** `<manifest row title>\n\n<GlobalListingPreset.descriptionTemplate>`. The title is never hardcoded.
- **Supplemental images are shared across all stores and listings.** Size chart and promo images in `workspace/supplemental-images/` apply to every new draft. Uploaded after design/mockup images. Etsy's 10-image cap is enforced.
- **Variation inventory failures and supplemental image failures are non-blocking.** The draft is still created; the row status becomes `partial` and the error is shown in the result card.
- **Preflight is enforced server-side.** Even if the frontend is bypassed, `store-mini-batch-create` runs `buildPreflight()` and blocks creation if any fatal check fails.
- **One-draft test mode** auto-selects only the first eligible, not-yet-created row. It does not create anything — the operator must still run preflight and confirm creation.
- **This checklist does not replace Etsy's listing review process.** Always review drafts inside Etsy before publishing.

---

## 13. Durable Batch Run Checklist (Phase 8B)

Run before starting any full batch run. This covers the step-based runner and progress tracking.

### Pre-Run
- [ ] Batch folder is present in `workspace/downloads/` with `batch_manifest.csv`
- [ ] Click **Validate** on the batch in Section B — validation must reach "ready" or "warnings"
- [ ] Per-store cards show: ✓ Connected, ✓ IDs, at least 1 eligible row
- [ ] Global preset has a description template set
- [ ] Variation preset: if enabled, check combination count < 100, property IDs set
- [ ] Supplemental preset: if enabled, check at least 1 file found
- [ ] Confirm "Duplicates skipped" count is correct (already-created listings will not be re-created)

### Start Run
- [ ] Click **Start Batch Run** — review confirmation dialog (stores, estimated listings, duplicate count)
- [ ] Confirm is the only way to proceed — close the dialog to cancel
- [ ] Run is created as "queued" and immediately starts stepping
- [ ] Progress bar and current store/designId update in real time (auto-step loop)

### During Run
- [ ] Do not close or refresh the page while the run is in progress — the step loop runs client-side
- [ ] If the page is closed mid-run: re-open `/batches`, select the run from "Recent Batch Runs", and check status
- [ ] If status shows rows still "queued" after page refresh: the step loop stopped — click Retry or re-open to resume
- [ ] "Running" rows turn blue in the progress dots

### Post-Run
- [ ] Run status shows "completed" (all rows created) or "partial" (some failed/partial)
- [ ] Check failed rows section — retry if needed
- [ ] Listing IDs shown in the expanded store card — copy for Etsy QA
- [ ] Click **Retry Failed Rows** if any failed rows are shown
- [ ] Retry resets failed rows to queued and restarts the step loop automatically
- [ ] After retry, review final counts: created / failed / skipped

### QA
- [ ] Open at least one created draft per store in Etsy and verify: title prefix, images, description, tags
- [ ] Verify variations applied if variation preset is enabled
- [ ] Verify supplemental images at correct positions
- [ ] Go to `/stores` for the full listing QA dashboard
- [ ] Remove "Batchly Test - " title prefix before publishing any real listings

### Notes
- **Draft-only.** Nothing is published or activated. Etsy `state: draft` is the only creation state used.
- **Max 30 listings per store per run.** Hard limit enforced in `batchRunService.ts`.
- **Duplicate protection is cross-run.** `DraftCreationRecord` is written per created row. A second run on the same batch skips already-created design IDs.
- **Failed row retry** resets only failed rows (not created/partial/skipped). Rows that succeeded are not re-processed.
- **Store lock (`acquireDraftLock`)** prevents concurrent runs on the same store. If a run is already in progress for a store, the row is requeued for the next step.
- **Retry does not create a new run** — it resets failed rows in the existing run and continues from where it left off.

---

## 15. Phase 8D Final Workflow Checklist

Run this after completing the full Phase 8D workflow to confirm the end-to-end flow works.

### /batches page — golden path
- [ ] Open `/batches` — safety strip visible, step numbers shown
- [ ] Step 1: Open Drive panel — shows connected/not-connected state clearly
- [ ] Step 2: Batch list loads — batch cards show manifest status, row count, stores
- [ ] Click **Validate** on a batch — shows "Validating…" spinner, then validation dashboard
- [ ] Validation dashboard: manifest rows, est. new drafts, duplicates, per-store cards visible
- [ ] Expand a store card — Etsy IDs and error/warning details shown
- [ ] Click **Start Batch Run** — inline confirmation modal opens (not browser dialog)
- [ ] Confirmation modal: per-store breakdown, totals, variation/supplemental settings, Cancel button works
- [ ] Confirm run → progress panel appears with overall bar, per-store cards
- [ ] Per-store cards show mini progress bars and row dots
- [ ] Expand a store during run — RowTable shows active row with spinner, completed rows with listing IDs
- [ ] After completion: listing IDs shown (select-all), "Run Listing QA at Stores →" link visible
- [ ] If failed rows: "↺ Retry Failed Rows" button appears → clicking shows inline confirmation → confirm retries
- [ ] "← Validation" button returns to validation dashboard without re-validating
- [ ] Recent Batch Runs section shows prior runs; click one to view its progress

### Operator guide
- [ ] `/operator-guide` shows 12-step workflow (steps 1–12)
- [ ] Troubleshooting section explains 5 common issues
- [ ] Quick Reference shows safe vs. Etsy-only actions

---

## 14. Phase 8C Stabilization Notes

- **`batchRunService.ts`** has been audited and 5 bugs fixed. The service is now the single source of truth for batch run state.
- **Smoke test available:** Run `npm run smoke:batches` with the dev server active (`npm run dev`) to verify all batch APIs respond correctly. The test is non-destructive — no Etsy calls, no writes.
- **Zero-row run** (no new listings to create) now shows a dedicated empty-state panel — the step loop exits immediately.
- **Run error dismiss:** If `Start Batch Run` fails, a "Dismiss to see validation results" button restores the validation dashboard.
- **Operator guide** now points to `/batches` as the primary workflow. `/stores` is for per-store debug/mini-batch testing only.
