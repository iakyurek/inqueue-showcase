// Phase 4 tests — retry/backoff, ambiguous-failure reconciliation,
// and token-refresh mutex. Runs with tsx:
//   cd batchly && npx tsx tests/etsy-retry.test.mts
//
// Every Etsy call goes through etsyFetch(); we swap in a scripted fetch mock
// and a synchronous sleep mock so tests are deterministic and fast. No live
// Etsy HTTP is issued anywhere in this file.

import assert from "node:assert/strict";
import {
  etsyFetch,
  EtsyAmbiguousError,
  findExistingDraftForRow,
  refreshAccessToken,
  __setEtsyFetchForTests,
  __resetEtsyFetchForTests,
  __setEtsySleepForTests,
  __resetEtsySleepForTests,
} from "../src/lib/services/etsy";

// ---- test harness -----------------------------------------------------------

let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (err) { failed += 1; console.error(`  FAIL ${name}\n    ${(err as Error).stack || (err as Error).message}`); }
}

type MockResponder = (url: string, init?: RequestInit) => Response | Promise<Response> | Error;
let responder: MockResponder = () => new Response("", { status: 200 });
const calls: { url: string; method: string }[] = [];
__setEtsyFetchForTests(async (url, init) => {
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ url: String(url), method });
  const outcome = await Promise.resolve(responder(String(url), init));
  if (outcome instanceof Error) throw outcome;
  return outcome;
});
// Zero-delay sleep — retries are instant.
__setEtsySleepForTests(async () => {});
function resetCalls() { calls.length = 0; }

// ---- retry / backoff --------------------------------------------------------

console.log("Phase 4: retry / rate-limit / reconciliation tests\n");

await test("429 with Retry-After header is honored and request retries", async () => {
  resetCalls();
  const sleepFor: number[] = [];
  __setEtsySleepForTests(async (ms) => { sleepFor.push(ms); });
  let attempt = 0;
  responder = () => {
    attempt += 1;
    if (attempt === 1) return new Response("rate", { status: 429, headers: { "Retry-After": "2" } });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const res = await etsyFetch("https://etsy/test", { method: "GET" }, { idempotent: true, op: "test429" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  // parseRetryAfter converts "2" → 2000ms
  assert.equal(sleepFor[0], 2000);
  __setEtsySleepForTests(async () => {});
});

await test("5xx retries with exponential backoff up to maxRetries", async () => {
  resetCalls();
  let attempts = 0;
  responder = () => {
    attempts += 1;
    return new Response("boom", { status: 503 });
  };
  const res = await etsyFetch("https://etsy/test", { method: "GET" }, { idempotent: true, maxRetries: 3, op: "test5xx" });
  // After 3 retries + 1 initial = 4 attempts, then we surface the last 503.
  assert.equal(res.status, 503);
  assert.equal(attempts, 4);
});

await test("non-idempotent POST + 500 throws EtsyAmbiguousError (no retry)", async () => {
  resetCalls();
  responder = () => new Response("etsy panic", { status: 500 });
  await assert.rejects(
    etsyFetch("https://etsy/test", { method: "POST", body: "x" }, { idempotent: false, op: "createDraft" }),
    (err: Error) => err instanceof EtsyAmbiguousError && (err as EtsyAmbiguousError).reason === "server_5xx",
  );
  assert.equal(calls.length, 1); // never retried
});

await test("non-idempotent POST + 429 IS retried (server rejected before processing)", async () => {
  resetCalls();
  let n = 0;
  responder = () => {
    n += 1;
    if (n === 1) return new Response("", { status: 429 });
    return new Response("{}", { status: 200 });
  };
  const res = await etsyFetch("https://etsy/test", { method: "POST" }, { idempotent: false, op: "createDraft-429" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

await test("non-idempotent + network error → EtsyAmbiguousError (network_error)", async () => {
  resetCalls();
  responder = () => new Error("ECONNRESET");
  await assert.rejects(
    etsyFetch("https://etsy/test", { method: "POST" }, { idempotent: false, op: "createDraft-net" }),
    (err: Error) => err instanceof EtsyAmbiguousError && (err as EtsyAmbiguousError).reason === "network_error",
  );
  assert.equal(calls.length, 1);
});

await test("idempotent + network error retries up to maxRetries then throws", async () => {
  resetCalls();
  responder = () => new Error("ECONNRESET");
  await assert.rejects(
    etsyFetch("https://etsy/test", { method: "GET" }, { idempotent: true, maxRetries: 2, op: "getImages" }),
    /ECONNRESET/,
  );
  assert.equal(calls.length, 3); // initial + 2 retries
});

// ---- token refresh mutex ----------------------------------------------------

await test("concurrent refreshAccessToken calls for one store share one HTTP request", async () => {
  process.env.ETSY_CLIENT_ID = process.env.ETSY_CLIENT_ID || "test-client-id";
  // Stub prisma via the module singleton — we intercept fetch, not the DB.
  // For this test we need a store row. Rather than seed the SQLite dev.db
  // and risk polluting real data, mock the prisma import path.
  const { prisma } = await import("../src/lib/prisma");
  const original = prisma.store.findUnique;
  const originalUpdate = prisma.store.update;
  const storeId = "test-store-id-phase4";
  const fakeStore: {
    id: string;
    refreshToken: string | null;
    accessToken: string | null;
    tokenExpiresAt: Date | null;
  } = {
    id: storeId,
    refreshToken: "fake-refresh-token",
    accessToken: null,
    tokenExpiresAt: null,
  };
  prisma.store.findUnique = (async () => fakeStore) as unknown as typeof prisma.store.findUnique;
  prisma.store.update = (async ({ data }: { data: Partial<typeof fakeStore> }) => {
    Object.assign(fakeStore, data);
    return fakeStore;
  }) as unknown as typeof prisma.store.update;

  try {
    resetCalls();
    let httpCalls = 0;
    responder = async () => {
      httpCalls += 1;
      // Simulate a real Etsy refresh: rotates refresh_token so a stale
      // concurrent write would break the connection.
      await new Promise((r) => setTimeout(r, 5));
      return new Response(JSON.stringify({
        access_token: `access-${httpCalls}`,
        expires_in: 3600,
        refresh_token: `rotated-refresh-${httpCalls}`,
      }), { status: 200 });
    };

    // Fire five refreshes concurrently — the mutex must coalesce them.
    const results = await Promise.all(Array.from({ length: 5 }, () => refreshAccessToken(storeId)));
    // All five callers get the same token — because only one HTTP call ran.
    assert.equal(new Set(results).size, 1, `expected one shared token, got ${new Set(results).size}`);
    assert.equal(httpCalls, 1, `expected 1 Etsy refresh HTTP call, got ${httpCalls}`);
    // The stored refresh_token is exactly the one Etsy returned on that call.
    assert.equal(fakeStore.refreshToken, "rotated-refresh-1");
  } finally {
    prisma.store.findUnique = original;
    prisma.store.update = originalUpdate;
  }
});

// ---- reconciliation ---------------------------------------------------------

await test("findExistingDraftForRow finds draft by SKU on the summary page", async () => {
  process.env.ETSY_CLIENT_ID = "test-client-id";
  const { prisma } = await import("../src/lib/prisma");
  const storeId = "test-store-recon-sku";
  const originalStoreFind = prisma.store.findUnique;
  prisma.store.findUnique = (async () => ({
    id: storeId, etsyShopId: "111", refreshToken: "r", accessToken: "valid-token",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  })) as unknown as typeof prisma.store.findUnique;

  responder = (url) => {
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/listings?state=draft")) {
      return new Response(JSON.stringify({
        count: 2,
        results: [
          { listing_id: 555111, title: "Some Other Design", state: "draft", sku: ["OTHER"] },
          { listing_id: 555222, title: "Cosmic Vibes", state: "draft", sku: ["CU17"] },
        ],
      }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  try {
    const found = await findExistingDraftForRow(storeId, { sku: "CU17", title: "Cosmic Vibes" });
    assert.ok(found, "expected an existing draft to be returned");
    assert.equal(found!.listingId, "555222");
    assert.equal(found!.matchedBy, "sku");
  } finally {
    prisma.store.findUnique = originalStoreFind;
  }
});

await test("findExistingDraftForRow falls back to exact title when SKU is not on the summary", async () => {
  process.env.ETSY_CLIENT_ID = "test-client-id";
  const { prisma } = await import("../src/lib/prisma");
  const storeId = "test-store-recon-title";
  const originalStoreFind = prisma.store.findUnique;
  prisma.store.findUnique = (async () => ({
    id: storeId, etsyShopId: "111", refreshToken: "r", accessToken: "valid-token",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  })) as unknown as typeof prisma.store.findUnique;

  responder = (url) => {
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/listings?state=draft")) {
      // Etsy hasn't populated SKUs on the summary yet — title is our fallback.
      return new Response(JSON.stringify({
        count: 1,
        results: [{ listing_id: 555333, title: "Cosmic Vibes", state: "draft", sku: [] }],
      }), { status: 200 });
    }
    if (url.endsWith("/inventory")) {
      // Empty inventory — SKU lookup returns nothing so we fall through to title.
      return new Response(JSON.stringify({ products: [] }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  try {
    const found = await findExistingDraftForRow(storeId, { sku: "CU17", title: "Cosmic Vibes" });
    assert.ok(found);
    assert.equal(found!.listingId, "555333");
    assert.equal(found!.matchedBy, "title");
  } finally {
    prisma.store.findUnique = originalStoreFind;
  }
});

await test("findExistingDraftForRow returns null when no matching draft exists", async () => {
  process.env.ETSY_CLIENT_ID = "test-client-id";
  const { prisma } = await import("../src/lib/prisma");
  const storeId = "test-store-recon-none";
  const originalStoreFind = prisma.store.findUnique;
  prisma.store.findUnique = (async () => ({
    id: storeId, etsyShopId: "111", refreshToken: "r", accessToken: "valid-token",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  })) as unknown as typeof prisma.store.findUnique;

  responder = (url) => {
    if (url.includes("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/listings?state=draft")) {
      return new Response(JSON.stringify({
        count: 1,
        results: [{ listing_id: 999, title: "Something Else Entirely", state: "draft", sku: ["OTHER"] }],
      }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  try {
    const found = await findExistingDraftForRow(storeId, { sku: "CU17", title: "Cosmic Vibes" });
    assert.equal(found, null);
  } finally {
    prisma.store.findUnique = originalStoreFind;
  }
});

await test("findExistingDraftForRow paginates until first match", async () => {
  process.env.ETSY_CLIENT_ID = "test-client-id";
  const { prisma } = await import("../src/lib/prisma");
  const storeId = "test-store-recon-paginate";
  const originalStoreFind = prisma.store.findUnique;
  prisma.store.findUnique = (async () => ({
    id: storeId, etsyShopId: "111", refreshToken: "r", accessToken: "valid-token",
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  })) as unknown as typeof prisma.store.findUnique;

  let page = 0;
  responder = (url) => {
    if (url.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
    if (url.includes("/listings?state=draft")) {
      page += 1;
      if (page === 1) {
        // First page full of unrelated drafts, forcing a second-page fetch.
        return new Response(JSON.stringify({
          results: Array.from({ length: 2 }, (_, i) => ({ listing_id: 1000 + i, title: `Other ${i}`, state: "draft", sku: [`X${i}`] })),
          count: 3,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: [{ listing_id: 9001, title: "Target", state: "draft", sku: ["TARGET"] }], count: 3 }), { status: 200 });
    }
    return new Response("", { status: 404 });
  };

  try {
    // pageSize=2 forces pagination even for our small fixture.
    const found = await findExistingDraftForRow(storeId, { sku: "TARGET" }, { pageSize: 2, maxPages: 3 });
    assert.ok(found);
    assert.equal(found!.listingId, "9001");
  } finally {
    prisma.store.findUnique = originalStoreFind;
  }
});

// ---- cleanup ----------------------------------------------------------------

__resetEtsyFetchForTests();
__resetEtsySleepForTests();

console.log("");
if (failed) {
  console.error(`Phase 4 tests: FAILED (${failed})`);
  process.exit(1);
}
console.log("Phase 4 tests: OK");
