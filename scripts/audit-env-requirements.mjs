// Prints the env vars each inQueue Render service needs, per current code
// (not guesses — see docs/deployment.md and each service's productionGuardrails
// module for the source of truth this list mirrors).
//
//   node scripts/audit-env-requirements.mjs                 # all services
//   node scripts/audit-env-requirements.mjs preply           # one service
//   node scripts/audit-env-requirements.mjs --check          # also read
//                                                              process.env and
//                                                              mark set/missing
//                                                              (prints only
//                                                              whether a var is
//                                                              set — never its
//                                                              value)
//
// Safe by design: this script never reads .env/.env.local files, never prints
// an env var's value, and requires no real env values to run.

const SERVICES = {
  hub: {
    label: 'inqueue-web (hub, repo-root server.js)',
    vars: [
      ['INQUEUE_SESSION_SECRET', 'required', 'secret', '32+ char hex. Must be IDENTICAL on hub, Preply, Batchly, Inkly.'],
      ['INQUEUE_HUB_URL', 'required', 'public-url', "This service's own public HTTPS URL (used to build absolute SSO/redirect links back to itself)."],
      ['INKLY_BASE_URL', 'required', 'public-url', 'Public Inkly URL — dashboard links + /config.js.'],
      ['PREPLY_BASE_URL', 'required', 'public-url', 'Public Preply URL — dashboard links, config-sync target, Drive test/infer proxy target.'],
      ['BATCHLY_BASE_URL', 'required', 'public-url', 'Public Batchly URL — dashboard links, config-sync target, Etsy test-connection proxy target.'],
      ['INQUEUE_USERNAME', 'required', 'secret', 'Hub login username.'],
      ['INQUEUE_PASSWORD_HASH', 'required (prod)', 'secret', 'PBKDF2 hash: pbkdf2$<iters>$<saltHex>$<hashHex>. Falls back to plaintext INQUEUE_PASSWORD in dev only.'],
      ['INQUEUE_PASSWORD', 'optional (dev only)', 'secret', 'Plaintext password fallback. Guardrails flag this as an error in production.'],
      ['INQUEUE_DATABASE_URL', 'required (prod)', 'secret', 'Postgres connection string for hub store-config storage. Falls back to data/store-config.json in dev; guardrails fail closed on missing/localhost/file: in prod.'],
      ['INQUEUE_STORE_CONFIG_FILE', 'optional (dev/test)', 'public', 'Overrides the JSON-file store-config path. Ignored once INQUEUE_DATABASE_URL is set.'],
      ['INQUEUE_DB_EXPIRES_AT', 'strongly recommended (free tier)', 'public', 'Expiry date of the free Render Postgres (from its dashboard page). Hub warns at 14 days, errors at 7. Backup: scripts/backup-inqueue-db.sh.'],
      ['NODE_ENV', 'required (prod)', 'public', '"production" on Render — controls the Secure cookie flag and guardrail checks.'],
      ['INQUEUE_ENV', 'optional', 'public', 'Alternate production flag; treated as equivalent to NODE_ENV=production.'],
      ['PORT', 'set by Render', 'public', 'Render injects this automatically.'],
    ],
  },
  preply: {
    label: 'inqueue-preply (preply/server.js)',
    vars: [
      ['INQUEUE_SESSION_SECRET', 'required', 'secret', 'Must match the hub exactly — verifies the shared SSO session cookie and internal service tokens.'],
      ['INQUEUE_HUB_URL', 'required', 'public-url', 'Public hub URL — unauthenticated visitors are redirected here.'],
      ['INQUEUE_ENV', 'optional', 'public', 'Alternate production flag (with NODE_ENV) for guardrails.'],
      ['NODE_ENV', 'required (prod)', 'public', '"production" on Render.'],
      ['INQUEUE_STORE_CONFIG_SOURCE', 'optional', 'public', '"local" (default, safe) = hub sync runs dry-run only. "hub" = hub-pushed config is applied to stores.json. Flip only after the empty-diff check in docs/plans/store-config-hub-plan.md.'],
      ['PREPLY_DATABASE_URL', 'strongly recommended (prod)', 'secret', "Postgres for Preply's durable state (stores/batches/settings/SKU ledger/Drive refresh token): write-through on save, re-hydrated at boot, so no persistent disk is needed. May be the same Postgres instance as the hub's INQUEUE_DATABASE_URL (table is namespaced: preply_state). Unset = disk-only; state is lost on deploy unless a disk is mounted."],
      ['GOOGLE_DRIVE_AUTH_MODE', 'required (prod)', 'public', '"oauth" | "service_account" | "mock" (default mock). Use "oauth" in prod — service accounts cannot upload into a personal My Drive folder (storageQuotaExceeded).'],
      ['GOOGLE_OAUTH_CLIENT_ID', 'required for oauth mode', 'secret', "Preply's OWN Google OAuth client id. NOT the same var name Batchly uses (GOOGLE_CLIENT_ID) — do not confuse the two."],
      ['GOOGLE_OAUTH_CLIENT_SECRET', 'required for oauth mode', 'secret', "Preply's OWN Google OAuth client secret. NOT GOOGLE_CLIENT_SECRET."],
      ['GOOGLE_OAUTH_REDIRECT_URI', 'required for oauth mode', 'public-url', 'Must exactly match the URI registered in Google Cloud Console. Prod: https://<preply-host>/api/drive/oauth/callback.'],
      ['GOOGLE_SERVICE_ACCOUNT_KEY_PATH', 'required for service_account mode (or as read-only fallback)', 'secret (file path)', 'Path to the service-account JSON key (Render Secret File). Defaults to ./google-service-account.json. Read-only folder test/infer-prefix falls back to this credential if OAuth is not configured, and vice versa.'],
      ['PREPLY_DATA_DIR', 'optional', 'public', 'Persistent-disk path for stores.json etc. Defaults to ./data — MUST be a mounted disk in prod or state is lost on every deploy.'],
      ['PREPLY_BATCHLY_DOWNLOADS_DIR', 'optional', 'public', 'Local handoff directory when PREPLY_BATCHLY_HANDOFF_MODE=local.'],
      ['PREPLY_BATCHLY_HANDOFF_MODE', 'optional', 'public', '"local" (dev default) | "drive" (Render/prod) | "both" (transitional).'],
      ['PREPLY_PENDING_BATCHES_FOLDER_ID', 'required when handoff mode is drive/both', 'public', 'Drive folder Batchly scans for incoming Preply batches; must be shared with the active Drive credential.'],
      ['BATCHLY_BASE_URL', 'optional', 'public-url', "Batchly URL for the post-export auto-scan ping (service token, aud=batchly) and links. Required for hands-free handoff."],
      ['PORT', 'set by Render', 'public', 'Render injects this automatically.'],
    ],
  },
  batchly: {
    label: 'inqueue-batchly (batchly/, Next.js)',
    vars: [
      ['INQUEUE_SESSION_SECRET', 'required', 'secret', 'Must match the hub exactly (Edge middleware + Node routes both verify with this).'],
      ['INQUEUE_HUB_URL', 'required', 'public-url', 'Server-side: SSO redirects, Etsy-return-to-hub redirects, config-sync origin trust.'],
      ['NEXT_PUBLIC_INQUEUE_HUB_URL', 'required', 'public-url', 'Client-side: sidebar hub link + logout button. Distinct from INQUEUE_HUB_URL because it must be baked into the client bundle (NEXT_PUBLIC_ prefix) — set BOTH to the same value.'],
      ['NEXT_PUBLIC_BASE_URL', 'required', 'public-url', "Batchly's OWN public URL. Used to build Etsy/Google OAuth callback redirects. Must be an https URL in prod, not localhost."],
      ['INQUEUE_ENV', 'optional', 'public', 'Alternate production flag (with NODE_ENV) for guardrails.'],
      ['NODE_ENV', 'required (prod)', 'public', '"production" on Render.'],
      ['INQUEUE_STORE_CONFIG_SOURCE', 'optional', 'public', '"local" (default, safe) = hub sync runs dry-run and reports diff only. "hub" = hub-pushed config is applied via Prisma upserts. Flip only after the empty-diff check.'],
      ['DATABASE_URL', 'required (always)', 'secret', "Batchly's OWN Postgres connection string (separate database from the hub's INQUEUE_DATABASE_URL). The Prisma datasource is postgresql everywhere — SQLite is retired; local dev needs a local PostgreSQL too."],
      ['ETSY_CLIENT_ID', 'required', 'secret', 'Etsy developer app client id.'],
      ['ETSY_MAX_LISTING_IMAGES', 'optional', 'public', 'Per-listing image cap. Defaults to 20; set 10 if the shop/API tier still enforces the old cap. 3 slots are always reserved for size charts.'],
      ['ETSY_CLIENT_SECRET', 'optional', 'secret', 'Listed for completeness; Etsy API v3 PKCE does not use a client secret for token exchange.'],
      ['ETSY_REDIRECT_URI', 'required (prod)', 'public-url', 'Must be registered in the Etsy developer portal AND match ${NEXT_PUBLIC_BASE_URL}/api/auth/etsy/callback exactly. Localhost value in prod is a guardrail error.'],
      ['ETSY_SCOPES', 'optional', 'public', 'Defaults to "shops_r listings_r listings_w".'],
      ['GOOGLE_CLIENT_ID', 'required', 'secret', "Batchly's OWN Google OAuth client id (Drive import broker). NOT the same purpose as Preply's GOOGLE_OAUTH_CLIENT_ID — different service, different Google Cloud OAuth client."],
      ['GOOGLE_CLIENT_SECRET', 'required', 'secret', "Batchly's OWN Google OAuth client secret."],
      ['GOOGLE_REDIRECT_URI', 'required (prod)', 'public-url', 'Must be registered in Google Cloud Console AND match ${NEXT_PUBLIC_BASE_URL}/api/auth/google/callback. Localhost value in prod is a guardrail error.'],
      ['GOOGLE_DRIVE_PENDING_FOLDER_ID', 'required', 'public', 'Drive folder Batchly scans for incoming Preply batches.'],
      ['PORT', 'set by Render', 'public', 'Render injects this automatically.'],
    ],
  },
  inkly: {
    label: 'inqueue-inkly (inkly/server.js) — not part of the Store Configuration Hub flows, included for completeness',
    vars: [
      ['INQUEUE_HUB_URL', 'required', 'public-url', 'Unauthenticated redirect target.'],
      ['OPENAI_API_KEY', 'required', 'secret', 'Design generation.'],
      ['OPENAI_TEXT_MODEL', 'optional', 'public', 'Defaults to gpt-4o.'],
      ['OPENAI_IMAGE_MODEL', 'optional', 'public', 'Defaults to gpt-image-1.'],
      ['OPENAI_IMAGE_SIZE', 'optional', 'public', 'Defaults to 1024x1536.'],
      ['OPENAI_IMAGE_QUALITY', 'optional', 'public', 'No default — omitted from the request if unset. "medium" is the speed/cost knob.'],
      ['OPENAI_TIMEOUT_MS', 'optional', 'public', 'Per-request OpenAI timeout. Defaults to 180000 (3 min).'],
      ['INKLY_DESIGN_CONCURRENCY', 'optional', 'public', 'Designs generated in parallel across all jobs. Defaults to 3 (max 6). Replaces INKLY_GENERATION_LANES.'],
      ['INKLY_COMPOSE_CONCURRENCY', 'optional', 'public', 'Concurrent memory-heavy finishing pipelines. Defaults to 1 — raise only with >512MB RAM.'],
      ['DESIGN_QA', 'optional', 'public', 'Defaults to "on": vision QA review gates every AI-generated design; "off" disables.'],
      ['DESIGN_QA_MAX_ATTEMPTS', 'optional', 'public', 'Generation attempts before a design is rejected. Defaults to 3 (max 5).'],
      ['OPENAI_QA_MODEL', 'optional', 'public', 'QA vision model; defaults to OPENAI_TEXT_MODEL, then gpt-4o.'],
      ['STYLE_REFERENCE_DIR', 'optional', 'public', 'Quality-bar reference designs folder; defaults to inkly/style-references.'],
      ['USE_PLACEHOLDER_IMAGES', 'optional (dev)', 'public', '"true" skips real image generation calls.'],
      ['PHOTOROOM_API_KEY', 'optional', 'secret', 'Background removal provider.'],
      ['REMOVEBG_API_KEY', 'optional', 'secret', 'Alt background removal provider.'],
      ['REPLICATE_API_TOKEN', 'optional', 'secret', 'Upscaling; also requires UPSCALE_PROVIDER=replicate.'],
      ['UPSCALE_PROVIDER', 'optional', 'public', 'Set to "replicate" to enable Replicate-based upscaling.'],
      ['UPSCALE_MODEL', 'optional', 'public', 'Defaults to nightmareai/real-esrgan.'],
      ['UPSCALE_TARGET_LONG_EDGE', 'optional', 'public', 'Defaults to 4200.'],
      ['DEFAULT_CANVAS_WIDTH', 'optional', 'public', 'Defaults to 4500.'],
      ['DEFAULT_CANVAS_HEIGHT', 'optional', 'public', 'Defaults to 5400.'],
      ['EXPORT_DPI', 'optional', 'public', 'Defaults to 300.'],
      ['DESIGN_CHROMA_COLOR', 'optional', 'public', 'Defaults to #FF00FF.'],
      ['DESIGN_CHROMA_THRESHOLD', 'optional', 'public', 'Defaults to 65.'],
      ['DESIGN_CHROMA_FEATHER', 'optional', 'public', 'Defaults to 30.'],
      ['DESIGN_EDGE_BG_THRESHOLD', 'optional', 'public', 'Defaults to 36.'],
      ['DESIGN_CLEANUP_MAX_SIZE', 'optional', 'public', 'Defaults to 2048.'],
      ['PORT', 'set by Render', 'public', 'Render injects this automatically.'],
    ],
  },
};

const NOTE = 'Note: no service reads INQUEUE_SERVICE_TOKEN_SECRET — internal hub-to-tool service tokens (lib/serviceAuth.js / batchly/src/lib/sso.ts verifyServiceToken) are HMAC-signed with the SAME shared INQUEUE_SESSION_SECRET as the SSO session cookie. Do not add a separate token secret.';

function printService(key, checkEnv) {
  const svc = SERVICES[key];
  if (!svc) {
    console.error(`Unknown service "${key}". Known: ${Object.keys(SERVICES).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n=== ${key} — ${svc.label} ===`);
  for (const [name, requirement, kind, note] of svc.vars) {
    let status = '';
    if (checkEnv) {
      const isSet = typeof process.env[name] === 'string' && process.env[name].length > 0;
      status = isSet ? '  [SET]' : '  [MISSING]';
    }
    console.log(`  ${name}${status}`);
    console.log(`    requirement: ${requirement}  |  kind: ${kind}`);
    console.log(`    ${note}`);
  }
}

const args = process.argv.slice(2);
const checkEnv = args.includes('--check');
const serviceArgs = args.filter((a) => a !== '--check');

if (serviceArgs.length === 0) {
  for (const key of Object.keys(SERVICES)) printService(key, checkEnv);
  console.log(`\n${NOTE}\n`);
} else {
  for (const key of serviceArgs) printService(key, checkEnv);
  console.log(`\n${NOTE}\n`);
}
