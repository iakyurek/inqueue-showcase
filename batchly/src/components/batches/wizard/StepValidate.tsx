"use client";

import { useState } from "react";
import {
  BatchValidationResult,
  StoreValidationResult,
  StatusBadge,
  Spinner,
  Panel,
  PRIMARY_BTN,
} from "./shared";

// ---------------------------------------------------------------------------
// Step 3 — Validate (before inQueue)
// Shows the full validation report. If validation passes the primary action
// is "Move to inQueue", which stages the batch into the right-side pool.
// If validation fails, no move is allowed and the exact issues are shown.
// The actual upload/run happens later, from the inQueue pool sidebar.
// ---------------------------------------------------------------------------

function ChecklistRow({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  const icon = ok ? "✓" : warn ? "⚠" : "✗";
  const cls = ok ? "text-emerald-400" : warn ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-start gap-2 text-[10px]">
      <span className={`${cls} font-bold w-3 shrink-0`}>{icon}</span>
      <span className="text-slate-400 w-40 shrink-0">{label}</span>
      <span className={`${ok ? "text-slate-300" : cls} flex-1`}>{detail}</span>
    </div>
  );
}

function StoreValidationCard({ store }: { store: StoreValidationResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasErrors = store.errors.length > 0 || !store.etsyConnected;
  const hasWarnings = store.warnings.length > 0 || !store.etsySetupReady;

  return (
    <div className={`rounded border ${hasErrors ? "border-red-500/[0.2] bg-red-500/[0.07]" : hasWarnings ? "border-amber-500/[0.2] bg-amber-500/[0.07]" : "border-emerald-500/[0.2] bg-emerald-500/[0.07]"}`}>
      <div className="flex items-center gap-3 px-3 py-2 cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <span className="text-[10px] font-mono text-slate-300 font-bold w-16 shrink-0">{store.storeFolder}</span>
        <div className="flex-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] text-slate-500">
          {store.etsyConnected
            ? <span className="text-emerald-400">✓ Etsy connected</span>
            : <span className="text-red-400">✗ Not connected</span>}
          {store.etsyConnected && (
            store.etsySetupReady
              ? <span className="text-emerald-400">✓ IDs set</span>
              : <span className="text-amber-400">⚠ IDs missing</span>
          )}
          <span className="text-slate-500">{store.manifestRowCount} rows</span>
          {store.eligibleNotCreatedCount > 0 && <span className="text-emerald-400">{store.eligibleNotCreatedCount} eligible</span>}
          {store.alreadyCreatedCount > 0 && <span className="text-blue-400">{store.alreadyCreatedCount} already done</span>}
          {store.ineligibleCount > 0 && <span className="text-slate-400">{store.ineligibleCount} ineligible</span>}
        </div>
        <div className="shrink-0 text-right">
          <span className={`text-[10px] font-semibold ${hasErrors ? "text-red-400" : hasWarnings ? "text-amber-400" : "text-emerald-400"}`}>
            est. {store.estimatedListings}
          </span>
        </div>
        <span className="text-[9px] text-slate-400 shrink-0">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded && (
        <div className="border-t border-white/[0.07] px-3 py-2 space-y-2">
          <div className="grid grid-cols-3 gap-2 text-[9px]">
            <div>
              <p className="text-slate-400 uppercase tracking-wide">taxonomyId</p>
              <p className={store.taxonomyId ? "text-slate-300 font-mono" : "text-red-400 font-semibold"}>
                {store.taxonomyId ?? "— missing"}
              </p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide">shippingProfileId</p>
              <p className={store.shippingProfileId ? "text-slate-300 font-mono" : "text-red-400 font-semibold"}>
                {store.shippingProfileId ?? "— missing"}
              </p>
            </div>
            <div>
              <p className="text-slate-400 uppercase tracking-wide">readinessStateId</p>
              <p className={store.readinessStateId ? "text-slate-300 font-mono" : "text-red-400 font-semibold"}>
                {store.readinessStateId ?? "— missing"}
              </p>
            </div>
          </div>
          {store.missingImageCount > 0 && <p className="text-[9px] text-amber-400">⚠ {store.missingImageCount} rows missing images</p>}
          {store.errors.map((e, i) => <p key={i} className="text-[9px] text-red-400">✗ {e}</p>)}
          {store.warnings.map((w, i) => <p key={i} className="text-[9px] text-amber-400">⚠ {w}</p>)}
          {!store.etsyConnected && (
            <p className="text-[9px] text-red-400">
              ✗ Store not connected via OAuth.{" "}
              <a href="/stores" className="underline hover:text-red-200 transition-colors">Go to Stores →</a>
            </p>
          )}
          {store.etsyConnected && !store.etsySetupReady && (
            <p className="text-[9px] text-amber-400">
              ⚠ Missing Etsy IDs. This store will be skipped.{" "}
              <a href="/stores" className="underline hover:text-yellow-200 transition-colors">Set up in Stores →</a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function StepValidate({
  result,
  onMoveToInQueue,
  onBack,
  moving,
}: {
  result: BatchValidationResult;
  onMoveToInQueue: () => void;
  onBack: () => void;
  moving: boolean;
}) {
  const storesReady = result.storeResults.filter(
    (s) => s.errors.length === 0 && s.etsyConnected && s.etsySetupReady && s.eligibleNotCreatedCount > 0,
  );
  const storesSkipped = result.storeResults.filter(
    (s) => s.errors.length > 0 || !s.etsyConnected || !s.etsySetupReady,
  );
  const totalEstimated = storesReady.reduce((s, r) => s + r.estimatedListings, 0);
  const totalDuplicates = result.storeResults.reduce((s, r) => s + r.alreadyCreatedCount, 0);
  const totalMissingImages = result.storeResults.reduce((s, r) => s + r.missingImageCount, 0);
  const totalMissingTitle = result.storeResults.reduce((s, r) => s + r.missingTitleCount, 0);
  const totalMissingSku = result.storeResults.reduce((s, r) => s + r.missingSkuCount, 0);
  const totalMissingTags = result.storeResults.reduce((s, r) => s + r.missingTagsCount, 0);
  const totalInvalidPrice = result.storeResults.reduce((s, r) => s + r.invalidPriceCount, 0);

  // Validation "passes" (can move to inQueue) when the manifest has no hard
  // errors and at least one store is ready to run.
  const passed = result.manifestStatus !== "errors" && storesReady.length > 0;
  const blockReason =
    result.manifestStatus === "errors"
      ? "Manifest has errors — fix the batch and re-validate."
      : storesReady.length === 0
        ? "No stores are ready — connect a store and set its Etsy IDs, then re-validate."
        : "";

  const sc = result.supplementalPreset;
  const sizeChartOk = !sc.enabled || sc.sizeChartCount >= sc.sizeChartRequired;

  return (
    <div data-testid="step-validate">
      <Panel>
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[14px] font-semibold text-slate-200">Validation Report</span>
              <StatusBadge status={result.overallStatus} />
              <span className="text-[11px] text-slate-500 font-mono">{result.batchFolder}</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Validated {new Date(result.validatedAt).toLocaleString()}</p>
          </div>
          <button
            onClick={onBack}
            disabled={moving}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-white/[0.08] text-[11px] text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-all disabled:opacity-40"
          >
            ← Back
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* Summary grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Manifest rows</p>
              <p className="text-slate-200 font-semibold text-base mt-0.5">{result.manifestRowCount}</p>
              <StatusBadge status={result.manifestStatus} />
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Stores</p>
              <p className="text-slate-200 font-semibold text-base mt-0.5">{result.storesInManifest.length}</p>
              <p className="text-[9px] text-slate-500">{storesReady.length} ready{storesSkipped.length > 0 ? `, ${storesSkipped.length} skipped` : ""}</p>
            </div>
            <div className="rounded border border-emerald-500/[0.2] bg-emerald-500/[0.07] px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Est. new drafts</p>
              <p className="text-emerald-400 font-semibold text-base mt-0.5">{totalEstimated}</p>
              <p className="text-[9px] text-slate-500">max 30/store</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Skip (duplicates)</p>
              <p className="text-slate-400 font-semibold text-base mt-0.5">{totalDuplicates}</p>
              <p className="text-[9px] text-slate-500">already created</p>
            </div>
          </div>

          {/* Explicit validation checklist */}
          <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 space-y-1.5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Checks</p>
            <ChecklistRow
              ok={result.manifestStatus === "ok"}
              warn={result.manifestStatus === "warnings"}
              label="Manifest"
              detail={result.manifestStatus === "ok" ? `${result.manifestRowCount} rows parsed` : result.manifestStatus === "warnings" ? `${result.manifestRowCount} rows, with warnings` : `${result.manifestErrors.length} manifest error(s)`}
            />
            <ChecklistRow
              ok={storesReady.length > 0}
              warn={storesReady.length > 0 && storesSkipped.length > 0}
              label="Store mapping"
              detail={storesReady.length > 0 ? `${storesReady.map((s) => s.storeFolder).join(", ")} ready${storesSkipped.length > 0 ? `; ${storesSkipped.length} skipped` : ""}` : "no ready stores"}
            />
            <ChecklistRow
              ok={totalMissingImages === 0}
              warn={totalMissingImages > 0}
              label="Image folders / mockups"
              detail={totalMissingImages === 0 ? "all rows have mockup images" : `${totalMissingImages} row(s) missing images`}
            />
            <ChecklistRow
              ok={sizeChartOk}
              warn={!sizeChartOk}
              label="Size charts"
              detail={!sc.enabled ? "disabled" : `${sc.sizeChartCount}/${sc.sizeChartRequired} size charts (append after mockups)`}
            />
            <ChecklistRow
              ok={totalMissingTitle === 0 && totalMissingTags === 0 && totalMissingSku === 0 && totalInvalidPrice === 0}
              warn={false}
              label="Title / tags / SKU / price"
              detail={
                totalMissingTitle === 0 && totalMissingTags === 0 && totalMissingSku === 0 && totalInvalidPrice === 0
                  ? "all rows have title, tags, SKU and valid price"
                  : `${totalMissingTitle} missing title, ${totalMissingSku} missing SKU, ${totalMissingTags} missing tags, ${totalInvalidPrice} invalid price`
              }
            />
            <ChecklistRow
              ok
              warn={false}
              label="Duplicate protection"
              detail={totalDuplicates > 0 ? `active — ${totalDuplicates} already-created row(s) will be skipped` : "active — no duplicates detected"}
            />
          </div>

          {/* Presets */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px]">
              <p className="text-slate-500 uppercase tracking-wide text-[9px] font-semibold mb-1">Description Template</p>
              {result.globalPreset.hasTemplate
                ? <p className="text-emerald-400">✓ {result.globalPreset.descriptionTemplateLength} chars</p>
                : <p className="text-amber-400">⚠ Not set — title only</p>}
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px]">
              <p className="text-slate-500 uppercase tracking-wide text-[9px] font-semibold mb-1">Variations</p>
              {result.variationPreset.enabled
                ? result.variationPreset.ready
                  ? <p className="text-emerald-400">✓ {result.variationPreset.combinationCount} combos</p>
                  : <p className="text-amber-400">⚠ Issues</p>
                : <p className="text-slate-400">Disabled</p>}
            </div>
            <div className={`rounded border px-3 py-2 text-[10px] ${
              sc.enabled && sc.sizeChartCount < sc.sizeChartRequired
                ? "border-red-500/[0.2] bg-red-500/[0.07]"
                : "border-white/[0.08] bg-white/[0.03]"
            }`}>
              <p className="text-slate-500 uppercase tracking-wide text-[9px] font-semibold mb-1">Supplemental Images</p>
              {sc.enabled
                ? <>
                    <p className={sc.filesAvailable > 0 ? "text-emerald-400" : "text-amber-400"}>
                      {sc.filesAvailable > 0 ? `✓ ${sc.filesAvailable} files` : "⚠ No files found"}
                    </p>
                    <p className={sc.sizeChartCount < sc.sizeChartRequired ? "text-red-400 font-semibold mt-0.5" : "text-slate-500 mt-0.5"}>
                      {sc.sizeChartCount < sc.sizeChartRequired
                        ? `✗ Size charts: ${sc.sizeChartCount}/${sc.sizeChartRequired} required`
                        : `✓ Size charts: ${sc.sizeChartCount}/${sc.sizeChartRequired}`}
                    </p>
                  </>
                : <p className="text-slate-400">Disabled</p>}
            </div>
          </div>

          {/* Manifest errors */}
          {result.manifestErrors.length > 0 && (
            <div className="space-y-0.5">
              {result.manifestErrors.map((e, i) => <p key={i} className="text-[9px] text-red-400 font-mono">✗ {e}</p>)}
            </div>
          )}

          {/* Per-store detail */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Per-store detail</p>
            {result.storeResults.map((s) => <StoreValidationCard key={s.storeFolder} store={s} />)}
            {result.storeResults.length === 0 && (
              <p className="text-[10px] text-slate-400 text-center">
                No stores in manifest. Connect stores and save Etsy IDs in{" "}
                <a href="/stores" className="text-slate-500 underline hover:text-slate-200">Stores →</a>
              </p>
            )}
          </div>

          {/* Result banner + Move to inQueue */}
          <div className="pt-2 border-t border-white/[0.07] space-y-3">
            {passed ? (
              <div className="rounded border border-emerald-500/[0.2] bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-300 font-semibold">
                ✓ Batch validation passed — {storesReady.length} store{storesReady.length !== 1 ? "s" : ""} ready, est. {totalEstimated} draft{totalEstimated !== 1 ? "s" : ""}.
              </div>
            ) : (
              <div data-testid="validation-blocked" className="rounded border border-red-500/[0.2] bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-300">
                ✗ Fix needed before this batch can move to inQueue. {blockReason}
              </div>
            )}

            <button
              data-testid="move-to-inqueue-button"
              onClick={onMoveToInQueue}
              disabled={!passed || moving}
              title={passed ? "Add this validated batch to the inQueue pool" : blockReason}
              className={`w-full px-4 py-3.5 text-[14px] flex items-center justify-center gap-2 ${PRIMARY_BTN}`}
            >
              {moving ? <><Spinner /> Moving…</> : "Move to inQueue"}
            </button>
            {!passed && (
              <p data-testid="move-disabled-reason" className="text-[10px] text-slate-400 text-center">{blockReason}</p>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-slate-400 justify-center">
              <span>Creates Etsy drafts only.</span>
              <span>Max 30 listings per store.</span>
              <span>Duplicates are skipped automatically.</span>
              <span>Upload runs later from the inQueue pool.</span>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
