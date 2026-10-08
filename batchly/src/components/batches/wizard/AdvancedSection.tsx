"use client";

import { useState } from "react";
import {
  ReadinessData,
  RecentRun,
  StatusBadge,
} from "./shared";

// ---------------------------------------------------------------------------
// Advanced / Debug — collapsed by default. Read-only tools: run history,
// readiness detail, manual refresh. Nothing here can start a run.
// ---------------------------------------------------------------------------

export function AdvancedSection({
  runs,
  onSelectRun,
  activeRunId,
  onRefreshBatches,
  loading,
  readiness,
}: {
  runs: RecentRun[];
  onSelectRun: (runId: string) => void;
  activeRunId: string | null;
  onRefreshBatches: () => void;
  loading: boolean;
  readiness: ReadinessData | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div data-testid="advanced-section" className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
      >
        <div>
          <p className="text-[13px] font-semibold text-slate-200">Advanced / Debug</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Run history, system readiness detail, manual refresh</p>
        </div>
        <span className="text-slate-400 text-xs shrink-0 ml-3 font-medium">{open ? "Close ‹" : "Open ›"}</span>
      </button>

      {open && (
        <div className="border-t border-white/[0.07] px-4 py-4 space-y-4">
          {/* Readiness detail */}
          {readiness && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">System Readiness</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  {
                    label: "Google Drive",
                    value: readiness.driveStatusLabel ?? (readiness.driveConnected ? "Connected" : "Not connected"),
                    ok: readiness.driveConnected,
                  },
                  {
                    label: "Stores connected",
                    value: `${readiness.connectedStoreCount} store${readiness.connectedStoreCount !== 1 ? "s" : ""}`,
                    ok: readiness.connectedStoreCount > 0,
                  },
                  {
                    label: "Ready stores",
                    value: `${readiness.readyStoreCount} ready`,
                    ok: readiness.readyStoreCount > 0,
                  },
                  {
                    label: "Local batches",
                    value: `${readiness.localBatchCount}`,
                    ok: true,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className={`rounded-lg border px-3 py-2 ${item.ok ? "border-white/[0.07] bg-white/[0.03]" : "border-amber-500/[0.2] bg-amber-950/[0.2]"}`}
                  >
                    <p className="text-[10px] text-slate-500 font-medium">{item.label}</p>
                    <p className={`mt-0.5 text-[11px] font-semibold ${item.ok ? "text-slate-300" : "text-amber-400"}`}>{item.value}</p>
                  </div>
                ))}
              </div>
              {readiness.connectedStores && readiness.connectedStores.length > 0 && (
                <p className="text-[10px] text-slate-500">
                  {readiness.connectedStores.map((store) => `${store.etsyShopName ?? store.name} / ${store.driveFolderName}`).join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Manual refresh */}
          <div className="flex items-center gap-3">
            <button
              onClick={onRefreshBatches}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[11px] text-slate-500 hover:text-slate-200 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh batch list"}
            </button>
            <p className="text-[10px] text-slate-500">Reloads local batches and readiness data.</p>
          </div>

          {/* Run history */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Run History</p>
            {runs.length === 0 && <p className="text-[10px] text-slate-500">No runs recorded yet.</p>}
            {runs.map((run) => {
              const isActive = run.id === activeRunId;
              return (
                <div
                  key={run.id}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border cursor-pointer transition-all ${
                    isActive
                      ? "border-white/[0.12] bg-white/[0.05]"
                      : "border-white/[0.08] hover:border-white/[0.12] hover:bg-white/[0.04]"
                  }`}
                  onClick={() => onSelectRun(run.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-slate-400 select-all">{run.id.slice(0, 8)}</span>
                      <StatusBadge status={run.status} />
                      <span className="text-[11px] font-mono text-slate-300 font-medium truncate">{run.batchFolder}</span>
                    </div>
                    <div className="flex gap-x-3 text-[10px] text-slate-400 mt-0.5 flex-wrap">
                      <span>{new Date(run.startedAt).toLocaleString()}</span>
                      <span className="text-emerald-400 font-medium">{run.created} created</span>
                      {run.failed > 0 && <span className="text-red-400 font-medium">{run.failed} failed</span>}
                      <span>{run.totalRows} rows</span>
                      {run.stores.length > 0 && (
                        <span className="text-slate-500">{run.stores.map((s) => s.storeFolder).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  {isActive && <span className="text-[10px] text-sky-400 font-medium shrink-0">viewing</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
