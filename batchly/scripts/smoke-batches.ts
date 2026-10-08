/**
 * smoke-batches.ts
 *
 * Non-destructive smoke test for the batch workflow APIs.
 * Tests read-only and initialization endpoints only — no Etsy write calls.
 *
 * Run: npm run smoke:batches
 * Requires the dev server to be running on http://localhost:3030
 */

const BASE_URL = process.env.BATCHLY_BASE_URL ?? "http://localhost:3030";

interface TestResult {
  name: string;
  passed: boolean;
  status?: number;
  detail: string;
  warning?: string;
}

const results: TestResult[] = [];

async function test(
  name: string,
  fn: () => Promise<{ passed: boolean; detail: string; status?: number; warning?: string }>,
) {
  process.stdout.write(`  ${name}… `);
  try {
    const r = await fn();
    results.push({ name, ...r });
    if (r.passed) {
      console.log(`✓ ${r.detail}`);
    } else {
      console.log(`✗ ${r.detail}`);
    }
    if (r.warning) console.log(`    ⚠ ${r.warning}`);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unexpected error";
    results.push({ name, passed: false, detail });
    console.log(`✗ ${detail}`);
  }
}

async function get(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

// ---------------------------------------------------------------------------

console.log(`\n── Batchly Smoke Test ─────────────────────────────────────────`);
console.log(`   Server: ${BASE_URL}`);
console.log(`   Time:   ${new Date().toISOString()}`);
console.log(`───────────────────────────────────────────────────────────────\n`);

async function run() {
  // ------------------------------------------------------------------
  // 1. Settings / global presets
  // ------------------------------------------------------------------
  console.log("1. Settings");

  await test("GET /api/settings/listing-preset", async () => {
    const { res, json } = await get("/api/settings/listing-preset");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}: ${(json as { error?: string }).error ?? "unknown"}` };
    const hasPreset = !!(json as { preset?: unknown }).preset;
    return {
      passed: res.ok,
      status: res.status,
      detail: hasPreset ? "preset found" : "no preset saved yet",
      warning: hasPreset ? undefined : "Run npm run db:seed to create default preset",
    };
  });

  await test("GET /api/settings/variation-preset", async () => {
    const { res, json } = await get("/api/settings/variation-preset");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
    const preset = (json as { preset?: { enabled?: boolean } }).preset;
    return {
      passed: true,
      status: res.status,
      detail: preset ? `enabled=${String(preset.enabled)}` : "no preset",
    };
  });

  await test("GET /api/settings/supplemental-images", async () => {
    const { res, json } = await get("/api/settings/supplemental-images");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
    const preset = (json as { preset?: { enabled?: boolean } }).preset;
    return {
      passed: true,
      status: res.status,
      detail: preset ? `enabled=${String(preset.enabled)}` : "no preset",
    };
  });

  // ------------------------------------------------------------------
  // 2. Local batch scanner
  // ------------------------------------------------------------------
  console.log("\n2. Local batch scanner");

  let firstBatchFolder: string | null = null;

  await test("GET /api/batches/local", async () => {
    const { res, json } = await get("/api/batches/local");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
    const batches = (json as { batches?: Array<{ folderName: string; hasManifest: boolean; manifestRowCount: number | null; storeFoldersFound: string[] }> }).batches ?? [];
    if (batches.length > 0) {
      firstBatchFolder = batches[0].folderName;
    }
    return {
      passed: true,
      status: res.status,
      detail: `${batches.length} batch folder(s) found${batches.length > 0 ? `: ${batches.map((b) => b.folderName).join(", ")}` : ""}`,
      warning: batches.length === 0 ? "No batches in workspace/downloads — download one from Drive first" : undefined,
    };
  });

  // ------------------------------------------------------------------
  // 3. Batch validation (if a local batch exists)
  // ------------------------------------------------------------------
  console.log("\n3. Batch validation");

  if (firstBatchFolder) {
    await test(`POST /api/batches/validate (${firstBatchFolder})`, async () => {
      const { res, json } = await post("/api/batches/validate", { batchFolder: firstBatchFolder });
      if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}: ${(json as { error?: string }).error ?? "unknown"}` };
      const result = json as {
        overallStatus?: string;
        manifestRowCount?: number;
        storesInManifest?: string[];
        storeResults?: Array<{ storeFolder: string; etsyConnected: boolean; eligibleNotCreatedCount: number }>;
      };
      const storesReady = (result.storeResults ?? []).filter((s) => s.etsyConnected);
      return {
        passed: true,
        status: res.status,
        detail: `status=${result.overallStatus} rows=${result.manifestRowCount} stores=${result.storesInManifest?.length ?? 0} connected=${storesReady.length}`,
      };
    });
  } else {
    console.log("  skip — no local batches found");
  }

  // ------------------------------------------------------------------
  // 4. Batch run history
  // ------------------------------------------------------------------
  console.log("\n4. Batch run history");

  let firstRunId: string | null = null;

  await test("GET /api/batches/runs", async () => {
    const { res, json } = await get("/api/batches/runs");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
    const runs = (json as { runs?: Array<{ id: string; status: string; batchFolder: string; created: number }> }).runs ?? [];
    if (runs.length > 0) firstRunId = runs[0].id;
    return {
      passed: true,
      status: res.status,
      detail: `${runs.length} run(s) in history${runs.length > 0 ? ` — latest: ${runs[0].status} (${runs[0].batchFolder})` : ""}`,
    };
  });

  const capturedRunId = (firstRunId ?? "") as string;
  const capturedRunIdShort = capturedRunId.slice(0, 8);
  if (capturedRunId) {
    await test(`GET /api/batches/runs/${capturedRunIdShort}… (progress)`, async () => {
      const { res, json } = await get(`/api/batches/runs/${capturedRunId}`);
      if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
      const progress = json as {
        status?: string;
        totalRows?: number;
        created?: number;
        failed?: number;
        percentComplete?: number;
        stores?: unknown[];
      };
      return {
        passed: true,
        status: res.status,
        detail: `status=${progress.status} rows=${progress.totalRows} created=${progress.created} failed=${progress.failed} ${progress.percentComplete}%`,
      };
    });
  }

  // ------------------------------------------------------------------
  // 5. Drive status (read-only)
  // ------------------------------------------------------------------
  console.log("\n5. Drive status");

  await test("GET /api/drive/status", async () => {
    const { res, json } = await get("/api/drive/status");
    if (!res.ok) return { passed: false, status: res.status, detail: `HTTP ${res.status}` };
    const connected = (json as { connected?: boolean }).connected;
    return {
      passed: true,
      status: res.status,
      detail: connected ? "Drive connected" : "Drive not connected",
      warning: !connected ? "Connect Google Drive in Settings to use Drive detection" : undefined,
    };
  });

  // ------------------------------------------------------------------
  // 6. Input validation checks (should reject bad input)
  // ------------------------------------------------------------------
  console.log("\n6. Input validation");

  await test("POST /api/batches/validate rejects path traversal", async () => {
    const { res, json } = await post("/api/batches/validate", { batchFolder: "../etc/passwd" });
    return {
      passed: res.status === 400,
      status: res.status,
      detail: res.status === 400 ? `correctly rejected: ${(json as { error?: string }).error ?? "400"}` : `FAIL: accepted path traversal (${res.status})`,
    };
  });

  await test("POST /api/batches/run rejects missing batchFolder", async () => {
    const { res, json } = await post("/api/batches/run", {});
    return {
      passed: res.status === 400,
      status: res.status,
      detail: res.status === 400 ? `correctly rejected: ${(json as { error?: string }).error ?? "400"}` : `FAIL: accepted empty body (${res.status})`,
    };
  });

  await test("GET /api/batches/runs/nonexistent-id returns 404", async () => {
    const { res } = await get("/api/batches/runs/does-not-exist");
    return {
      passed: res.status === 404,
      status: res.status,
      detail: res.status === 404 ? "correctly returned 404" : `FAIL: returned ${res.status}`,
    };
  });

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log(`\n── Results ─────────────────────────────────────────────────────`);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`   ${passed} passed  ${failed} failed  ${results.length} total`);

  if (failed > 0) {
    console.log("\n── Failed Tests ─────────────────────────────────────────────────");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`   ✗ ${r.name}: ${r.detail}`);
    }
  }

  console.log(`───────────────────────────────────────────────────────────────\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err: unknown) => {
  console.error("Smoke test crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
