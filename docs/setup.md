# inQueue

Multi-tool Etsy/POD draft-listing automation. Four apps under one monorepo:

```
inQueue/
├── server.js         Hub — login, dashboard, cross-tool aggregation (port 4000)
├── public/           Hub UI
├── lib/              Shared auth library + tests
├── inkly/            Design generation → ready-batch ZIP        (port 5500)
├── preply/           Mockup production → Batchly-ready ZIP      (port 3001)
└── batchly/          Drive → Etsy draft listings (Next.js)      (port 3030)
```

Workflow: **Inkly → Preply → Batchly → Etsy Draft Listings**.

## Local setup

Node 20+ recommended.

```bash
# 1. Install per-app deps
npm  install
cd inkly  && npm install && cd ..
cd preply && npm install && cd ..
cd batchly && npm install && cd ..

# 2. Copy env templates and fill in secrets
cp .env.example .env.local                 # hub — shared auth secrets
cp inkly/.env.example  inkly/.env          # OpenAI + PhotoRoom + Replicate keys
cp preply/.env.example preply/.env.local   # Google Drive OAuth mode
cp batchly/.env.example batchly/.env.local # Google OAuth + Etsy OAuth

# 3. Batchly DB
cd batchly
npx prisma migrate deploy
npx prisma db seed
cd ..

# 4. Run the four services (four terminals, or a launcher)
node server.js                              # hub    → :4000
cd inkly  && npm run dev                    # inkly  → :5500
cd preply && npm start                      # preply → :3001
cd batchly && npm run dev -- --port 3030    # batchly → :3030
```

Open <http://localhost:4000> and sign in. All four tools share one session
cookie — a single login unlocks the hub, Inkly, Preply, and Batchly.

## Auth (Phase 1A)

Every request to any app is gated by a shared HMAC-signed session cookie
(`inqueue_session`, HttpOnly, SameSite=Lax, 12h TTL). See
[lib/auth.js](../lib/auth.js) and [batchly/src/middleware.ts](../batchly/src/middleware.ts).

Required env vars (set on **every** app that verifies the cookie):

| Var | Where | Purpose |
|---|---|---|
| `INQUEUE_USERNAME`     | hub only | Sign-in username |
| `INQUEUE_PASSWORD_HASH`| hub only | PBKDF2 hash — see `.env.example` for generator |
| `INQUEUE_SESSION_SECRET` | hub, Inkly, Preply, Batchly | Same value everywhere so cookies verify |
| `INQUEUE_HUB_URL`      | Inkly, Preply, Batchly | Where each app redirects unauth requests (default `http://localhost:4000`) |
| `NEXT_PUBLIC_INQUEUE_HUB_URL` | Batchly | Client-visible hub URL for its logout button |
| `BATCHLY_BASE_URL`     | hub only | Where the dashboard aggregator polls Batchly |

Generate a PBKDF2 password hash:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16);\
const h=c.pbkdf2Sync('YOUR_PASSWORD',s,100000,32,'sha256');\
console.log('pbkdf2\$100000\$'+s.toString('hex')+'\$'+h.toString('hex'))"
```

Verify auth is enforced:

```bash
node lib/auth.test.mjs            # unit
node lib/auth-http.test.mjs       # hub HTTP integration (hub must be running)
node lib/direct-tools-auth.test.mjs   # all four apps (all four must be running)
```

## What NOT to commit

Every one of these is gitignored — do not add exceptions:

- `.env`, `.env.local`, `.env.*` (any file with an actual secret in it)
- `*service-account*.json`, `google-oauth-client.json`
- `.tokens/`, `data/google-oauth-token.json`, `etsy-pkce-*.json`, `google.json`
- Any `*.db` (Batchly's SQLite dev.db)
- `inkly/storage/`, `preply/data/`, `preply/logs/`, `batchly/workspace/`
- `test-results/`, `playwright-report/`, `*.bak`, `*.zip`

If `git status` shows one of these staged, stop and fix `.gitignore` — do **not**
commit through it.

## Ports & topology

| Port | Service | Framework |
|---|---|---|
| 4000 | hub / login | plain Node http |
| 5500 | Inkly       | Express |
| 3001 | Preply      | plain Node http |
| 3030 | Batchly     | Next.js 14 (App Router) |

Cookies on `localhost` are per-host, not per-port, so one sign-in on `:4000`
covers all four. In production this needs either one hostname with a reverse
proxy or a shared parent-domain cookie — see the Render notes below.

## Render deployment (future — Phase 2)

Not deploying yet. Notes for when we do:

- **Two services:** `inqueue-web` bundling hub + Inkly + Preply behind one
  Express gateway (so the auth cookie stays on one hostname), and `batchly`
  as a Next.js standalone deploy.
- **Postgres for Batchly** — swap Prisma `provider = "sqlite"` → `"postgresql"`
  and set `DATABASE_URL`. SQLite on Render's ephemeral disk loses
  `DraftCreationRecord` duplicate-protection history on every deploy.
- **Persistent disk** for `preply/data/` and `inkly/storage/`.
- **Env vars** — the full inQueue set above, plus OpenAI/PhotoRoom/Replicate
  (Inkly), Google OAuth + Drive pending-folder ID (Preply/Batchly), Etsy
  OAuth (Batchly). Google/Etsy OAuth consoles need production redirect URIs
  added.
- **Cookie domain:** either a single hostname or `Domain=.yourdomain.com` on
  the session cookie so all services see it.
- **Token storage:** move Preply's `data/google-oauth-token.json` and
  Batchly's `.tokens/google.json` onto the persistent disk (Preply) or into
  Postgres (Batchly).

## Safety rules

- Etsy listings must always be **Draft only**, never Active.
- `NorthWindUS` must remain **Store_A** in `preply/data/stores.json`.
- Multi-store listing must route each store to the correct Etsy account.
- Store folder mappings must remain deterministic.
- SKU assignment must be store-specific and never duplicate.
