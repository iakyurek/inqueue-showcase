# inQueue deployment plan (Phase 2 — foundation)

**Status:** foundation only. Nothing is deployed yet.

**Env var audit tool:** `node scripts/audit-env-requirements.mjs [service] [--check]`
prints the exact env vars each service's code reads (mirrors §2 below), with
`--check` marking each SET/MISSING against the current process env. It never
reads `.env` files and never prints a value — safe to run against a real
Render shell.

This doc pins down the pieces the code now assumes so a Render deploy is a
mechanical exercise (create services, set env vars, mount disks, run one
Postgres migration) rather than a rewrite.

## 1. Service topology on Render

Two Render services, one hostname each. This keeps auth simple: the session
cookie lives on each service's own origin, and cross-service navigation is
done via absolute URLs that come from env vars (never hard-coded).

| Service        | What runs                                                      | Runtime | Public URL (example)               |
|----------------|----------------------------------------------------------------|---------|-------------------------------------|
| `inqueue-web`  | Root hub (`server.js`, port 4000) — login page, dashboard, tool link aggregator. Optional: colocate Inkly and Preply behind one Express gateway when we're ready to consolidate. | Node    | `https://web.inqueue.io`            |
| `inqueue-inkly`| `inkly/server.js`, port 5500                                   | Node    | `https://inkly.inqueue.io`          |
| `inqueue-preply`| `preply/server.js`, port 3001                                 | Node    | `https://preply.inqueue.io`         |
| `inqueue-batchly`| `batchly/` (Next.js), port 3030                              | Node    | `https://batchly.inqueue.io`        |

Four services now, with a documented path to collapse to two (one Node process
serving hub+inkly+preply behind an Express gateway) when that refactor lands.

### Cookie / auth notes — one-login SSO across separate origins

On Render each service has its own hostname, so a cookie set by the hub
(`inqueue_session`, no `Domain=`) is **never sent to a tool origin**. Before
SSO, clicking Inkly/Preply/Batchly bounced straight back to login forever.

The fix is a **hub-brokered SSO handoff** (see `lib/sso.js`, and
`batchly/src/lib/sso.ts` for the Edge/Web-Crypto twin):

1. Hub dashboard links point at the hub's own `/auth/launch?tool=<tool>&next=<relative>`.
2. `/auth/launch` checks the hub session. Unauthenticated → `/login?next=<launch>`
   (the hub stays the only login screen). Authenticated → it mints a
   **short-lived (60s) HMAC ticket** — `{u, tool, next, iat, exp, nonce}`,
   signed with `INQUEUE_SESSION_SECRET`, base64url — and 302s to the tool's SSO
   callback on the tool's own origin.
3. The tool callback (`/auth/sso/callback`, or `/api/auth/sso/callback` for the
   Next.js Batchly app) verifies the ticket **for its own tool**, rejects
   malformed/expired/wrong-tool tickets, and on success sets its own
   **first-party** browser-session cookie: `inqueue_inkly_session`,
   `inqueue_preply_session`, or `inqueue_batchly_session`. Then it 302s to the
   validated relative `next`.
4. Every later request to that tool carries its first-party cookie, so no
   further login screen appears. Each tool still also accepts the shared
   `inqueue_session` cookie (same-origin / local dev), so nothing regresses.

Direct unauthenticated visits to a tool now redirect to
`INQUEUE_HUB_URL/auth/launch?tool=<tool>&next=<current-relative-path>` (browser
navigations) or return `401 {"error":"UNAUTHENTICATED"}` (`/api/*` requests).

**Do NOT set `Domain=.onrender.com` on any cookie.** `.onrender.com` is a
public suffix shared by every Render customer — a parent-domain cookie there
would be a cross-tenant leak and browsers block it anyway. SSO is exactly what
lets us keep cookies host-only. (A real apex you control, e.g.
`Domain=.inqueue.io`, remains a *possible* future optimization, but SSO does
not need it and is the recommended approach for the Render `*.onrender.com`
topology.)

Cookie flags on every session cookie (hub and per-tool): `HttpOnly`,
`SameSite=Lax`, `Path=/`, `Secure` when `NODE_ENV=production`, and **no
`Max-Age`/`Expires`** so they are browser-session cookies. Tokens are never
exposed to frontend JS and never stored in `localStorage`.

### Store configuration (hub source of truth)

The hub's **Configure** tab manages the six fixed store slots (Store_A..Store_F):
identity, enabled flag, Etsy resource IDs + connection status, Drive SKU folder
(+ read-only access test), SKU prefix (+ scan-assisted inference), and the shared
draft presets. Storage is hub-owned Postgres (`INQUEUE_DATABASE_URL`, tables in
`migrations/001_init.sql`); dev falls back to `data/store-config.json`.

Distribution is **push-sync, not runtime reads**: on save/Sync-now the hub POSTs
its full config state to `POST /api/internal/config-sync` on each tool,
authenticated by short-lived HMAC Bearer service tokens (`lib/serviceAuth.js`,
audience-scoped, 60s TTL — never cookies). These tokens are signed with the
**same** `INQUEUE_SESSION_SECRET` used for the SSO session cookie — there is
no separate `INQUEUE_SERVICE_TOKEN_SECRET` env var, and the code does not read
one. Do not add one; it would do nothing. Tools keep operating from their own
local stores (`preply/data/stores.json`, Batchly's Prisma DB), so the hub is
never in the draft-creation hot path and an unreachable hub degrades to
"out of sync", never to downtime. Etsy OAuth stays **brokered through Batchly**
(the proven PKCE flow + token custody); the hub holds connection *status* only —
no tokens ever live in hub storage. Full architecture, sync protocol, flip
runbook, and Store_A safety analysis: `docs/plans/store-config-hub-plan.md`.

**Sync creates missing Batchly store rows.** Because the hub owns store identity,
`config-sync` upserts on `Store.driveFolderName`, so a freshly provisioned
Batchly Postgres that was never seeded gets its `Store_A..Store_F` rows from the
first sync. This is what makes "Connect Etsy" resolvable in production —
**run "Sync now" on the Configure tab before connecting Etsy for a slot.** The
upsert never writes token or shop-identity columns, so an existing Etsy
connection always survives a sync.

**Etsy Connect return flow.** The hub's Connect button goes through the hub's own
SSO launch into Batchly's `/api/auth/etsy/start?storeFolder=Store_X&returnTo=hub`.
`returnTo=hub` is a **sentinel**, not a URL: Batchly stores it in the single-use
PKCE state file and resolves the actual return address from its own
`INQUEUE_HUB_URL`, landing the operator back on `<hub>/configure?etsy=…&store=Store_X`.
No request-supplied URL is ever persisted or followed. Every failure branch
(including "store not synced", "Etsy declined", and token-exchange errors)
returns to the hub Configure tab with an actionable reason — never to Batchly's
`/stores` page.

### Global listing preset (hub source of truth)

The hub Configure → **Draft presets** panel is the single place to edit the
baseline every Etsy draft uses. It syncs to Batchly (`config-sync`, same
service-token push as store config) into the `GlobalListingPreset` singleton;
Batchly's Settings page shows these values **read-only**. Draft listings are
created in Etsy's `draft` state only — nothing is published or activated.

Which fields live where:

| Layer | Fields | Notes |
|---|---|---|
| **Global preset** (hub Draft presets) | `who_made` (`i_did`), `when_made` (`made_to_order`), `type` (`physical`), materials (`Cotton,bella canvas,gildan`), item weight (4 oz) + package dims (13×10×1 in), default price/qty, personalizable flag, **description template** | Applied to every draft across all stores. |
| **Per store** (hub store cards → Etsy IDs) | `taxonomy_id` (T-shirts), `shipping_profile_id`, `readiness_state_id` (the "Made to order" processing profile / 1–2 day time), `return_policy_id`, `section_id` | Resolved from each store's connected Etsy account; never hardcoded. Shipping origin ZIP lives inside the store's Etsy shipping profile. |
| **Per listing** (dynamic, never preset) | title, description first line, tags/keywords, SKU, images (mockups + size charts), variation price/qty | Come from the design metadata / manifest / SKU reservation / image pipeline — unchanged by this preset. |

**Description composition.** Batchly builds each description as
`"<design title>\n\n<template>"` (`buildListingDescription`). The stored
template is therefore the body only — the `ORDERING / CARE / PRODUCTION &
SHIPPING / RETURN POLICY` block — and the design title is prepended per
listing. The canonical baseline ships as the hub default
(`DEFAULT_DESCRIPTION_TEMPLATE` in `lib/storeConfig.js`) and is applied on read
whenever the stored template is blank, so existing installs get it without a
manual paste; editing the field in Draft presets overrides it.

**Etsy settings the listing API cannot control (manual / not faked).** These
appear in the shop's listing UI but are not fields the draft-creation API
accepts, so the workflow does not pretend to set them:

- **Etsy Ads** (on/off) — shop-level advertising, managed in Etsy.
- **Feature this listing** — manual, per listing in Etsy.
- **Renewal (automatic)** — applied by Etsy at publish, not on drafts.
- **Materials dropdown / Size scale / Sustainability / Sleeve length**,
  **"How does your shop produce this item?"**, tools, and production partner —
  left unset because the reference listing does not set them; not inferred.

**After deploying this change, run "Sync now" once** on the Configure tab so
Batchly's `GlobalListingPreset` picks up the description template (the sync
overwrites preset values but never touches Etsy tokens or store identity).

### Variation profiles (Front-sided / Double-sided)

Every design carries one variation-profile key describing its variation +
fulfillment configuration. The canonical matrices are **hub-owned** and
code-defined (`lib/variationProfiles/`), pushed to Batchly in the same
config-sync payload (`variationProfiles`) and stored verbatim in the
`variationProfiles` AppSetting — Batchly never re-derives or edits the matrix,
and no tool holds a second editable copy.

- **`front_sided`** — fully defined from `Variations.pdf`: 28 Style options ×
  14 Primary colors = 392 combinations, **188 offered** (offered color sets
  differ per garment). Two live-listing anomalies were normalized for this
  new-listing template and recorded in `SOURCE_ANOMALIES` (Unisex M Heather
  Mauve qty 998→999; Baby 3-6 Months Black $18.99→$34.99).
- **`double_sided`** — fully defined from `Variations.docx`: same 28 × 14 = 392
  grid, **188 offered**. Its **availability matrix is identical to front_sided**
  (same offered color set per garment family); only **pricing differs** — the
  double-sided tiers are materially higher (Unisex $44–48, Sweatshirt $61–66,
  Hoodie $65–69, Youth $42–43, Toddler $43, Baby $42). Fourteen live-listing
  anomalies were normalized and recorded in `SOURCE_ANOMALIES` (thirteen
  offered quantities 998/997→999; Baby 3-6 Months Heather Mauve $26.99→$42.00).

Both profiles are expanded by the **same** tested builder
(`buildProfileFromSource`) from a compact, auditable source table, so they
cannot drift structurally; a `double_sided` row never falls back to
`front_sided` pricing.

Flow: **Preply mockup preset → Design type (Front/Double-sided) → design
inherits it → `variation_profile` column in `batch_manifest.csv` → Batchly
resolves it → applies the matching profile.** The profile is chosen on the
mockup preset (create/edit shows a *Design type* selector; the preset card and
manifest carry it), because it describes the artwork, not a per-store price book.

**Manifest contract.** `batch_manifest.csv` gains an **optional**
`variation_profile` column (`front_sided` | `double_sided`). It is not
required — a manifest produced before this feature, or a blank cell, resolves
to `front_sided`, so existing/in-flight batches keep working. The value is
normalized on parse and survives Drive export, import, validate, preview,
run, retry, and reconcile.

**Batchly resolution + gate (draft-only preserved).** `resolveVariationProfile`
is the single chokepoint, applied **per manifest row** so a batch may mix
front- and double-sided designs. `front_sided` is always usable (default,
existing behavior). Any other key is usable only when the hub has synced a
**complete** definition with offerings — so before the double_sided matrix is
synced, and for unknown keys, the row **fails validation before any Etsy
write**, both in `/api/batches/validate` (surfaced as a per-store error) and as
a hard guard immediately before `createDraftListing`. There is **no fallback
from `double_sided` to `front_sided`**. SKU reservation, duplicate-draft
protection, images, title/description/keywords, and store Etsy IDs are untouched.

**Matrix application (both profiles).** Once a profile is synced with offerings,
`buildProfileInventoryProducts` builds the full Etsy inventory grid from its own
prices and `updateListingInventory` applies it after the draft is created (the
same code path for `front_sided` and `double_sided`, keyed by the resolved
profile):

- **All 392 products are sent** — Etsy requires a product for *every*
  combination of the two variation values; the 188 offered combos are
  `is_enabled: true` at their Style-tier price, the 204 unavailable combos are
  `is_enabled: false` (carrying the Style tier price so Etsy accepts them).
- Price varies by Style tier (`price_on_property: [styleProperty]`); quantity is
  uniform 999 (`quantity_on_property: []`); SKUs are unique per combination,
  derived from the manifest SKU (**SKU reservation unchanged**).
- **Property IDs** come from the Hub **Variations panel** (`variation1PropertyId`
  = Style axis, `variation2PropertyId` = Primary color) — reused, not
  duplicated. Set them to your real listing's property IDs; if unset, the
  matrix step reports a clear error and the draft is still created.
- **Graceful:** the draft is created first, so if the inventory call fails (e.g.
  Etsy rejects the combination count) the row is still `created` with
  `variationInventoryStatus: "failed"` and the reason — no corruption, no
  duplicate. Before the profiles are synced, `front_sided` falls back to the
  existing variation behavior (no regression); `double_sided` is rejected until
  synced (never falls back).

> **Live-confirm item:** Etsy requires all 392 products, above the legacy
> 100-combination cap (the profile path allows up to 500). Whether Etsy's v3
> `updateListingInventory` accepts 392 in one call could not be verified offline
> (no live writes) — confirm it in the one-design live E2E run. It fails
> gracefully if not.

**After deploying, run "Sync now"** so Batchly stores the synced
`variationProfiles` (now including the complete `double_sided` matrix); until
then `front_sided` uses the existing behavior and `double_sided` is (correctly)
rejected as not-yet-configured. The Style + Primary-color **property IDs** in
the Hub Variations panel must be set for the matrix step to run (either
profile).

### Ready Mockups (Preply, stamp-only)

A second Preply workflow at **`/ready-mockups`** (linked from Preply's nav and
the Hub's Preply card, which SSOs straight in). Operators upload finished
mockups (images or a ZIP), stamp every included store logo onto every mockup,
and download one ZIP laid out as `<Store name>/<original mockup filename>`.

- **Isolated by design:** it never touches batches, the SKU ledger,
  `stores.json`, or Google Drive (covered by `preply/tests/ready-stamp.test.mjs`).
  Mockups never leave the browser; compositing and the ZIP happen client-side at
  full resolution, keeping each mockup's format (JPEG q0.95 / PNG / WebP).
- **Server state:** only the logo library and the team's default placement, via
  `/api/ready-stamp/*` (session-authenticated), stored durably in `preply_state`.
  Logos can be uploaded or imported in one click from Store Settings; the
  browser downscales (≤1600px) and trims transparent padding first.
- **Placement** reuses the batch Stamp step's normalized model (center + box as
  fractions of the mockup, rotation) plus an **anchor**, so wide and square logos
  sit the same distance from the edge. Per-mockup overrides are tab-only.
- No new env vars or migrations — the new keys land in the existing table.

## 2. Env var matrix

Everything URL/secret-shaped in the codebase now comes from env vars. Nothing
is hardcoded to `localhost`.

### Shared (set on **every** service that verifies the cookie)

| Var | Purpose |
|---|---|
| `INQUEUE_SESSION_SECRET` | HMAC key for the session cookie. **Must be identical everywhere.** 32+ bytes hex. |
| `INQUEUE_HUB_URL`        | Where each app redirects unauthenticated requests. Public HTTPS hub URL in prod. |
| `NODE_ENV`               | `production` on Render (so `Secure` cookie flag is set). |

### `inqueue-web` (hub) only

| Var | Purpose |
|---|---|
| `PORT`                   | Render sets this automatically. |
| `INQUEUE_USERNAME`       | Sign-in username. |
| `INQUEUE_PASSWORD_HASH`  | PBKDF2 hash — see `.env.example` for the generator. |
| `INKLY_BASE_URL`         | Public Inkly URL, used by the dashboard's tool links + `/config.js`. |
| `PREPLY_BASE_URL`        | Public Preply URL. Also the target for store-config sync + Drive test/infer proxies. |
| `BATCHLY_BASE_URL`       | Public Batchly URL. Also used by the dashboard summary aggregator, store-config sync, and the Etsy test-connection proxy. |
| `INQUEUE_DATABASE_URL`   | **Required in prod.** Postgres connection string for the hub's store-config storage (Render managed Postgres). When unset (dev only) the hub falls back to a local JSON file; the production guardrails fail closed on a missing/localhost/`file:` value. Migrations in `migrations/*.sql` run at boot under a `pg_advisory_lock`. |

### Store-config flag (set on Preply AND Batchly, not the hub)

| Var | Purpose |
|---|---|
| `INQUEUE_STORE_CONFIG_SOURCE` | `local` (default) — the tool keeps its own store config; hub sync requests run in **dry-run** mode and only report a field diff. `hub` — hub-pushed configuration is applied (Preply: through `saveStores()` into `stores.json` with a timestamped backup; Batchly: Prisma upserts into `Store`/`StoreEtsyIds`/`Global*Preset`). Flip per tool ONLY after the empty-diff check in `docs/plans/store-config-hub-plan.md` (§ Sync protocol → flip runbook). |

### `inqueue-inkly`

| Var | Purpose |
|---|---|
| `PORT`                   | Render sets. |
| `OPENAI_API_KEY`         | Design generation. |
| `DESIGN_QA`              | `on` (default) — every AI-generated design is vision-reviewed against a hard rubric (exact spelling, no covered/clipped letters, no stray text, clean composition) before it is saved; failures regenerate with feedback, then error out instead of being presented. `off` disables. |
| `DESIGN_QA_MAX_ATTEMPTS` | Generation attempts before a design is rejected (default `3`, max `5`). Each attempt is one image-model call plus one QA call. |
| `OPENAI_QA_MODEL`        | Vision model for the QA review. Defaults to `OPENAI_TEXT_MODEL`, then `gpt-4o`. |
| `STYLE_REFERENCE_DIR`    | Folder of committed reference design PNGs/JPGs (default `inkly/style-references/`). When non-empty, up to 2 random references steer each generation's quality bar via `images.edit`; their text/subject/layout is never copied. |
| `INKLY_DESIGN_CONCURRENCY` | Designs generated in parallel across all jobs/users (default `3`, max `6`). Replaces the removed `INKLY_GENERATION_LANES`. |
| `INKLY_COMPOSE_CONCURRENCY` | Concurrent memory-heavy finishing pipelines (default `1`). Raise only with well over 512 MB RAM. |
| `OPENAI_TIMEOUT_MS`      | Per-request OpenAI timeout (default `180000`) so a hung call can't pin a generation slot. |
| `OPENAI_IMAGE_QUALITY`   | `high` (recommended for print). `medium` roughly halves per-image time/cost. |
| `PHOTOROOM_API_KEY`      | Background removal. |
| `REPLICATE_API_TOKEN`    | Upscaling. |
| `REMOVEBG_API_KEY`       | Alt background removal. |
| `DEFAULT_CANVAS_WIDTH` / `_HEIGHT` / `EXPORT_DPI` | Optional canvas overrides. |

### `inqueue-preply`

| Var | Purpose |
|---|---|
| `PORT`                   | Render sets. |
| `PREPLY_DATABASE_URL`    | **Strongly recommended in prod.** Postgres for Preply's durable state (stores, batches, settings, SKU ledger, mockup presets, Google Drive refresh token, Drive export report). Write-through on every save, re-hydrated onto disk at boot — with this set, **no persistent disk is required**. May point at the same Render Postgres as the hub's `INQUEUE_DATABASE_URL`; the `preply_state` table is namespaced. |
| `PREPLY_DATA_DIR`        | Path to the state directory (see §4). Defaults to `./data`. Without `PREPLY_DATABASE_URL` this must be a mounted persistent disk or state is lost on deploy. |
| `GOOGLE_DRIVE_AUTH_MODE` | `oauth` in prod (service accounts hit MyDrive quota, see audit). |
| `GOOGLE_OAUTH_CLIENT_ID` / `_CLIENT_SECRET` | OAuth app credentials. Required for SKU **uploads** into a personal My Drive. |
| `GOOGLE_OAUTH_REDIRECT_URI` | **Must match** the URL added to the Google Cloud Console OAuth app. Prod: `https://preply.inqueue.io/api/drive/oauth/callback`. |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Path to the service-account key. On Render, upload the JSON as a **Secret File** and point this at it (e.g. `/etc/secrets/google-service-account.json`). The key file is gitignored and must never be committed. |
| `PREPLY_BATCHLY_HANDOFF_MODE` | `drive` (recommended in prod): export uploads server→Drive pending-batches folder, **no browser ZIP is built**, and Preply pings Batchly to auto-scan the new batch (zero manual steps). `local` (dev default) = ZIP download only. `both` = Drive upload + ZIP backup. |
| `PREPLY_PENDING_BATCHES_FOLDER_ID` | Drive folder Batchly scans for incoming batches. Required for `drive`/`both`. |
| `BATCHLY_BASE_URL` | Public Batchly URL — target of the post-export auto-scan ping (short-lived service token, aud=batchly). Required for the hands-free handoff. |

**Drive credentials and the hub's folder test.** The Configure tab's "Test access" and
"Scan folder for prefix" are **read-only** (`files.get` + one page of `files.list`) and are
proxied to Preply, which owns the Drive client. Reads work with *either* credential, so
Preply falls back to the service account when OAuth isn't configured (and vice versa) —
only *uploads* are credential-sensitive, because a service account has no My Drive storage
quota. Consequently, to make the folder test work you need **one** of:

- **Service account** (simplest, read-only is enough): set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`
  on **inqueue-preply**, then share the store's Drive folder with the key's `client_email`
  (Viewer suffices).
- **OAuth user** (also required for real SKU uploads): set `GOOGLE_DRIVE_AUTH_MODE=oauth`,
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` on
  **inqueue-preply**, then visit Preply → Settings → Connect Google Drive once so the
  refresh token is stored on the persistent disk.

If neither is present, the folder test returns `DRIVE_NOT_CONFIGURED` and the Configure tab
prints the exact variables to set on which service — it never silently reports success.

**Do not confuse `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` (Preply) with `GOOGLE_CLIENT_ID`/`_SECRET`
(Batchly).** They are different env var names for different Google Cloud OAuth clients on
different services — Preply's `loadOAuthClientConfig()` (`preply/server.js`) reads only
`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`; it does **not** fall back to
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Setting the Batchly-style names on the Preply
service produces exactly the "OAuth client is not configured" error seen in production —
Preply's Drive OAuth client silently has no credentials even though env vars named
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are present.

### `inqueue-batchly`

| Var | Purpose |
|---|---|
| `PORT`                   | Render sets. |
| `NEXT_PUBLIC_BASE_URL`   | Public Batchly URL. Used by Etsy + Google OAuth callback redirects. |
| `NEXT_PUBLIC_INQUEUE_HUB_URL` | Public hub URL (client-safe — this is a plain URL, not a secret). Powers the sidebar hub link and the logout button. |
| `DATABASE_URL`           | Postgres connection string (see §3). |
| `GOOGLE_CLIENT_ID` / `_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Drive OAuth. Redirect URI is `${NEXT_PUBLIC_BASE_URL}/api/auth/google/callback`. |
| `GOOGLE_DRIVE_PENDING_FOLDER_ID` | Drive folder Batchly scans for incoming batches. |
| `ETSY_CLIENT_ID` / `_CLIENT_SECRET` / `ETSY_REDIRECT_URI` / `ETSY_SCOPES` | Etsy PKCE. Redirect URI is `${NEXT_PUBLIC_BASE_URL}/api/auth/etsy/callback`. |

### Listing images (`inqueue-batchly`)

| Var | Purpose |
|---|---|
| `ETSY_MAX_LISTING_IMAGES` | Per-listing image cap (default `20`, Etsy's current limit; set `10` for legacy-capped shops). Mockups are capped at **cap − 3**: three slots are always reserved so the size charts are the final images of every listing and can never be squeezed out. An Etsy "image limit" rejection during upload is treated as a warning with a config hint, never a row failure. |

### OAuth redirect URIs to update in provider consoles

Before flipping traffic:

- **Google Cloud Console → OAuth 2.0 Client** (Preply):
  - Add `https://preply.inqueue.io/api/drive/oauth/callback`
- **Google Cloud Console → OAuth 2.0 Client** (Batchly):
  - Add `https://batchly.inqueue.io/api/auth/google/callback`
- **Etsy Developer → App → Callback URLs**:
  - Add `https://batchly.inqueue.io/api/auth/etsy/callback`

Leave the localhost URIs in place — they still work in dev.

## 3. Postgres migration for Batchly

Batchly runs on Postgres everywhere — the Prisma datasource is
`postgresql` + `env("DATABASE_URL")` for local dev, tests, and Render alike.
SQLite is retired.

### Why — the concrete risk

`DraftCreationRecord.@@unique([storeId, batchFolder, designId])` is
the **only line of defense against duplicate Etsy drafts on retry**. On
Render's ephemeral disk, a SQLite `dev.db` disappears on every deploy →
duplicate protection resets → a re-run of a batch after a deploy would create
a second live draft for every design. Postgres is not optional.

### Migration status: DONE in code

The datasource switch has landed: `batchly/prisma/schema.prisma` is
`provider = "postgresql"` with `url = env("DATABASE_URL")`, and
`prisma/migrations/` holds a single Postgres baseline
(`20260711000000_init_postgres`) whose `DraftCreationRecord` unique index was
verified against a live Postgres 16 (duplicate insert throws; app boots;
`tsc`/`next build` clean; all batchly test suites pass).

What remains is Render-side only:

1. Provision a Render Postgres instance. Capture the `DATABASE_URL`.
2. Set `DATABASE_URL` on the Batchly service.
3. Deploy build command: `npx prisma migrate deploy && npm run build`.
   Start command: `npm start`.
4. Post-deploy job (once): `npx prisma db seed` — creates the Store_A..H rows
   (or just run "Sync now" from the hub, which upserts Store_A..F).
5. Reconnect Etsy per store and Batchly's Google Drive once — tokens from the
   SQLite era do not carry over.
6. **Do not** `prisma migrate reset` against the Render Postgres — that wipes
   `DraftCreationRecord` and re-opens the duplicate window.

### Local dev after the switch

Local dev now needs a local PostgreSQL too (SQLite is gone):

```
brew install postgresql@16 && brew services start postgresql@16
createdb batchly_dev
# batchly/.env.local: DATABASE_URL="postgresql://localhost:5432/batchly_dev"
npx prisma migrate deploy && npx prisma db seed
```

The test suites read the same `DATABASE_URL`. The old SQLite migrations are
archived locally in `prisma/migrations.sqlite-archived/` (gitignored — never
apply them to Postgres); an existing `dev.db` stays on disk untouched but is
no longer read.

### Fallback

If Postgres is temporarily unavailable, do not fall back to SQLite in
production — pause the queue. Silent drift between "prod SQLite that resets
on deploy" and "prod Postgres that persists" is exactly the failure mode
`DraftCreationRecord` exists to prevent.

## 3b. Database backup & 30-day expiry (free tier)

**The risk:** all three services share ONE Render Postgres (hub store config,
Preply durable state incl. the Google Drive refresh token, Batchly's schema
incl. Etsy tokens and the duplicate-draft history). Render's FREE Postgres is
**deleted ~30 days after creation** — when it goes, the whole suite reverts to
factory settings and every OAuth connection is lost.

**Countdown warning:** copy the expiry date from the Render database page into
`INQUEUE_DB_EXPIRES_AT` on the hub (e.g. `2026-08-10`). The hub's Connections
view then warns at 14 days and errors at 7 / after expiry. Leaving it unset
produces a standing "expiry unknown" warning on purpose.

**Weekly backup (one command, covers everything):**

```bash
scripts/backup-inqueue-db.sh "<EXTERNAL connection string from Render>"
```

Dumps to `~/inqueue-backups/inqueue-<timestamp>.sql.gz`, keeps the last 12.
Automate weekly via `crontab -e`:

```
0 9 * * 1  DATABASE_URL='postgres://...' /path/to/inQueue/scripts/backup-inqueue-db.sh
```

**Restore / migration runbook (expiry approaching or already hit):**
1. Take a final backup (above) while the old DB still exists.
2. Render → New → PostgreSQL (free) → copy its EXTERNAL connection string.
3. `gunzip -c ~/inqueue-backups/inqueue-<latest>.sql.gz | psql '<new-external-url>'`
4. Update env vars: hub `INQUEUE_DATABASE_URL`, Preply `PREPLY_DATABASE_URL`,
   Batchly `DATABASE_URL` (all → the new INTERNAL connection string), and hub
   `INQUEUE_DB_EXPIRES_AT` (new expiry date).
5. Redeploy hub, Preply, Batchly.
6. Verify: hub Configure shows Store_A intact; Batchly stores still show Etsy
   connected; Preply Drive chip still Connected. Tokens live in the DB, so a
   successful restore needs **no** re-authentication; if a token was minted
   between backup and expiry, reconnect that one service.

## 4. Persistent storage strategy

Ephemeral disk on Render loses everything on deploy/restart. Every path below
is currently in this repo; the second column says what has to survive.

**No-disk mode (preferred):** with `PREPLY_DATABASE_URL` set, every
load-bearing Preply JSON file below is write-through mirrored into a
`preply_state` Postgres table and re-hydrated onto disk at boot
(`preply/stateStore.js`), and Batchly's Google refresh token + Etsy PKCE state
live in its database (`AppSetting` rows) instead of `.tokens/`. In that setup
the only rows still requiring a disk are regenerable caches — losing them on a
deploy costs a re-download/re-export, never state. The disk mounts at the end
of this section become an optional optimization, not a requirement.

Batchly's Prisma datasource is now Postgres (§3), so once Render's
`DATABASE_URL` points at managed Postgres, Batchly is fully disk-free: Etsy
tokens, the Google Drive token, PKCE state, and the `DraftCreationRecord`
dedup guard all live in the database.

| Path                                     | Kind of data                          | Destination                          | Notes |
|------------------------------------------|---------------------------------------|--------------------------------------|-------|
| `preply/data/stores.json`                | Store configuration (Store_A…H, SKU prefix, Drive folder ID, active flag, logo path). **Load-bearing.** | **Postgres (`preply_state`)** or persistent disk | Never regenerate from code; represents operator setup. DB-backed when `PREPLY_DATABASE_URL` is set. |
| `preply/data/batches.json`               | Batch state per SKU. **Load-bearing.** | **Postgres (`preply_state`)** or persistent disk | Concurrent-write safety is handled in `writeJsonFile` (atomic rename). |
| `preply/data/sku-ledger.json`            | SKU commit log — cross-batch dedup.   | **Postgres (`preply_state`)** or persistent disk | Loss = duplicate SKU risk. |
| `preply/data/mockup-presets.json`        | Mockup preset selections.             | **Postgres (`preply_state`)** or persistent disk | |
| `preply/data/settings.json`              | App settings.                         | **Postgres (`preply_state`)** or persistent disk | |
| `preply/data/google-oauth-token.json`    | Google Drive refresh token.           | **Postgres (`preply_state`)** or persistent disk | DB-backed when `PREPLY_DATABASE_URL` is set. |
| `preply/data/ready-stamp-logos.json`     | Ready Mockups logo library (store name + logo image, base64). | **Postgres (`preply_state`)** or persistent disk | Browser downscales logos to ≤1600px before upload; server caps 30 logos / 4 MB each / 40 MB total. |
| `preply/data/ready-stamp-settings.json`  | Ready Mockups default logo placement + anchor. | **Postgres (`preply_state`)** or persistent disk | Team-shared default; per-mockup overrides live only in the browser tab. |
| `preply/data/source-designs/<batchId>/*.png` | Cached source PNGs during Drive export. | **Persistent disk**              | Needed for retry-Drive-uploads flow. Prune-on-complete already implemented. |
| `preply/data/mock-drive/`                | Local mock adapter output.            | Not deployed to Render               | `GOOGLE_DRIVE_AUTH_MODE=oauth` in prod bypasses this. |
| `preply/logs/drive_export_report.json`   | Latest Drive export outcome.          | **Postgres (`preply_state`)** or persistent disk | Referenced by the UI for retry decisions. |
| `inkly/storage/uploads/`                 | Uploaded reference images.            | Persistent disk (small)              | Old ones can be pruned. |
| `inkly/storage/outputs/<jobId>/…`        | Generated designs pre-batch.          | Persistent disk (medium)             | Retained so the user can review + include in a batch. |
| `batchly/workspace/downloads/<batch>/…`  | Downloaded Drive batches.             | Persistent disk (large)              | Re-downloadable from Drive if lost, but retrying is faster with the local copy. |
| `batchly/workspace/supplemental-images/` | Size charts, promo images.            | **Persistent disk**                  | Operator-supplied, not code-generated. |
| `batchly/.tokens/google.json`            | Google Drive refresh token (Batchly). | **Database (`AppSetting` row)**      | No longer written; a legacy file is imported once, then only the DB row is used. |
| `batchly/.tokens/etsy-pkce-*.json`       | Ephemeral PKCE state.                 | **Database (`AppSetting` rows)**     | No longer written to disk; rows expire after 15 min and are swept on write. |
| `batchly/prisma/dev.db*`                 | Legacy SQLite database (no longer read). | **Postgres** (see §3)             | The datasource is Postgres everywhere now; delete the file whenever. |

### Render persistent disk mounts

Per-service, minimum viable. **With `PREPLY_DATABASE_URL` set, the Preply
disk is optional** — only the source-designs retry cache is lost on deploy
(re-export recreates it). The Batchly `.tokens` mount is obsolete (tokens are
DB rows now); its `workspace` mount only speeds up retries.

- `inqueue-preply` → 1 GB at `/opt/render/project/src/preply/data`
  (or set `PREPLY_DATA_DIR` to a mounted path and skip touching the tree layout).
  Also mount `preply/logs/` — a 100 MB disk is plenty. Optional when
  `PREPLY_DATABASE_URL` is set.
- `inqueue-inkly` → 5 GB at `.../inkly/storage`. Generated PNGs at
  4500×5400 add up; size grows with usage. Add a monthly prune job later.
- `inqueue-batchly` → 5 GB at `.../batchly/workspace` (optional — downloads
  are re-fetchable from Drive). The `.tokens` mount is no longer needed.
- `inqueue-web` → no disk needed once we stop reading `preply/data/stores.json`
  directly (the hub dashboard summary should hit Preply's HTTP API instead).
  Interim: the hub reads `preply/data/stores.json` locally, which means the
  hub and Preply must share a filesystem — that only works in the "one
  hostname" topology. Track this as a Phase 2 follow-up.

## 5. Follow-ups that fall out of Phase 2

Recorded here so they don't get lost:

1. **Hub → Preply store data via HTTP, not the filesystem.** Root `server.js`
   still `fs.readFileSync`s `preply/data/stores.json`. Replace with a fetch
   against `${PREPLY_BASE_URL}/api/stores` (the endpoint exists) so the hub
   doesn't need Preply's disk.
2. **Cross-origin login is solved by SSO** (see §1 "one-login SSO"). A
   parent-domain `Domain=` cookie is **not** needed and must never point at
   `.onrender.com`. If we later move to a real apex we control, a host-only vs.
   `Domain=.inqueue.io` cookie is an optional optimization, not a requirement.
3. **Reverse-proxy consolidation.** Wrap Inkly + Preply as sub-apps under one
   Express gateway so we can collapse to `inqueue-web` + `inqueue-batchly`.
4. **Provider console redirect URIs.** Update Google + Etsy before flipping
   DNS. Test each callback in staging first.
5. **Token storage hardening.** Move Preply and Batchly refresh tokens off
   disk into an encrypted store or the Postgres DB.

## 6. What is explicitly not part of Phase 2

- No Render services are actually created.
- No Postgres instance is provisioned; schema is not switched.
- No OAuth redirect URIs are added in Google/Etsy consoles.
- No commits/pushes to remote.
- No Etsy draft creation, no Drive writes, no `stores.json` mutations.
