"use client";

import { useState } from "react";
import { LocalBatch, BatchStatusPill, Spinner, Panel } from "./shared";

// ---------------------------------------------------------------------------
// Completed Batches — promoted to a top-level home-view section (it used to be
// a collapsed panel inside the start step, so it vanished mid-wizard). Open by
// default, newest first, latest 5 with a "Show all" toggle.
// ---------------------------------------------------------------------------

const PREVIEW_COUNT = 5;

function CompletedBatchRow({ batch, onViewRunReport }: { batch: LocalBatch; onViewRunReport: (batch: LocalBatch) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] text-slate-300 font-mono font-semibold truncate">{batch.folderName}</p>
          <BatchStatusPill status="completed" />
        </div>
        <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-500 mt-0.5">
          <span>{batch.completedListingCount}/{batch.listingCount} drafts recorded</span>
          {batch.completedAt && <span>completed {new Date(batch.completedAt).toLocaleString()}</span>}
        </div>
      </div>
      {batch.latestRunId && (
        <button
          onClick={() => onViewRunReport(batch)}
          className="shrink-0 px-3 py-1.5 rounded border border-white/[0.1] bg-white/[0.05] text-[11px] text-slate-300 hover:bg-white/[0.09] hover:text-slate-100 transition-colors"
        >
          View Run Report
        </button>
      )}
    </div>
  );
}

export function CompletedBatches({
  batches,
  loading,
  onViewRunReport,
}: {
  batches: LocalBatch[];
  loading: boolean;
  onViewRunReport: (batch: LocalBatch) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const completedBatches = batches
    .filter((batch) => batch.queueSection === "completed")
    .sort((a, b) =>
      Date.parse(b.completedAt ?? b.lastUpdatedAt ?? "") - Date.parse(a.completedAt ?? a.lastUpdatedAt ?? ""));
  const visible = showAll ? completedBatches : completedBatches.slice(0, PREVIEW_COUNT);

  return (
    <Panel testId="completed-batches-section">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-white/[0.04] transition-colors"
      >
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-slate-200">Completed Batches</p>
            <span className="text-[10px] text-slate-500 border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 rounded">{completedBatches.length}</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Uploaded and fully processed batches, newest first</p>
        </div>
        <span className="text-slate-400 text-xs shrink-0 ml-3 font-medium">{open ? "Close ‹" : "Open ›"}</span>
      </button>
      {open && (
        <div className="border-t border-white/[0.07] px-5 py-4">
          {loading && completedBatches.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Loading…</div>
          )}
          {!loading && completedBatches.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">No completed batches yet.</p>
          ) : (
            <div className="space-y-2">
              {visible.map((batch) => (
                <CompletedBatchRow key={batch.folderName} batch={batch} onViewRunReport={onViewRunReport} />
              ))}
              {completedBatches.length > PREVIEW_COUNT && (
                <button
                  onClick={() => setShowAll((value) => !value)}
                  className="w-full px-3 py-1.5 rounded border border-white/[0.08] bg-transparent text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] transition-colors"
                >
                  {showAll ? "Show latest 5" : `Show all ${completedBatches.length}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
