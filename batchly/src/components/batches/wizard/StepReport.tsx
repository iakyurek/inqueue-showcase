"use client";

import { useState } from "react";
import {
  BatchRunProgress,
  BatchRunRowProgress,
  BatchRunStoreProgress,
  LocalBatch,
  StatusBadge,
  BatchStatusPill,
  BatchFact,
  ProgressBar,
  RowStatusDot,
  Spinner,
  Panel,
} from "./shared";

// ---------------------------------------------------------------------------
// Step 5 — Report
// Live progress while the run steps, then the final run report with
// Confirm-Complete and Start New Batch actions.
// ---------------------------------------------------------------------------

function RowTable({ rows }: { rows: BatchRunRowProgress[] }) {
  const activeRow = rows.find((r) => r.status === "running");
  const terminalRows = rows.filter((r) => ["created", "partial", "failed", "duplicate", "skipped"].includes(r.status));

  return (
    <div className="space-y-1">
      {activeRow && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.04] border border-white/[0.1] text-[9px]">
          <Spinner />
          <span className="font-mono text-blue-300 font-semibold">{activeRow.designId}</span>
          {activeRow.sku && <span className="text-slate-500">{activeRow.sku}</span>}
          {activeRow.title && <span className="text-slate-500 truncate max-w-[180px]">{activeRow.title}</span>}
        </div>
      )}
      {terminalRows.map((r) => (
        <div key={r.rowId} className="flex items-start gap-2 px-2 py-1 text-[9px]">
          <RowStatusDot status={r.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-slate-500 font-semibold">{r.designId}</span>
              {r.sku && <span className="text-slate-400">{r.sku}</span>}
              <StatusBadge status={r.status} />
              {r.listingId && (
                <span className="text-emerald-400 font-mono select-all cursor-text" title="Etsy listing ID">
                  {r.listingId}
                </span>
              )}
            </div>
            {r.title && r.status !== "queued" && (
              <p className="text-slate-400 truncate max-w-[300px] mt-0.5">{r.title}</p>
            )}
            {r.status === "created" && r.imagesAttempted > 0 && (
              <p className="text-slate-400 mt-0.5">
                Images: {r.imagesUploaded}/{r.imagesAttempted}
                {r.imagesUploaded < r.imagesAttempted && <span className="text-amber-400"> (partial)</span>}
                {r.variationInventoryStatus === "created" && <span className="text-sky-400"> · variations ✓</span>}
                {r.supplementalImageStatus === "uploaded" && <span className="text-emerald-400"> · supplemental ✓</span>}
              </p>
            )}
            {r.errors.length > 0 && (
              <div className="mt-0.5 space-y-0.5">
                {r.errors.map((e, i) => (
                  <p key={i} className="text-red-400 font-mono break-all">✗ {e}</p>
                ))}
              </div>
            )}
            {r.warnings.length > 0 && r.warnings.map((w, i) => (
              <p key={i} className="text-amber-400 mt-0.5">⚠ {w}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StoreProgressCard({ store, currentDesignId, running }: { store: BatchRunStoreProgress; currentDesignId: string | null; running: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (store.status === "skipped") {
    return (
      <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="font-mono text-slate-500 font-semibold w-16">{store.storeFolder}</span>
          <StatusBadge status="skipped" />
          {store.skipReason && <span className="text-slate-400 italic">{store.skipReason}</span>}
        </div>
      </div>
    );
  }

  const queuedCount = store.rows.filter((r) => r.status === "queued").length;
  const total = store.rows.length;
  const done = store.rows.filter((r) => ["created", "partial", "failed", "duplicate", "skipped"].includes(r.status)).length;
  const storePct = total > 0 ? Math.round((done / total) * 100) : 0;
  const isActiveStore = running && store.rows.some((r) => r.status === "running");

  const borderCls =
    store.status === "completed" ? "border-emerald-500/[0.2]"
    : store.status === "partial" ? "border-amber-500/[0.2]"
    : store.status === "failed" ? "border-red-500/[0.2]"
    : isActiveStore ? "border-white/[0.1]"
    : "border-white/[0.08]";

  return (
    <div className={`rounded-lg border ${borderCls} bg-[#1b1e27] overflow-hidden`}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none hover:bg-white/[0.04] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`text-[11px] font-mono font-bold w-16 shrink-0 ${isActiveStore ? "text-blue-400" : "text-slate-300"}`}>
          {store.storeFolder}
        </span>
        <StatusBadge status={isActiveStore ? "running" : store.status} />

        {isActiveStore && store.rows.find((r) => r.status === "running") && (
          <span className="text-[9px] text-blue-400 flex items-center gap-1">
            <Spinner />
            {store.rows.find((r) => r.status === "running")?.designId}
          </span>
        )}
        {!isActiveStore && store.status === "queued" && queuedCount > 0 && (
          <span className="text-[9px] text-slate-500">{queuedCount} queued</span>
        )}

        <div className="flex-1 flex flex-wrap gap-x-2 gap-y-0 text-[9px] justify-end">
          {store.created > 0 && <span className="text-emerald-400">{store.created} created</span>}
          {store.partial > 0 && <span className="text-amber-400">{store.partial} partial</span>}
          {store.failed > 0 && <span className="text-red-400">{store.failed} failed</span>}
          {store.skipped > 0 && <span className="text-blue-400">{store.skipped} skip</span>}
        </div>

        <div className="flex gap-0.5 flex-wrap max-w-[100px] shrink-0">
          {store.rows.map((r) => (
            <RowStatusDot
              key={r.rowId}
              status={running && r.designId === currentDesignId ? "running" : r.status}
            />
          ))}
        </div>

        <span className="text-[9px] text-slate-400 shrink-0">{expanded ? "▾" : "▸"}</span>
      </div>

      {store.status === "running" || store.status === "completed" || store.status === "partial" ? (
        <div className="px-3 pb-1">
          <ProgressBar percent={storePct} status={store.status} thin />
        </div>
      ) : null}

      {expanded && (
        <div className="border-t border-white/[0.07] px-3 py-2">
          <RowTable rows={store.rows} />
        </div>
      )}
    </div>
  );
}

function RunReport({ progress }: { progress: BatchRunProgress }) {
  const rows = progress.stores.flatMap((store) =>
    store.rows.map((row) => ({ ...row, storeFolder: store.storeFolder, storeName: store.storeName })),
  );
  const listingRows = rows.filter((row) => row.listingId);
  const totalMockups = rows.reduce((sum, row) => sum + row.imagesUploaded, 0);
  const totalSupplemental = rows.reduce((sum, row) => sum + row.supplementalImagesUploaded, 0);
  const totalImages = totalMockups + totalSupplemental;
  const safeToComplete = progress.status === "completed" && progress.failed === 0 && progress.partial === 0;

  return (
    <div data-testid="run-report" className="rounded-xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-200">Run Report</p>
          <p className="text-[10px] text-slate-500 font-mono">{progress.batchFolder} · run {progress.runId.slice(0, 8)}</p>
        </div>
        <BatchStatusPill status={safeToComplete ? "Draft-only verified path" : "Needs Attention"} />
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <BatchFact label="Attempted" value={`${progress.attempted}/${progress.totalRows}`} />
          <BatchFact label="Drafts created" value={`${progress.created}`} tone={progress.created > 0 ? "good" : undefined} />
          <BatchFact label="Skipped" value={`${progress.skipped}`} />
          <BatchFact label="Failed" value={`${progress.failed}`} tone={progress.failed > 0 ? "bad" : "good"} />
          <BatchFact label="Images" value={`${totalImages} final`} tone={totalImages > 0 ? "good" : "warn"} />
        </div>

        {listingRows.length > 0 && (
          <div className="rounded border border-white/[0.08] overflow-hidden">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-white/[0.07] bg-white/[0.05] text-slate-500">
                  <th className="px-2 py-1.5 text-left font-normal">Store</th>
                  <th className="px-2 py-1.5 text-left font-normal">Design</th>
                  <th className="px-2 py-1.5 text-left font-normal">SKU</th>
                  <th className="px-2 py-1.5 text-left font-normal">Title</th>
                  <th className="px-2 py-1.5 text-right font-normal">Images</th>
                  <th className="px-2 py-1.5 text-left font-normal">Draft ID</th>
                </tr>
              </thead>
              <tbody>
                {listingRows.map((row) => (
                  <tr key={row.rowId} className="border-b border-white/[0.07] last:border-0">
                    <td className="px-2 py-1.5 text-slate-400 font-mono">{row.storeFolder}</td>
                    <td className="px-2 py-1.5 text-slate-400 font-mono">{row.designId}</td>
                    <td className="px-2 py-1.5 text-slate-300">{row.sku ?? "—"}</td>
                    <td className="px-2 py-1.5 text-slate-300 max-w-[220px] truncate" title={row.title ?? ""}>{row.title ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right text-slate-400">
                      {row.imagesUploaded} mockup{row.imagesUploaded !== 1 ? "s" : ""} + {row.supplementalImagesUploaded} chart/supp.
                    </td>
                    <td className="px-2 py-1.5">
                      <a
                        href={`https://www.etsy.com/listing/${row.listingId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 underline font-mono"
                      >
                        {row.listingId}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.some((row) => row.errors.length > 0 || row.warnings.length > 0) && (
          <div className="space-y-1">
            {rows.flatMap((row) => [
              ...row.errors.map((error) => ({ row, type: "error" as const, text: error })),
              ...row.warnings.map((warning) => ({ row, type: "warning" as const, text: warning })),
            ]).map((item, index) => (
              <p key={index} className={`text-[10px] font-mono ${item.type === "error" ? "text-red-400" : "text-amber-300"}`}>
                {item.row.storeFolder}/{item.row.designId}: {item.text}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StepReport({
  progress,
  running,
  onRetryFailed,
  onRefresh,
  retrying,
  batch,
  onConfirmComplete,
  completing,
  onStartNew,
}: {
  progress: BatchRunProgress;
  running: boolean;
  onRetryFailed: () => void;
  onRefresh: () => void;
  retrying: boolean;
  batch: LocalBatch | null;
  onConfirmComplete: (batch: LocalBatch) => void;
  completing: boolean;
  onStartNew: () => void;
}) {
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const isDone = ["completed", "partial", "failed", "canceled"].includes(progress.status);
  // Only failed rows (no listingId) are retriable. Partial rows have a listing and need manual Etsy review.
  const retriableCount = progress.failed;
  const partialManualCount = progress.partial;
  const totalListingIds = progress.stores.flatMap((s) =>
    s.rows.filter((r) => r.listingId).map((r) => r.listingId!),
  );

  const statusLabel =
    progress.status === "completed" ? "Run completed"
    : progress.status === "partial" ? "Run completed with issues"
    : progress.status === "failed" ? "Run failed"
    : progress.status === "running" ? "Run in progress"
    : progress.status === "queued" ? "Run queued"
    : progress.status;

  // Zero-row run: everything was a duplicate or ineligible.
  if (progress.totalRows === 0) {
    return (
      <div data-testid="step-report">
        <Panel>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-200">Batch Run</span>
              <StatusBadge status="completed" />
            </div>
            <p className="text-xs text-slate-500">
              No new listings to create for <span className="font-mono text-slate-300">{progress.batchFolder}</span>.
            </p>
            <p className="text-[10px] text-slate-400">
              All eligible rows are already created (duplicates) or were skipped. If you expected rows, check validation — some stores may need IDs configured.
            </p>
            <button
              data-testid="start-new-batch-button"
              onClick={onStartNew}
              className="px-4 py-2 rounded-lg border border-white/[0.1] bg-white/[0.06] text-xs text-slate-200 font-semibold hover:bg-white/[0.1] transition-colors"
            >
              ← Start a New Batch
            </button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div data-testid="step-report">
      <Panel>
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[14px] font-semibold text-slate-200">Batch Run Progress</span>
              <StatusBadge status={progress.status} />
              {running && <Spinner />}
            </div>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              {progress.batchFolder} · run <span className="select-all">{progress.runId.slice(0, 8)}</span>
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={running}
            className="shrink-0 px-2.5 py-1 rounded border border-white/[0.08] text-xs text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40"
          >
            Refresh
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* Overall progress */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <div className="text-slate-500 space-y-0.5">
                <p>{statusLabel}</p>
                {running && progress.currentStore && (
                  <p className="text-blue-400">
                    ▶ {progress.currentStore}
                    {progress.currentDesignId ? ` / ${progress.currentDesignId}` : ""}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-200">{progress.percentComplete}%</p>
                <p className="text-slate-400">{progress.attempted} / {progress.totalRows} rows</p>
              </div>
            </div>
            <ProgressBar percent={progress.percentComplete} status={progress.status} />
          </div>

          {/* Count cards */}
          <div className="grid grid-cols-4 gap-2">
            <div className={`rounded border px-2 py-2 text-center ${progress.created > 0 ? "border-emerald-500/[0.2] bg-emerald-500/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Created</p>
              <p className={`font-semibold text-base mt-0.5 ${progress.created > 0 ? "text-emerald-400" : "text-slate-500"}`}>{progress.created}</p>
            </div>
            <div className={`rounded border px-2 py-2 text-center ${progress.partial > 0 ? "border-amber-500/[0.2] bg-amber-500/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Partial</p>
              <p className={`font-semibold text-base mt-0.5 ${progress.partial > 0 ? "text-amber-400" : "text-slate-500"}`}>{progress.partial}</p>
            </div>
            <div className={`rounded border px-2 py-2 text-center ${progress.failed > 0 ? "border-red-500/[0.2] bg-red-500/[0.07]" : "border-white/[0.08] bg-white/[0.03]"}`}>
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Failed</p>
              <p className={`font-semibold text-base mt-0.5 ${progress.failed > 0 ? "text-red-400" : "text-slate-500"}`}>{progress.failed}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-center">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">Skipped</p>
              <p className="text-slate-500 font-semibold text-base mt-0.5">{progress.skipped}</p>
            </div>
          </div>

          {/* Per-store cards */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Per-Store Progress</p>
            {progress.stores.map((s) => (
              <StoreProgressCard
                key={s.storeRunId}
                store={s}
                currentDesignId={progress.currentDesignId}
                running={running}
              />
            ))}
          </div>

          {/* Completion screen */}
          {isDone && (
            <div className="space-y-3 pt-2 border-t border-white/[0.07]">
              <RunReport progress={progress} />

              {progress.created > 0 && (
                <div className="rounded border border-emerald-500/[0.2] bg-emerald-500/[0.07] px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-emerald-300">
                    {progress.created} draft listing{progress.created !== 1 ? "s" : ""} created
                  </p>
                  <p className="text-[10px] text-emerald-500">
                    Review at least one draft per store in Etsy before publishing. Go to Etsy Seller Dashboard → Listings → Drafts.
                  </p>
                  {totalListingIds.length > 0 && (
                    <div>
                      <p className="text-[9px] text-slate-500 mb-1">Listing IDs (click to select all):</p>
                      <p className="text-[9px] text-emerald-400 font-mono select-all cursor-text break-all bg-white/[0.06] rounded px-2 py-1">
                        {totalListingIds.join(", ")}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {partialManualCount > 0 && (
                <div className="rounded border border-amber-500/[0.2] bg-amber-500/[0.07] px-4 py-3 space-y-1">
                  <p className="text-sm font-semibold text-yellow-300">
                    ⚠ {partialManualCount} partial row{partialManualCount !== 1 ? "s" : ""} — manual Etsy review needed
                  </p>
                  <p className="text-[10px] text-amber-400">
                    These drafts were created in Etsy but image upload, variation inventory, or supplemental images failed.
                    The listings exist — go to Etsy Seller Dashboard → Listings → Drafts and complete them manually.
                    Retrying is not safe because it would attempt to create duplicate drafts.
                  </p>
                  {progress.stores.flatMap((s) =>
                    s.rows.filter((r) => r.status === "partial" && r.listingId).map((r) => (
                      <p key={r.rowId} className="text-[9px] font-mono text-amber-400">
                        {r.designId} — listing <span className="select-all">{r.listingId}</span>
                        {r.errors.length > 0 && <span className="text-yellow-600"> ({r.errors[0]})</span>}
                      </p>
                    ))
                  )}
                </div>
              )}

              {retriableCount > 0 && (
                showRetryConfirm ? (
                  <div className="rounded border border-red-500/[0.2] bg-red-500/[0.07] px-4 py-3 space-y-3">
                    <p className="text-sm font-semibold text-red-300">
                      Retry {retriableCount} failed row{retriableCount !== 1 ? "s" : ""}?
                    </p>
                    <p className="text-[10px] text-slate-500">
                      These rows failed before a draft was created. They will be reset to queued and re-processed.
                      Already-created rows are not affected. Duplicate protection is active.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowRetryConfirm(false)}
                        disabled={retrying}
                        className="flex-1 px-3 py-2 rounded border border-white/[0.08] bg-white/[0.06] text-sm text-slate-300 hover:bg-white/[0.1] transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { setShowRetryConfirm(false); onRetryFailed(); }}
                        disabled={retrying}
                        className="flex-1 px-3 py-2 rounded border border-red-700 bg-red-900/40 text-sm text-red-300 font-semibold hover:bg-red-900/60 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {retrying ? <><Spinner /> Starting retry…</> : `↺ Retry ${retriableCount} Failed Row${retriableCount !== 1 ? "s" : ""}`}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRetryConfirm(true)}
                    disabled={retrying}
                    className="w-full px-4 py-2.5 rounded border border-red-500/[0.2] bg-red-500/[0.07] text-sm text-red-300 font-semibold hover:bg-red-500/[0.12] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {retrying ? <><Spinner /> Preparing retry…</> : `↺ Retry ${retriableCount} Failed Row${retriableCount !== 1 ? "s" : ""} (no listing created)`}
                  </button>
                )
              )}

              {retriableCount === 0 && partialManualCount === 0 && progress.created === 0 && (
                <p className="text-[10px] text-slate-500 text-center italic">No new listings were created. All rows were duplicates or ineligible.</p>
              )}

              {/* Final workflow actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                {batch?.canConfirmComplete && (
                  <button
                    data-testid="confirm-complete-button"
                    onClick={() => onConfirmComplete(batch)}
                    disabled={completing}
                    className="flex-1 px-4 py-2.5 rounded-lg border border-sky-500/[0.35] bg-sky-500/[0.1] text-[13px] text-sky-200 font-semibold hover:bg-sky-500/[0.16] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {completing ? <><Spinner /> Moving…</> : "Confirm and Move to Completed Batches"}
                  </button>
                )}
                <button
                  data-testid="start-new-batch-button"
                  onClick={onStartNew}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/[0.1] bg-white/[0.06] text-[13px] text-slate-200 font-semibold hover:bg-white/[0.1] transition-colors"
                >
                  ← Start a New Batch
                </button>
              </div>
            </div>
          )}

        </div>
      </Panel>
    </div>
  );
}
