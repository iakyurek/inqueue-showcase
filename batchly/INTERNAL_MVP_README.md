# Batchly — Internal MVP (Phase 9E)

Internal release candidate for real Etsy draft batch testing. Premium silver/charcoal UI theme.

## Core Constraints

- **Listings remain Etsy drafts.** Never publish or activate.
- **Do not log secrets or tokens.**
- **Do not delete data.**
- Max 30 listings per store per run (hard cap; remaining rows carry over to the next run).

## First Real Store A Test — Step by Step

1. **Connect Drive** — `/settings` → authorize Google Drive.
2. **Connect Store A** — `/stores` → "Connect Etsy account" OAuth → after success, click **Auto Setup Missing IDs** on the store card. This automatically fetches taxonomy ID, shipping profile ID, readiness profile ID, and return policy ID. If the taxonomy was auto-selected from a keyword search, verify it is correct in Etsy before running.
3. **Check preset** — `/settings` → Global Listing Preset → confirm materials (`Cotton,bella canvas,gildan`), item weight (4 oz), and packed dimensions (13×10×1 in) are set.
4. **Place a batch** — download from Drive (Step 1 on `/batches`) or manually copy a folder into `workspace/downloads/`. The folder must contain `batch_manifest.csv`.
5. **Validate** — click Validate on the batch. Review the Release Readiness card and per-store results. Fix any errors before proceeding.
6. **Select stores** — in the store selection table, check Store_A (or click "Select All Ready"). Only selected stores run. The selected count is shown on the Run button.
7. **Run** — click "Run Batch for Selected Stores". Review the confirmation modal (shows selected stores only), then confirm. Watch the progress panel.
8. **Review in Etsy** — open Etsy › Shop Manager › Listings › Drafts. Verify each draft looks correct (title, description, tags, price, materials, dimensions, images) before manually publishing.
9. **Run Listing QA** — on `/stores`, enter a listing ID and click **Run QA Check** to verify materials, weight, dimensions, tags, image count, and draft state.

---

## Recommended First Real Test Sequence

### Test 1 — Baseline draft (no supplemental images)
- Store A only, 1–3 rows
- Variations disabled
- Supplemental size charts **disabled** for this run
- Confirm Etsy drafts exist and look correct in Etsy Seller Dashboard

### Test 2 — With supplemental size charts
- Place 3 size chart images in `workspace/supplemental-images/size-charts/`
- Enable supplemental images in `/settings`
- Run another small draft batch (1–3 rows)
- Confirm each draft has the expected total image count (design images + size charts ≤ 10)

### Test 3 — With variations/inventory
- Enable variation preset in `/settings`
- Confirm variation property IDs are set
- Run a small batch
- Confirm variation inventory exists in Etsy draft

---

## Retry Semantics

| Row status | listingId | Safe to retry? | Action |
|---|---|---|---|
| `failed` | null | ✅ Yes | Click "Retry N Failed Rows" |
| `partial` | set | ❌ No — draft already exists in Etsy | Review manually in Etsy; delete duplicate if needed |
| `created` | set | — | Done |
| `skipped` | — | — | Duplicate detected; no action needed |

---

## Phase 9E.1 Additions

- **Dark command-center `/dashboard`** — dark graphite background (`#111318`), hero with Drive status pill, 8 metric cards (Ready Stores, Connected, Missing IDs, Local Batches, All-time Drafts/Failed/Skipped, Latest Status), Store Readiness per-store overview, Latest Run breakdown, Quick Actions, How Batchly Works
- **Professional `/stores` page** — dark graphite background, dark TopBar, dark inline banners; store cards redesigned as dark elevated SaaS cards with Online/Offline status, Etsy shop name + ID, IDs progress bar, readiness hint, and an expand/collapse Details panel
- **Store details panel** — smooth expand/collapse with pill tabs (Overview, Etsy IDs, Auto Setup, QA, Advanced); all functionality preserved (AutoSetup, IDs form, QA, disconnect/reconnect)
- **`GET /api/dashboard/summary`** — new API endpoint for dashboard metrics (connectedStores, offlineStores, readyStores, storesMissingIds, localBatchesCount, latestRun, allTimeDraftsCreated, allTimeFailedRows, storeReadiness)
- **`TopBar` dark mode** — `dark` prop switches to dark bg/border/text for stores and dashboard

## Phase 9E Additions

- **Premium silver/charcoal theme** — soft silver app background (`#f4f6f8`), white cards, subtle silver borders, charcoal sidebar, restrained shadows, and 150–250ms transitions on interactive elements
- **Bundled Geist typography** — app now uses local Geist Sans and Geist Mono assets instead of remote font loading
- **Thin premium scrollbar** — 5px width, rounded thumb, auto-hides on track hover
- **Batchly logo redesigned** — premium basket SVG with an integrated dark-gray "B", silver basket body, charcoal gradient background, and light/dark text variants
- **Reusable UI components** (`src/components/ui/batchly-ui.tsx`) — `SoftCard`, `MetricCard`, `StatusBadge`, `StepPill`, `PrimaryButton`, `SecondaryButton`, `GhostButton`, `ActionCard`, `Notice`
- **Dashboard upgraded** — command-center dashboard with connected stores, ready stores, local batches, latest run status, latest drafts, and failed rows; quick actions for Batches, Stores, Presets, and Operator Guide
- **Stores page** — cleaner store cards with Online/Offline badges, connected shop name/ID, setup readiness summary, primary connect/setup actions, and tabs for Connection, Etsy IDs, Auto Setup, QA, and Advanced
- **Settings page** — Drive, Etsy API, Listing Preset, Description Template, Materials/Weight/Dimensions, Supplemental Images, Variations/Inventory, and Workspace sections use readable light inputs and grouped cards
- **Batches page** — final workflow polish for Detect/Download, Validate, Select Stores, Run Batch, Progress/Results, recent runs, empty/error/success states, and old test wording cleanup
- **Operator guide** — refreshed to match the premium theme and old advanced mini-batch guidance removed from the user-facing workflow

## Phase 9D Additions

- **Disconnect Etsy Shop button** — on `/stores` → Connection tab → "Disconnect Etsy Shop". Two-phase confirmation (idle → confirm panel). Clears local OAuth fields only; does not delete Etsy listings or Etsy IDs (taxonomy, shipping, etc.).
- **Duplicate-shop guard** — if an Etsy shop is already connected to another Batchly store, the callback blocks the connection and redirects with a clear error banner explaining the conflict.
- **Session warning** — blue callout in the Connection tab: "Etsy silently reuses whichever account is currently signed in your browser. To connect a different Etsy account: disconnect, sign out of Etsy, then reconnect."
- **Wrong-shop conflict banner** — `/stores` page shows a red banner when `shop_already_connected` is returned, naming the conflicting shop and the store that owns it.
- **Connected shop name displayed** — shop name and shop ID shown prominently in every store card header (when connected).
- **Button text updated** — "Connect Etsy Shop" (offline) / "Reconnect Etsy Shop" (online); solid blue button instead of ghost.

## Phase 9C Additions

- **Light professional theme** — all pages converted from dark zinc palette to light slate; `bg-slate-50` app background, `bg-white` cards, blue/green accents for actions/status only
- **Batchly logo** — `BatchlyLogo` SVG component (blue square + stacked bars); shown in sidebar header and dashboard hero
- **Sidebar redesigned** — dark slate nav (bg-slate-900) with blue active state; removed Upload Queue / Errors / Reports links; logo in header; "Phase 9C · Internal" footer
- **Dashboard rewritten** — logo hero, stat cards, latest run, quick actions, workflow guide, safety note
- **Stores page redesigned** — card grid with Online/Offline/Token-only status badges; IDs summary pills; tab interface (Connection | Etsy IDs | Auto Setup | QA) via `StoreCardTabs`
- **Batches page light theme** — step circles blue, run button solid green, status badges use light bg (emerald-50/amber-50 etc.), table rows readable on white
- **Settings & Operator Guide** — both converted to light slate theme
- **Cleanup script** — `npm run cleanup:test-data` (dry-run by default); removes test BatchRun records matching name patterns; never touches real store data
- **Bug fix** — `/api/batches/runs/[runId]` correctly returns 404 for non-existent IDs

## Phase 9B Additions

- **Listing QA extended** — checks materials, material tags (Cotton, bella canvas, gildan), item weight (expected 4 oz), packed dimensions (expected 13×10×1 in), size chart file count, draft state, image cap (≤10)
- **Auto Setup improved** — each field (taxonomyId, shippingProfileId, readinessStateId, returnPolicyId) shows status: `saved` / `already set` / `not found` / `failed`
- **Auto Setup — two modes** — "Auto Setup Missing IDs" fills only missing fields; "Refresh IDs" re-fetches and overwrites with confirmation
- **Taxonomy auto-selection warning** — shown when taxonomy was auto-selected from keyword search instead of an exact name match
- **Size chart validation stronger** — missing required size charts shown as a prominent error in validation dashboard (not just a warning message)
- **Validation supplemental card** — shows size chart count vs required (e.g. `2/3`) in red if insufficient
- **Old dev test UI removed** — Create Test Draft, Draft from Manifest, Developer Test Tools buttons are no longer visible in any user-facing page

## Phase 9A Additions

- **Materials** — every listing is sent with `materials: ["Cotton", "bella canvas", "gildan"]`
- **Item weight** — every listing is sent with `item_weight: 4`, `item_weight_unit: "oz"`
- **Packed dimensions** — every listing is sent with `item_length: 13`, `item_width: 10`, `item_height: 1`, `item_dimensions_unit: "in"`
- **Auto Setup** — one button on each store card fetches all required Etsy IDs automatically
- **Store selection** — after validation, pick which stores to run via checkbox table; unselected stores are skipped
- **Size chart validation** — warns if fewer than 3 size chart images are found in `workspace/supplemental-images/size-charts/`

---

## Known Limitations

- Store selection is controlled by `MINI_BATCH_ENABLED_STORE_FOLDERS` in `draftFlowHelpers.ts` — only whitelisted folders are accepted.
- Supplemental images (size chart, promo) require files in `workspace/supplemental-images/`.
- Variation inventory update runs after draft creation; a `partial` row means the draft was created but inventory update failed.
- No email or webhook notification on run completion — check the progress panel manually.
- Drive token refresh is handled automatically, but if the Drive connection drops mid-run the batch must be re-run (already-created rows will be skipped as duplicates).

---

## File Layout

```
workspace/
  downloads/        ← batch folders land here
    <batch>/
      batch_manifest.csv
      <store_folder>/
        <design_id>/
          *.jpg / *.png
  supplemental-images/
    size-charts/    ← place 3 size chart .jpg/.png files here
    promo/
prisma/
  dev.db            ← SQLite database
```

## Running Locally

```bash
npm run dev          # start dev server on :3030
npx tsc --noEmit    # type-check
npm run build        # production build
npm run smoke:batches        # smoke tests (11/11)
npm run cleanup:test-data    # dry-run cleanup (add --run to apply)
```
