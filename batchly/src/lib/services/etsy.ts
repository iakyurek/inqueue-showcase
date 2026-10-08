import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_BASE = "https://openapi.etsy.com/v3";

// ---------------------------------------------------------------------------
// Phase 4: retry / rate-limit / ambiguous-failure infrastructure
// ---------------------------------------------------------------------------
//
// All Etsy HTTP goes through etsyFetch(). Behavior depends on `idempotent`:
//
//   idempotent: true   — safe to retry on 429/5xx/network. Examples: GETs
//                        (taxonomy, listings, inventory read), PUT /inventory
//                        (last-write-wins), image upload with overwrite=true.
//   idempotent: false  — retry ONLY on 429 (the server explicitly rejected
//                        the request before any state change). On 5xx or a
//                        network error mid-flight, throw an ETSY_AMBIGUOUS
//                        error so the caller can reconcile (search Etsy for
//                        the draft that may have been created) instead of
//                        blindly creating a second one.
//
// 429 always honors Retry-After when present, else exponential backoff.
// A per-store mutex prevents concurrent refreshAccessToken calls from
// racing on Etsy's refresh-token rotation.

/** Retryable status codes. 500 is included, but non-idempotent 500s throw
 *  AMBIGUOUS rather than retry (Etsy may have created the resource before
 *  the response failed). */
const ETSY_RETRY_STATUSES = new Set<number>([429, 500, 502, 503, 504]);
const ETSY_MAX_RETRIES_DEFAULT = 3;
const ETSY_BASE_DELAY_MS = 500;
const ETSY_MAX_DELAY_MS = 8000;

export type EtsyAmbiguousReason = "server_5xx" | "network_error";

/** Thrown when a non-idempotent Etsy request may or may not have created a
 *  resource server-side. Caller must reconcile before retrying. */
export class EtsyAmbiguousError extends Error {
  reason: EtsyAmbiguousReason;
  status: number | null;
  attempt: number;
  constructor(reason: EtsyAmbiguousReason, message: string, status: number | null, attempt: number) {
    super(message);
    this.name = "EtsyAmbiguousError";
    this.reason = reason;
    this.status = status;
    this.attempt = attempt;
  }
}

// Test seams: allow the suite to replace fetch and the sleep clock so retry
// timings don't turn tests into real waits. Never used in production paths.
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
let _fetchImpl: FetchLike = ((input, init) => fetch(input as string, init)) as FetchLike;
let _sleepImpl: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
export function __setEtsyFetchForTests(f: FetchLike): void { _fetchImpl = f; }
export function __resetEtsyFetchForTests(): void {
  _fetchImpl = ((input, init) => fetch(input as string, init)) as FetchLike;
}
export function __setEtsySleepForTests(f: (ms: number) => Promise<void>): void { _sleepImpl = f; }
export function __resetEtsySleepForTests(): void {
  _sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 60_000));
  return null;
}

function backoffMs(attempt: number): number {
  // Exponential with full jitter, capped.
  const cap = Math.min(ETSY_MAX_DELAY_MS, ETSY_BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

export interface EtsyFetchOptions {
  /** True for GET / PUT / image-upload-with-overwrite. Defaults to false. */
  idempotent?: boolean;
  /** Debug tag surfaced in logs (e.g. "createDraftListing"). */
  op?: string;
  maxRetries?: number;
}

/** Central Etsy HTTP wrapper. See file header for the retry contract. */
// Process-wide pacing: Etsy allows 5 req/s per app key. Reactive 429 handling
// alone let three simultaneous operators collide and stall on retry backoffs;
// spacing request STARTS 250ms apart keeps the whole process at 4/s with
// headroom, shared fairly across concurrent runs.
const ETSY_MIN_REQUEST_GAP_MS = (() => {
  const n = Number(process.env.ETSY_MIN_REQUEST_GAP_MS);
  return Number.isFinite(n) && n >= 0 ? n : 250;
})();
let nextEtsyRequestSlot = 0;
async function acquireEtsyRequestSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextEtsyRequestSlot);
  nextEtsyRequestSlot = slot + ETSY_MIN_REQUEST_GAP_MS;
  if (slot > now) await _sleepImpl(slot - now);
}

export async function etsyFetch(
  url: string,
  init: RequestInit,
  options: EtsyFetchOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? ETSY_MAX_RETRIES_DEFAULT;
  const idempotent = options.idempotent === true;
  const op = options.op ?? "etsyFetch";
  let attempt = 0;

  while (true) {
    let res: Response;
    try {
      await acquireEtsyRequestSlot();
      res = await _fetchImpl(url, init);
    } catch (err) {
      // Network / abort. For idempotent ops, retry until budget exhausted.
      // For non-idempotent ops, the request may have partially reached
      // Etsy — signal AMBIGUOUS immediately so the caller can reconcile.
      if (!idempotent) {
        throw new EtsyAmbiguousError(
          "network_error",
          `[${op}] network error (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`,
          null,
          attempt + 1,
        );
      }
      if (attempt >= maxRetries) throw err;
      const delay = backoffMs(attempt);
      console.warn(`[${op}] network error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await _sleepImpl(delay);
      attempt += 1;
      continue;
    }

    if (!ETSY_RETRY_STATUSES.has(res.status)) return res;

    // 429 is always the server rejecting BEFORE processing — safe to retry
    // even for non-idempotent ops. 5xx is not safe for non-idempotent ops.
    const is429 = res.status === 429;
    if (!is429 && !idempotent) {
      throw new EtsyAmbiguousError(
        "server_5xx",
        `[${op}] Etsy returned ${res.status} on a non-idempotent request; the resource may have been created.`,
        res.status,
        attempt + 1,
      );
    }

    if (attempt >= maxRetries) {
      // Ran out of retries on a retryable status — surface the last response
      // to the caller; the calling code already interprets non-OK.
      console.warn(`[${op}] Etsy ${res.status} after ${maxRetries} retries; giving up.`);
      return res;
    }

    const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
    const delay = retryAfter ?? backoffMs(attempt);
    console.warn(`[${op}] Etsy ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
    await _sleepImpl(delay);
    attempt += 1;
  }
}

// ---------------------------------------------------------------------------
// Phase 4: per-store token-refresh mutex — prevents two concurrent refreshes
// from racing on Etsy's rotated refresh_token (Etsy returns a new
// refresh_token on each success; a stale write would orphan the connection).
// ---------------------------------------------------------------------------
const _refreshInFlight = new Map<string, Promise<string>>();

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// PKCE state file I/O
// ---------------------------------------------------------------------------

interface PkceState {
  storeId: string;
  codeVerifier: string;
  // Canonical Store_X slot, so the callback can report the outcome back to the
  // hub in the hub's own vocabulary (the hub never sees Batchly cuids).
  storeFolder?: string;
  // Where to send the browser after the callback. Only the literal sentinel
  // "hub" is ever stored (the actual URL is resolved from INQUEUE_HUB_URL at
  // redirect time) — no caller-supplied URL is ever persisted or followed,
  // which is what keeps this flow free of open redirects.
  returnTo?: "hub";
}

// PKCE state lives in the AppSetting key/value table (not on disk) so the
// flow works on Render without a persistent disk. Keys are prefixed and
// expire after PKCE_STATE_TTL_MS — writes opportunistically sweep abandoned
// states so the table cannot grow unbounded.
const PKCE_SETTING_PREFIX = "etsyPkce:";
const PKCE_STATE_TTL_MS = 15 * 60 * 1000;

function pkceSettingKey(state: string): string {
  return `${PKCE_SETTING_PREFIX}${state}`;
}

export async function writePkceState(state: string, data: PkceState): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: {
      key: { startsWith: PKCE_SETTING_PREFIX },
      updatedAt: { lt: new Date(Date.now() - PKCE_STATE_TTL_MS) },
    },
  });
  await prisma.appSetting.upsert({
    where: { key: pkceSettingKey(state) },
    create: { key: pkceSettingKey(state), value: JSON.stringify(data) },
    update: { value: JSON.stringify(data) },
  });
}

export async function readPkceState(state: string): Promise<PkceState | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: pkceSettingKey(state) } });
  if (!row) return null;
  if (row.updatedAt.getTime() < Date.now() - PKCE_STATE_TTL_MS) {
    await deletePkceState(state);
    return null;
  }
  try {
    return JSON.parse(row.value) as PkceState;
  } catch {
    return null;
  }
}

export async function deletePkceState(state: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: pkceSettingKey(state) } });
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  const clientId = process.env.ETSY_CLIENT_ID;
  const redirectUri = process.env.ETSY_REDIRECT_URI ?? "http://localhost:3030/api/auth/etsy/callback";
  const scopes = process.env.ETSY_SCOPES ?? "shops_r listings_r listings_w";

  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://www.etsy.com/oauth/connect?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface EtsyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  user_id: number;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<EtsyTokenResponse> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const redirectUri = process.env.ETSY_REDIRECT_URI ?? "http://localhost:3030/api/auth/etsy/callback";

  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code,
    code_verifier: codeVerifier,
  });

  const res = await etsyFetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, { idempotent: true, op: "exchangeCodeForTokens" });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`TOKEN_EXCHANGE_FAILED: ${text}`);
  }

  return res.json() as Promise<EtsyTokenResponse>;
}

// ---------------------------------------------------------------------------
// Shop identity — two-step: users/me → shops/{shopId}
// ---------------------------------------------------------------------------

export interface EtsyShopInfo {
  shopId: string;
  shopName: string;
}

export async function fetchShopIdentity(
  accessToken: string,
): Promise<EtsyShopInfo | null> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) return null;

  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;
  const authHeaders = {
    "x-api-key": apiKey,
    "Authorization": `Bearer ${accessToken}`,
  };

  // Step 1: GET /application/users/me — get user_id and shop_id
  const meEndpoint = `${ETSY_API_BASE}/application/users/me`;
  console.log(`[etsy] fetchShopIdentity → GET ${meEndpoint}`);

  const meRes = await etsyFetch(meEndpoint, { headers: authHeaders }, { idempotent: true, op: "fetchShopIdentity users/me" });
  console.log(`[etsy] fetchShopIdentity ← users/me HTTP ${meRes.status}`);

  if (!meRes.ok) {
    const body = await meRes.text().catch(() => "(unreadable)");
    console.error(`[etsy] fetchShopIdentity users/me failed — status ${meRes.status} — body: ${body}`);
    return null;
  }

  const meData = await meRes.json() as {
    user_id?: number;
    shop_id?: number;
    shop?: { shop_id?: number; shop_name?: string };
  };

  // shop_id may be top-level or nested under shop
  const rawShopId = meData.shop_id ?? meData.shop?.shop_id;

  if (!rawShopId) {
    console.warn(
      `[etsy] fetchShopIdentity — no shop_id in users/me response` +
      (meData.user_id ? ` (user_id=${meData.user_id})` : ""),
    );
    return null;
  }

  console.log(`[etsy] fetchShopIdentity — shop_id found: ${rawShopId}`);

  // If users/me already includes the shop name, use it directly
  if (meData.shop?.shop_name) {
    console.log(`[etsy] fetchShopIdentity — shop name from users/me: ${meData.shop.shop_name}`);
    return { shopId: String(rawShopId), shopName: meData.shop.shop_name };
  }

  // Step 2: GET /application/shops/{shopId} — get shop_name
  const shopEndpoint = `${ETSY_API_BASE}/application/shops/${rawShopId}`;
  console.log(`[etsy] fetchShopIdentity → GET ${shopEndpoint}`);

  const shopRes = await etsyFetch(shopEndpoint, { headers: authHeaders }, { idempotent: true, op: "fetchShopIdentity shops/{id}" });
  console.log(`[etsy] fetchShopIdentity ← shops/${rawShopId} HTTP ${shopRes.status}`);

  if (!shopRes.ok) {
    const body = await shopRes.text().catch(() => "(unreadable)");
    console.warn(
      `[etsy] fetchShopIdentity shops/${rawShopId} failed — status ${shopRes.status} — body: ${body}`,
    );
    // shop_id is known; fall back to a generated name so etsyShopId still saves
    console.log(`[etsy] fetchShopIdentity — saving shop_id=${rawShopId} with fallback name`);
    return { shopId: String(rawShopId), shopName: `Shop ${rawShopId}` };
  }

  const shopData = await shopRes.json() as { shop_id?: number; shop_name?: string };

  if (!shopData.shop_name) {
    console.warn(`[etsy] fetchShopIdentity — shop_name missing for shop_id=${rawShopId}, using fallback`);
    return { shopId: String(rawShopId), shopName: `Shop ${rawShopId}` };
  }

  console.log(`[etsy] fetchShopIdentity — shop confirmed: id=${rawShopId} name=${shopData.shop_name}`);
  return { shopId: String(rawShopId), shopName: shopData.shop_name };
}

// ---------------------------------------------------------------------------
// Store tokens in DB
// ---------------------------------------------------------------------------

export async function saveEtsyTokens(
  storeId: string,
  tokens: EtsyTokenResponse,
  shop: EtsyShopInfo | null,
): Promise<void> {
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.store.update({
    where: { id: storeId },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt,
      etsyShopId: shop?.shopId ?? null,
      etsyShopName: shop?.shopName ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(storeId: string): Promise<string> {
  // Per-store mutex: if a refresh is already running for this store, wait on
  // that promise. Etsy rotates refresh_token on every refresh and a
  // concurrent stale write would orphan the connection.
  const pending = _refreshInFlight.get(storeId);
  if (pending) return pending;

  const run = _refreshAccessTokenLocked(storeId).finally(() => {
    _refreshInFlight.delete(storeId);
  });
  _refreshInFlight.set(storeId, run);
  return run;
}

async function _refreshAccessTokenLocked(storeId: string): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId } });
  if (!store?.refreshToken) throw new Error("NOT_CONNECTED");

  // Return existing token if still valid (with 60s buffer)
  if (store.accessToken && store.tokenExpiresAt) {
    const bufferMs = 60 * 1000;
    if (store.tokenExpiresAt.getTime() - bufferMs > Date.now()) {
      return store.accessToken;
    }
  }

  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: store.refreshToken,
  });

  // Idempotent from Etsy's perspective — either the request succeeds and we
  // get a new access_token, or it fails without any user-visible side effect.
  const res = await etsyFetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, { idempotent: true, op: "refreshAccessToken" });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`REFRESH_FAILED: ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await prisma.store.update({
    where: { id: storeId },
    data: {
      accessToken: data.access_token,
      tokenExpiresAt,
      ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
    },
  });

  return data.access_token;
}

// ---------------------------------------------------------------------------
// Connection check
// ---------------------------------------------------------------------------

export async function isStoreConnected(storeId: string): Promise<boolean> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { refreshToken: true },
  });
  return !!(store?.refreshToken);
}

// ---------------------------------------------------------------------------
// Seller taxonomy (Phase 6A helper — no OAuth required, API key only)
// ---------------------------------------------------------------------------

interface TaxonomyNode {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  children?: TaxonomyNode[];
}

export interface EtsyTaxonomyResult {
  id: number;
  name: string;
  level: number;
  parent_id: number | null;
  path: string;
}

export async function fetchSellerTaxonomyNodes(): Promise<TaxonomyNode[]> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;
  const endpoint = `${ETSY_API_BASE}/application/seller-taxonomy/nodes`;

  const res = await etsyFetch(endpoint, {
    headers: { "x-api-key": apiKey },
  }, { idempotent: true, op: "fetchSellerTaxonomyNodes" });

  console.log(`[etsy/fetchSellerTaxonomy] GET ${endpoint} → HTTP ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/fetchSellerTaxonomy] failed — body: ${body}`);
    throw new Error(`ETSY_TAXONOMY_ERROR: ${res.status}`);
  }

  const data = await res.json() as { results?: TaxonomyNode[] };
  return data.results ?? [];
}

function collectMatches(
  nodes: TaxonomyNode[],
  queryLower: string,
  pathSoFar: string,
  out: EtsyTaxonomyResult[],
  limit: number,
): void {
  for (const node of nodes) {
    if (out.length >= limit) return;
    const currentPath = pathSoFar ? `${pathSoFar} > ${node.name}` : node.name;
    if (node.name.toLowerCase().includes(queryLower)) {
      out.push({
        id: node.id,
        name: node.name,
        level: node.level,
        parent_id: node.parent_id,
        path: currentPath,
      });
    }
    if (node.children?.length) {
      collectMatches(node.children, queryLower, currentPath, out, limit);
    }
  }
}

export async function searchSellerTaxonomy(
  query: string,
  maxResults = 40,
): Promise<EtsyTaxonomyResult[]> {
  const nodes = await fetchSellerTaxonomyNodes();
  const results: EtsyTaxonomyResult[] = [];
  collectMatches(nodes, query.toLowerCase().trim(), "", results, maxResults);
  console.log(`[etsy/searchSellerTaxonomy] query="${query}" → ${results.length} results`);
  return results;
}

// ---------------------------------------------------------------------------
// Store A config helpers — read-only ID fetching (Phase 6A helper)
// ---------------------------------------------------------------------------

export interface EtsyShippingProfile {
  shipping_profile_id: number;
  title: string;
  min_processing_time: number;
  max_processing_time: number;
  processing_time_unit: string;
}

export interface EtsyShopSection {
  shop_section_id: number;
  title: string;
  rank: number;
  active_listing_count: number;
}

export interface EtsyReturnPolicy {
  return_policy_id: number;
  accepts_returns: boolean;
  accepts_exchanges: boolean;
  return_deadline?: number | null;
}

export interface EtsyStoreConfig {
  shippingProfiles: EtsyShippingProfile[];
  sections: EtsyShopSection[];
  returnPolicies: EtsyReturnPolicy[] | null;
  returnPoliciesNote: string | null;
  readinessNote: string;
}

async function etsyGet<T>(
  endpoint: string,
  accessToken: string,
): Promise<{ ok: boolean; status: number; data: T | null; body: string }> {
  const clientId = process.env.ETSY_CLIENT_ID ?? "";
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const res = await etsyFetch(`${ETSY_API_BASE}${endpoint}`, {
    headers: {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${accessToken}`,
    },
  }, { idempotent: true, op: `GET ${endpoint}` });

  const body = await res.text().catch(() => "(unreadable)");
  if (!res.ok) return { ok: false, status: res.status, data: null, body };

  try {
    return { ok: true, status: res.status, data: JSON.parse(body) as T, body };
  } catch {
    return { ok: false, status: res.status, data: null, body };
  }
}

export async function fetchStoreConfig(storeId: string): Promise<EtsyStoreConfig> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const shopId = store.etsyShopId;

  // Shipping profiles
  const spRes = await etsyGet<{ results?: EtsyShippingProfile[] }>(
    `/application/shops/${shopId}/shipping-profiles`,
    accessToken,
  );
  console.log(`[etsy/fetchStoreConfig] shipping-profiles HTTP ${spRes.status}`);
  if (!spRes.ok) {
    console.warn(`[etsy/fetchStoreConfig] shipping-profiles failed — body: ${spRes.body}`);
  }
  const shippingProfiles = spRes.data?.results ?? [];
  console.log(`[etsy/fetchStoreConfig] shipping profiles found: ${shippingProfiles.length}`);

  // Shop sections
  const secRes = await etsyGet<{ results?: EtsyShopSection[] }>(
    `/application/shops/${shopId}/sections`,
    accessToken,
  );
  console.log(`[etsy/fetchStoreConfig] sections HTTP ${secRes.status}`);
  if (!secRes.ok) {
    console.warn(`[etsy/fetchStoreConfig] sections failed — body: ${secRes.body}`);
  }
  const sections = secRes.data?.results ?? [];
  console.log(`[etsy/fetchStoreConfig] sections found: ${sections.length}`);

  // Return policies
  const rpRes = await etsyGet<{ results?: EtsyReturnPolicy[] }>(
    `/application/shops/${shopId}/return-policies`,
    accessToken,
  );
  console.log(`[etsy/fetchStoreConfig] return-policies HTTP ${rpRes.status}`);
  let returnPolicies: EtsyReturnPolicy[] | null = null;
  let returnPoliciesNote: string | null = null;
  if (rpRes.ok) {
    returnPolicies = rpRes.data?.results ?? [];
    console.log(`[etsy/fetchStoreConfig] return policies found: ${returnPolicies.length}`);
  } else if (rpRes.status === 404 || rpRes.status === 501) {
    returnPoliciesNote = "Return policies endpoint not available for this shop.";
    console.warn(`[etsy/fetchStoreConfig] return-policies not available (${rpRes.status})`);
  } else {
    returnPoliciesNote = `Return policies fetch failed (HTTP ${rpRes.status}).`;
    console.warn(`[etsy/fetchStoreConfig] return-policies error — body: ${rpRes.body}`);
  }

  return {
    shippingProfiles,
    sections,
    returnPolicies,
    returnPoliciesNote,
    readinessNote:
      "Use the Find or Create Made-to-Order Processing Profile button to get the readiness_state_id. " +
      "If one already exists on Etsy it will be returned automatically.",
  };
}

// ---------------------------------------------------------------------------
// Readiness profile helpers (Phase 6A / 7A)
// ---------------------------------------------------------------------------

export interface EtsyReadinessProfile {
  readiness_state_id: number;
  readiness_state: string;
  min_processing_time: number;
  max_processing_time: number;
  processing_time_unit: string;
}

export interface EtsyReadinessProfileResult {
  profile: EtsyReadinessProfile;
  found: boolean;
}

// Lists existing readiness-state-definitions for the shop.
export async function listReadinessProfiles(
  storeId: string,
): Promise<EtsyReadinessProfile[]> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const endpoint = `/application/shops/${store.etsyShopId}/readiness-state-definitions`;
  console.log(`[etsy/listReadinessProfiles] storeName=${store.name} etsyShopId=${store.etsyShopId} → GET ${ETSY_API_BASE}${endpoint}`);

  const res = await etsyGet<Record<string, unknown>>(endpoint, accessToken);
  console.log(`[etsy/listReadinessProfiles] HTTP ${res.status}`);

  if (!res.ok || !res.data) {
    console.warn(`[etsy/listReadinessProfiles] failed — body: ${res.body}`);
    return [];
  }

  // Etsy may return { results: [...] } or a flat array or a single object
  const data = res.data;
  let items: unknown[] = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (Array.isArray((data as { results?: unknown }).results)) {
    items = (data as { results: unknown[] }).results;
  } else if (typeof data.readiness_state_id !== "undefined") {
    items = [data];
  }

  const profiles: EtsyReadinessProfile[] = items
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      readiness_state_id: Number(item.readiness_state_id ?? (item as { id?: unknown }).id ?? 0),
      readiness_state: String(item.readiness_state ?? ""),
      min_processing_time: Number(item.min_processing_time ?? 0),
      max_processing_time: Number(item.max_processing_time ?? 0),
      processing_time_unit: String(item.processing_time_unit ?? "days"),
    }))
    .filter((p) => p.readiness_state_id > 0);

  console.log(`[etsy/listReadinessProfiles] found ${profiles.length} profile(s)`);
  return profiles;
}

// Finds an existing made-to-order profile or creates one. Never errors on 409.
export async function findOrCreateMadeToOrderReadinessProfile(
  storeId: string,
  minDays: number,
  maxDays: number,
): Promise<EtsyReadinessProfileResult> {
  // First, try to list existing profiles and return a matching one
  try {
    const existing = await listReadinessProfiles(storeId);
    const match = existing.find((p) => p.readiness_state === "made_to_order");
    if (match) {
      console.log(`[etsy/findOrCreateReadinessProfile] found existing made_to_order profile — readiness_state_id=${match.readiness_state_id}`);
      return { profile: match, found: true };
    }
  } catch {
    // If list fails, fall through to create
  }

  // Not found — create it
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/shops/${store.etsyShopId}/readiness-state-definitions`;
  console.log(`[etsy/findOrCreateReadinessProfile] storeName=${store.name} etsyShopId=${store.etsyShopId} → POST ${endpoint}`);

  const params = new URLSearchParams();
  params.set("readiness_state", "made_to_order");
  params.set("min_processing_time", String(minDays));
  params.set("max_processing_time", String(maxDays));
  params.set("processing_time_unit", "days");

  // POST that creates a readiness profile — non-idempotent, but Etsy returns
  // 409 on duplicate and the calling code handles that. Only retry on 429.
  const res = await etsyFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": apiKey,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: params.toString(),
  }, { idempotent: false, op: "createReadinessProfile" });

  console.log(`[etsy/findOrCreateReadinessProfile] POST HTTP ${res.status}`);
  const body = await res.text().catch(() => "(unreadable)");

  // 409 means one already exists — list and find it
  if (res.status === 409) {
    console.log(`[etsy/findOrCreateReadinessProfile] 409 conflict — fetching existing profiles`);
    const existing = await listReadinessProfiles(storeId);
    const match = existing.find((p) => p.readiness_state === "made_to_order");
    if (match) {
      console.log(`[etsy/findOrCreateReadinessProfile] recovered existing profile — readiness_state_id=${match.readiness_state_id}`);
      return { profile: match, found: true };
    }
    throw Object.assign(
      new Error("ETSY_API_ERROR: 409 — existing profile not recoverable via list"),
      { etsyBody: body },
    );
  }

  if (!res.ok) {
    console.error(`[etsy/findOrCreateReadinessProfile] failed — status ${res.status} — body: ${body}`);
    throw Object.assign(new Error(`ETSY_API_ERROR: ${res.status}`), { etsyBody: body });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("ETSY_INVALID_JSON");
  }

  const id = data.readiness_state_id ?? (data as { id?: unknown }).id;
  if (!id) {
    console.error(`[etsy/findOrCreateReadinessProfile] response missing readiness_state_id — body: ${body}`);
    throw new Error("ETSY_MISSING_READINESS_STATE_ID");
  }

  const profile: EtsyReadinessProfile = {
    readiness_state_id: Number(id),
    readiness_state: String(data.readiness_state ?? "made_to_order"),
    min_processing_time: Number(data.min_processing_time ?? minDays),
    max_processing_time: Number(data.max_processing_time ?? maxDays),
    processing_time_unit: String(data.processing_time_unit ?? "days"),
  };
  console.log(`[etsy/findOrCreateReadinessProfile] profile created — readiness_state_id=${profile.readiness_state_id}`);
  return { profile, found: false };
}

// ---------------------------------------------------------------------------
// Draft listing creation (Phase 6A)
// ---------------------------------------------------------------------------

export interface EtsyDraftListingPayload {
  title: string;
  description: string;
  price: number;
  quantity: number;
  who_made: string;
  when_made: string;
  taxonomy_id: number;
  readiness_state_id?: number;
  shipping_profile_id?: number;
  tags?: string[];
  listing_type?: string;
  materials?: string[];
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
}

export interface EtsyDraftListingResult {
  listingId: string;
  title: string;
  url: string;
}

export async function createDraftListing(
  storeId: string,
  payload: EtsyDraftListingPayload,
): Promise<EtsyDraftListingResult> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });

  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/shops/${store.etsyShopId}/listings`;
  console.log(`[etsy/createDraftListing] storeName=${store.name} etsyShopId=${store.etsyShopId} → POST ${endpoint}`);

  const params = new URLSearchParams();
  params.set("quantity", String(payload.quantity));
  params.set("title", payload.title);
  params.set("description", payload.description);
  params.set("price", String(payload.price));
  params.set("who_made", payload.who_made);
  params.set("when_made", payload.when_made);
  params.set("taxonomy_id", String(payload.taxonomy_id));
  if (payload.readiness_state_id !== undefined) {
    params.set("readiness_state_id", String(payload.readiness_state_id));
  }
  if (payload.shipping_profile_id !== undefined) {
    params.set("shipping_profile_id", String(payload.shipping_profile_id));
  }
  if (payload.listing_type) params.set("type", payload.listing_type);
  payload.tags?.forEach((tag) => params.append("tags[]", tag));
  payload.materials?.forEach((m) => params.append("materials[]", m));
  if (payload.item_weight !== undefined) params.set("item_weight", String(payload.item_weight));
  if (payload.item_weight_unit) params.set("item_weight_unit", payload.item_weight_unit);
  if (payload.item_length !== undefined) params.set("item_length", String(payload.item_length));
  if (payload.item_width !== undefined) params.set("item_width", String(payload.item_width));
  if (payload.item_height !== undefined) params.set("item_height", String(payload.item_height));
  if (payload.item_dimensions_unit) params.set("item_dimensions_unit", payload.item_dimensions_unit);

  const sentKeys: string[] = [
    "quantity", "title", "description", "price", "who_made", "when_made", "taxonomy_id",
    ...(payload.readiness_state_id !== undefined ? ["readiness_state_id"] : []),
    ...(payload.shipping_profile_id !== undefined ? ["shipping_profile_id"] : []),
    ...(payload.listing_type ? ["type"] : []),
    ...(payload.tags?.length ? [`tags[](×${payload.tags.length})`] : []),
    ...(payload.materials?.length ? [`materials[](×${payload.materials.length})`] : []),
    ...(payload.item_weight !== undefined ? ["item_weight", "item_weight_unit"] : []),
    ...(payload.item_length !== undefined ? ["item_length", "item_width", "item_height", "item_dimensions_unit"] : []),
  ];
  console.log(`[etsy/createDraftListing] payload keys: ${sentKeys.join(", ")}`);

  // Non-idempotent — createDraftListing is the money-critical path where a
  // blind retry can create a duplicate draft. etsyFetch will throw
  // EtsyAmbiguousError on 5xx or network mid-flight; the caller reconciles
  // by searching the shop's drafts before deciding whether to retry.
  const res = await etsyFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": apiKey,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: params.toString(),
  }, { idempotent: false, op: "createDraftListing" });

  console.log(`[etsy/createDraftListing] Etsy API responded HTTP ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/createDraftListing] failed — status ${res.status} — body: ${body}`);
    throw Object.assign(
      new Error(`ETSY_API_ERROR: ${res.status} — ${body.slice(0, 600)}`),
      { etsyStatus: res.status, etsyBody: body },
    );
  }

  const data = await res.json() as { listing_id?: number; title?: string; url?: string };

  if (!data.listing_id) {
    console.error("[etsy/createDraftListing] response missing listing_id");
    throw new Error("ETSY_MISSING_LISTING_ID");
  }

  const listingId = String(data.listing_id);
  console.log(`[etsy/createDraftListing] draft created — etsyListingId=${listingId}`);

  return {
    listingId,
    title: data.title ?? payload.title,
    url: data.url ?? `https://www.etsy.com/listing/${listingId}`,
  };
}

// ---------------------------------------------------------------------------
// Listing image upload (Phase 6D)
// ---------------------------------------------------------------------------

export interface EtsyImageUploadResult {
  listingImageId: string;
  rank: number;
  url: string;
}

export async function uploadListingImage(
  storeId: string,
  listingId: string,
  imagePath: string,
  rank: number,
): Promise<EtsyImageUploadResult> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const fsModule = await import("fs");
  const pathModule = await import("path");
  const buffer = fsModule.readFileSync(imagePath);
  const ext = pathModule.extname(imagePath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  const basename = pathModule.basename(imagePath);

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const form = new FormData();
  form.append("image", blob, basename);
  form.append("rank", String(rank));
  form.append("overwrite", "true");

  const endpoint = `${ETSY_API_BASE}/application/shops/${store.etsyShopId}/listings/${listingId}/images`;
  console.log(
    `[etsy/uploadListingImage] shopId=${store.etsyShopId} listingId=${listingId} rank=${rank} file=${basename}`,
  );

  // Image upload is idempotent because we set overwrite=true above — a retry
  // that succeeds after a partial upload just replaces the previous attempt.
  const res = await etsyFetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: form,
  }, { idempotent: true, op: `uploadListingImage rank=${rank}` });

  console.log(`[etsy/uploadListingImage] HTTP ${res.status} for file=${basename}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/uploadListingImage] failed rank=${rank} file=${basename} — status ${res.status}`);
    throw Object.assign(new Error(`ETSY_IMAGE_UPLOAD_FAILED: ${res.status}`), { etsyBody: body });
  }

  const data = await res.json() as {
    listing_image_id?: number;
    rank?: number;
    url_570xN?: string;
    url_fullxfull?: string;
  };

  const listingImageId = String(data.listing_image_id ?? "");
  const returnedUrl = data.url_570xN ?? data.url_fullxfull ?? "";
  const returnedRank = data.rank ?? rank;

  console.log(`[etsy/uploadListingImage] uploaded — listingImageId=${listingImageId} rank=${returnedRank}`);

  return { listingImageId, rank: returnedRank, url: returnedUrl };
}

// ---------------------------------------------------------------------------
// Read-only listing QA helpers (Phase 7D) — GET only, no mutations
// ---------------------------------------------------------------------------

export interface EtsyListingDetails {
  listingId: string;
  state: string;
  title: string;
  descriptionLength: number;
  descriptionFirstLine: string;
  price: number | null;
  quantity: number | null;
  taxonomyId: number | null;
  shippingProfileId: number | null;
  tags: string[];
  tagCount: number;
  hasReadinessProfile: boolean;
  materials: string[];
  itemWeight: number | null;
  itemWeightUnit: string | null;
  itemLength: number | null;
  itemWidth: number | null;
  itemHeight: number | null;
  itemDimensionsUnit: string | null;
}

export interface EtsyListingImagesResult {
  imageCount: number;
  ranks: number[];
}

export interface EtsyListingInventoryResult {
  inventoryProductCount: number;
  hasVariations: boolean;
  propertyNames: string[];
  productSkus: string[];
}

export async function getListingDetails(
  storeId: string,
  listingId: string,
): Promise<EtsyListingDetails> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/listings/${listingId}`;
  console.log(`[etsy/getListingDetails] storeId=${storeId} listingId=${listingId}`);

  const res = await etsyFetch(endpoint, {
    headers: { "x-api-key": apiKey, "Authorization": `Bearer ${accessToken}` },
  }, { idempotent: true, op: `GET ${endpoint}` });
  console.log(`[etsy/getListingDetails] HTTP ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/getListingDetails] failed status=${res.status} body=${body}`);
    throw new Error(`ETSY_LISTING_ERROR: ${res.status}`);
  }

  const data = await res.json() as {
    listing_id?: number;
    state?: string;
    title?: string;
    description?: string;
    price?: { amount?: number; divisor?: number };
    quantity?: number;
    taxonomy_id?: number;
    shipping_profile_id?: number;
    tags?: string[];
    processing_min?: number;
    processing_max?: number;
    materials?: string[];
    item_weight?: number;
    item_weight_unit?: string;
    item_length?: number;
    item_width?: number;
    item_height?: number;
    item_dimensions_unit?: string;
  };

  const desc = data.description ?? "";
  const firstLine = desc.split("\n")[0]?.trim() ?? "";
  const price = data.price?.amount != null && data.price?.divisor
    ? data.price.amount / data.price.divisor
    : null;

  return {
    listingId: String(data.listing_id ?? listingId),
    state: data.state ?? "unknown",
    title: data.title ?? "",
    descriptionLength: desc.length,
    descriptionFirstLine: firstLine,
    price,
    quantity: data.quantity ?? null,
    taxonomyId: data.taxonomy_id ?? null,
    shippingProfileId: data.shipping_profile_id ?? null,
    tags: data.tags ?? [],
    tagCount: (data.tags ?? []).length,
    hasReadinessProfile: !!(data.processing_min != null || data.processing_max != null),
    materials: data.materials ?? [],
    itemWeight: data.item_weight ?? null,
    itemWeightUnit: data.item_weight_unit ?? null,
    itemLength: data.item_length ?? null,
    itemWidth: data.item_width ?? null,
    itemHeight: data.item_height ?? null,
    itemDimensionsUnit: data.item_dimensions_unit ?? null,
  };
}

export async function getListingImages(
  storeId: string,
  listingId: string,
): Promise<EtsyListingImagesResult> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/listings/${listingId}/images`;
  console.log(`[etsy/getListingImages] storeId=${storeId} listingId=${listingId}`);

  const res = await etsyFetch(endpoint, {
    headers: { "x-api-key": apiKey, "Authorization": `Bearer ${accessToken}` },
  }, { idempotent: true, op: `GET ${endpoint}` });
  console.log(`[etsy/getListingImages] HTTP ${res.status}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/getListingImages] failed status=${res.status} body=${body}`);
    throw new Error(`ETSY_IMAGES_ERROR: ${res.status}`);
  }

  const data = await res.json() as { results?: { rank?: number }[] };
  const results = data.results ?? [];
  const ranks = results.map((img) => img.rank ?? 0).sort((a, b) => a - b);

  return { imageCount: results.length, ranks };
}

export async function getListingInventory(
  storeId: string,
  listingId: string,
): Promise<EtsyListingInventoryResult> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/listings/${listingId}/inventory`;
  console.log(`[etsy/getListingInventory] storeId=${storeId} listingId=${listingId}`);

  const res = await etsyFetch(endpoint, {
    headers: { "x-api-key": apiKey, "Authorization": `Bearer ${accessToken}` },
  }, { idempotent: true, op: `GET ${endpoint}` });
  console.log(`[etsy/getListingInventory] HTTP ${res.status}`);

  // 404 or 400 can mean no inventory — treat as no-variations
  if (res.status === 404 || res.status === 400) {
    return { inventoryProductCount: 0, hasVariations: false, propertyNames: [], productSkus: [] };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/getListingInventory] failed status=${res.status} body=${body}`);
    throw new Error(`ETSY_INVENTORY_READ_ERROR: ${res.status}`);
  }

  const data = await res.json() as {
    products?: {
      sku?: string;
      property_values?: { property_id?: number; property_name?: string; values?: string[] }[];
    }[];
  };
  const products = data.products ?? [];

  // Collect unique property names from the first product
  const propertyNamesSet = new Set<string>();
  for (const product of products) {
    for (const pv of product.property_values ?? []) {
      if (pv.property_name) propertyNamesSet.add(pv.property_name);
    }
  }

  return {
    inventoryProductCount: products.length,
    hasVariations: products.some((p) => (p.property_values?.length ?? 0) > 0),
    propertyNames: Array.from(propertyNamesSet),
    productSkus: products.map((p) => p.sku ?? "").filter((sku) => sku.trim().length > 0),
  };
}

// Read-only helper: return the ordered, distinct variation PROPERTIES (id + name)
// of an existing listing. This is the source of truth for the Style /
// Primary-color property IDs the variation-profile matrix needs — custom
// properties (e.g. a made-up "Style" axis) are NOT in the taxonomy, so the only
// way to learn their reserved IDs (513/514) is to read a real listing that uses
// them. Pure GET; performs no writes.
export async function getListingVariationProperties(
  storeId: string,
  listingId: string,
): Promise<{ property_id: number; property_name: string; sample_values: string[] }[]> {
  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;
  const endpoint = `${ETSY_API_BASE}/application/listings/${listingId}/inventory`;
  console.log(`[etsy/getListingVariationProperties] storeId=${storeId} listingId=${listingId}`);

  const res = await etsyFetch(endpoint, {
    headers: { "x-api-key": apiKey, "Authorization": `Bearer ${accessToken}` },
  }, { idempotent: true, op: `GET ${endpoint}` });
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(`[etsy/getListingVariationProperties] failed status=${res.status} body=${body}`);
    throw new Error(`ETSY_INVENTORY_READ_ERROR: ${res.status}`);
  }
  const data = await res.json() as {
    products?: { property_values?: { property_id?: number; property_name?: string; values?: string[] }[] }[];
  };
  // Preserve the property ORDER as Etsy returns it (variation 1 then variation 2)
  // and collect a couple of sample values per property so the two axes are easy
  // to tell apart by eye.
  const ordered: number[] = [];
  const byId = new Map<number, { property_name: string; values: Set<string> }>();
  for (const product of data.products ?? []) {
    for (const pv of product.property_values ?? []) {
      if (typeof pv.property_id !== "number") continue;
      if (!byId.has(pv.property_id)) {
        ordered.push(pv.property_id);
        byId.set(pv.property_id, { property_name: pv.property_name ?? "", values: new Set() });
      }
      const entry = byId.get(pv.property_id)!;
      for (const v of pv.values ?? []) if (entry.values.size < 3) entry.values.add(v);
    }
  }
  return ordered.map((id) => ({
    property_id: id,
    property_name: byId.get(id)!.property_name,
    sample_values: Array.from(byId.get(id)!.values),
  }));
}

// ---------------------------------------------------------------------------
// Listing inventory update for variations (Phase 7B)
// ---------------------------------------------------------------------------

import type { EtsyInventoryPayload } from "@/lib/services/inventoryHelpers";

export async function updateListingInventory(
  storeId: string,
  listingId: string,
  payload: EtsyInventoryPayload,
): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true, name: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");

  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const endpoint = `${ETSY_API_BASE}/application/listings/${listingId}/inventory`;
  console.log(
    `[etsy/updateListingInventory] storeId=${storeId} listingId=${listingId} ` +
    `products=${payload.products.length}`,
  );

  // PUT inventory is idempotent (last-write-wins). Safe to retry on 429/5xx.
  const res = await etsyFetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  }, { idempotent: true, op: "updateListingInventory" });

  console.log(`[etsy/updateListingInventory] HTTP ${res.status} for listingId=${listingId}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    console.error(
      `[etsy/updateListingInventory] failed — listingId=${listingId} status=${res.status} body=${body}`,
    );
    throw Object.assign(
      new Error(`ETSY_INVENTORY_ERROR: ${res.status}`),
      { etsyBody: body },
    );
  }
}

// ---------------------------------------------------------------------------
// Auto-setup Etsy IDs for a store (Phase 9A)
// ---------------------------------------------------------------------------

export type AutoSetupFieldStatus = "saved" | "already_set" | "failed" | "not_found";

export interface AutoSetupFieldResult {
  value: string | null;
  status: AutoSetupFieldStatus;
  label: string;
}

export interface AutoSetupResult {
  storeId: string;
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  returnPolicyId: string | null;
  fields: {
    taxonomyId: AutoSetupFieldResult;
    shippingProfileId: AutoSetupFieldResult;
    readinessStateId: AutoSetupFieldResult;
    returnPolicyId: AutoSetupFieldResult;
  };
  actions: string[];
  warnings: string[];
  taxonomyAutoSelected: boolean;
}

export async function autoSetupStoreEtsyIds(
  storeId: string,
  force = false,
): Promise<AutoSetupResult> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, etsyShopId: true, refreshToken: true },
  });
  if (!store?.etsyShopId || !store.refreshToken) throw new Error("STORE_NOT_CONNECTED");

  const existing = await prisma.storeEtsyIds.findUnique({ where: { storeId } });

  const result: AutoSetupResult = {
    storeId,
    taxonomyId: existing?.taxonomyId ?? null,
    shippingProfileId: existing?.shippingProfileId ?? null,
    readinessStateId: existing?.readinessStateId ?? null,
    returnPolicyId: existing?.returnPolicyId ?? null,
    fields: {
      taxonomyId: { value: existing?.taxonomyId ?? null, status: "failed", label: "Taxonomy ID" },
      shippingProfileId: { value: existing?.shippingProfileId ?? null, status: "failed", label: "Shipping Profile ID" },
      readinessStateId: { value: existing?.readinessStateId ?? null, status: "failed", label: "Readiness State ID" },
      returnPolicyId: { value: existing?.returnPolicyId ?? null, status: "not_found", label: "Return Policy ID" },
    },
    actions: [],
    warnings: [],
    taxonomyAutoSelected: false,
  };

  // 1. Taxonomy ID — search for T-shirt
  if (!existing?.taxonomyId || force) {
    try {
      const hits = await searchSellerTaxonomy("t-shirt", 20);
      // Prefer exact or near-exact leaf match
      const best =
        hits.find((h) => h.name.toLowerCase() === "t-shirts") ??
        hits.find((h) => h.name.toLowerCase().includes("t-shirt")) ??
        hits[0];
      if (best) {
        result.taxonomyId = String(best.id);
        result.fields.taxonomyId = { value: String(best.id), status: "saved", label: `Taxonomy ID — ${best.name} (${best.path})` };
        result.actions.push(`taxonomyId → ${best.id} (${best.name} — ${best.path})`);
        const isExact = best.name.toLowerCase() === "t-shirts";
        if (!isExact) {
          result.taxonomyAutoSelected = true;
          result.warnings.push(`Taxonomy auto-selected: "${best.name}" (ID ${best.id}). Verify this is correct in Etsy before running a batch.`);
        }
      } else {
        result.fields.taxonomyId = { value: null, status: "not_found", label: "Taxonomy ID — not found" };
        result.warnings.push("No T-shirt taxonomy found — taxonomyId not set.");
      }
    } catch (e) {
      result.fields.taxonomyId = { value: null, status: "failed", label: "Taxonomy ID — fetch failed" };
      result.warnings.push(`Taxonomy search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    result.fields.taxonomyId = { value: existing.taxonomyId, status: "already_set", label: `Taxonomy ID — already set` };
    result.actions.push(`taxonomyId already set (${existing.taxonomyId}) — skipped`);
  }

  // 2. Shipping profile — pick first active one
  if (!existing?.shippingProfileId || force) {
    try {
      const config = await fetchStoreConfig(storeId);
      const profile = config.shippingProfiles[0] ?? null;
      if (profile) {
        result.shippingProfileId = String(profile.shipping_profile_id);
        result.fields.shippingProfileId = { value: String(profile.shipping_profile_id), status: "saved", label: `Shipping Profile — ${profile.title}` };
        result.actions.push(`shippingProfileId → ${profile.shipping_profile_id} (${profile.title})`);
      } else {
        result.fields.shippingProfileId = { value: null, status: "not_found", label: "Shipping Profile — none found" };
        result.warnings.push("No shipping profiles found — create one in Etsy Shop Manager.");
      }
    } catch (e) {
      result.fields.shippingProfileId = { value: null, status: "failed", label: "Shipping Profile — fetch failed" };
      result.warnings.push(`Shipping profile fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    result.fields.shippingProfileId = { value: existing.shippingProfileId, status: "already_set", label: "Shipping Profile ID — already set" };
    result.actions.push(`shippingProfileId already set (${existing.shippingProfileId}) — skipped`);
  }

  // 3. Readiness profile — find or create made_to_order
  if (!existing?.readinessStateId || force) {
    try {
      const { profile } = await findOrCreateMadeToOrderReadinessProfile(storeId, 1, 3);
      result.readinessStateId = String(profile.readiness_state_id);
      result.fields.readinessStateId = { value: String(profile.readiness_state_id), status: "saved", label: `Readiness State — made_to_order (ID ${profile.readiness_state_id})` };
      result.actions.push(`readinessStateId → ${profile.readiness_state_id} (made_to_order)`);
    } catch (e) {
      result.fields.readinessStateId = { value: null, status: "failed", label: "Readiness State — setup failed" };
      result.warnings.push(`Readiness profile setup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    result.fields.readinessStateId = { value: existing.readinessStateId, status: "already_set", label: "Readiness State ID — already set" };
    result.actions.push(`readinessStateId already set (${existing.readinessStateId}) — skipped`);
  }

  // 4. Return policy — pick first available
  if (!existing?.returnPolicyId || force) {
    try {
      const config = await fetchStoreConfig(storeId);
      const policy = config.returnPolicies?.[0] ?? null;
      if (policy) {
        result.returnPolicyId = String(policy.return_policy_id);
        result.fields.returnPolicyId = { value: String(policy.return_policy_id), status: "saved", label: `Return Policy — ID ${policy.return_policy_id}` };
        result.actions.push(`returnPolicyId → ${policy.return_policy_id}`);
      } else {
        result.fields.returnPolicyId = { value: null, status: "not_found", label: "Return Policy — none found (optional)" };
        result.actions.push("returnPolicyId — no return policies found (optional)");
      }
    } catch (e) {
      result.fields.returnPolicyId = { value: null, status: "failed", label: "Return Policy — fetch failed (optional)" };
      result.warnings.push(`Return policy fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    result.fields.returnPolicyId = { value: existing.returnPolicyId, status: "already_set", label: "Return Policy ID — already set" };
    result.actions.push(`returnPolicyId already set (${existing.returnPolicyId}) — skipped`);
  }

  // Persist all resolved IDs
  await prisma.storeEtsyIds.upsert({
    where: { storeId },
    create: {
      storeId,
      taxonomyId: result.taxonomyId,
      shippingProfileId: result.shippingProfileId,
      readinessStateId: result.readinessStateId,
      returnPolicyId: result.returnPolicyId,
    },
    update: {
      ...(result.taxonomyId !== null && { taxonomyId: result.taxonomyId }),
      ...(result.shippingProfileId !== null && { shippingProfileId: result.shippingProfileId }),
      ...(result.readinessStateId !== null && { readinessStateId: result.readinessStateId }),
      ...(result.returnPolicyId !== null && { returnPolicyId: result.returnPolicyId }),
    },
  });

  console.log(`[etsy/autoSetup] storeId=${storeId} actions: ${result.actions.join(" | ")}`);
  return result;
}

// ---------------------------------------------------------------------------
// Phase 4: draft reconciliation
//
// Before we retry a failed createDraftListing (or resurrect a failed row),
// look in the store's own draft listings to see whether Etsy actually
// created the draft during the previous ambiguous call. Match strategy,
// most-specific first:
//   1. Inventory product SKU (unique per listing in this workflow — every
//      manifest row carries its own SKU).
//   2. Exact title (used only if SKU can't be read or the listing has no
//      variations and Etsy hasn't populated a product SKU yet).
//
// Returns null when no matching draft exists. Uses only GETs — safe to
// retry on 429/5xx, no state changes.
// ---------------------------------------------------------------------------

export type EtsyDraftMatchedBy = "sku" | "title";
export interface EtsyExistingDraft {
  listingId: string;
  matchedBy: EtsyDraftMatchedBy;
  title: string;
  state: string;
}

interface EtsyListingSummary {
  listing_id: number;
  title?: string;
  state?: string;
  sku?: string[];
}

/** Page through draft listings for a shop. Etsy paginates via `offset` + `limit`. */
async function listShopDraftListings(
  storeId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<EtsyListingSummary[]> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { etsyShopId: true },
  });
  if (!store?.etsyShopId) throw new Error("STORE_NOT_CONNECTED");

  const clientId = process.env.ETSY_CLIENT_ID;
  const clientSecret = process.env.ETSY_CLIENT_SECRET;
  if (!clientId) throw new Error("MISSING_CREDENTIALS");
  const accessToken = await refreshAccessToken(storeId);
  const apiKey = clientSecret ? `${clientId}:${clientSecret}` : clientId;

  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 5; // 500 drafts is a generous ceiling
  const collected: EtsyListingSummary[] = [];

  for (let page = 0; page < maxPages; page++) {
    const url = `${ETSY_API_BASE}/application/shops/${store.etsyShopId}/listings?state=draft&limit=${pageSize}&offset=${page * pageSize}`;
    const res = await etsyFetch(url, {
      headers: { "x-api-key": apiKey, "Authorization": `Bearer ${accessToken}` },
    }, { idempotent: true, op: "listShopDraftListings" });
    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      throw new Error(`ETSY_LIST_DRAFTS_ERROR: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { results?: EtsyListingSummary[]; count?: number };
    const results = data.results ?? [];
    collected.push(...results);
    if (results.length < pageSize) break;
  }
  return collected;
}

/** Look for an existing draft that matches (sku, title). Returns null if not
 *  found. Never throws on empty result — throws only on hard API failure. */
export async function findExistingDraftForRow(
  storeId: string,
  match: { sku?: string | null; title?: string | null },
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<EtsyExistingDraft | null> {
  const sku = (match.sku ?? "").trim();
  const title = (match.title ?? "").trim();
  if (!sku && !title) return null;

  const drafts = await listShopDraftListings(storeId, options);

  // Preferred match: SKU. Etsy lists the SKU strings on the listing summary
  // (empty for zero-inventory listings); the row we care about writes exactly
  // one SKU via updateListingInventory's single-product path.
  if (sku) {
    const skuMatch = drafts.find((d) => Array.isArray(d.sku) && d.sku.includes(sku));
    if (skuMatch) {
      return {
        listingId: String(skuMatch.listing_id),
        matchedBy: "sku",
        title: skuMatch.title ?? "",
        state: skuMatch.state ?? "draft",
      };
    }
    // Fallback for drafts created before the inventory-SKU update landed —
    // pull inventory directly for each candidate whose title matches (cheap)
    // or all drafts (bounded by maxPages) and check the product SKU field.
    // The primary use case is a listing that failed before its
    // updateListingInventory step; those still have title but no SKU on the
    // summary.
    for (const draft of drafts) {
      if (title && draft.title?.trim() === title) {
        try {
          const inv = await getListingInventory(storeId, String(draft.listing_id));
          if (inv.productSkus.includes(sku)) {
            return {
              listingId: String(draft.listing_id),
              matchedBy: "sku",
              title: draft.title ?? "",
              state: draft.state ?? "draft",
            };
          }
        } catch {
          // fall through — inventory read failing is not fatal for the title path
        }
      }
    }
  }

  if (title) {
    const titleMatch = drafts.find((d) => (d.title ?? "").trim() === title);
    if (titleMatch) {
      return {
        listingId: String(titleMatch.listing_id),
        matchedBy: "title",
        title: titleMatch.title ?? "",
        state: titleMatch.state ?? "draft",
      };
    }
  }

  return null;
}
