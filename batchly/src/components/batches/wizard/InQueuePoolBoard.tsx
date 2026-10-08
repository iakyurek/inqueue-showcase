"use client";

import { LocalBatch, Spinner, PRIMARY_BTN } from "./shared";
import { PoolCard } from "./InQueuePoolSidebar";

// ---------------------------------------------------------------------------
// Home-view inQueue Pool board — the main attraction of the batches page.
// Batches exported from Preply land here automatically (downloaded + validated
// in the background); the manual Drive-scan wizard is tucked behind the small
// "Upload a batch manually" button in the header. Renders the same PoolCards
// as the mid-wizard sidebar, just in a wide responsive grid.
// ---------------------------------------------------------------------------

export function InQueuePoolBoard({
  batches,
  loading,
  runningBatchFolder,
  uploadingBatch,
  removingBatch,
  onUpload,
  onValidate,
  onRemove,
  onViewReport,
  onRefresh,
  driveConnected,
  onManualUpload,
}: {
  batches: LocalBatch[];
  loading: boolean;
  runningBatchFolder: string | null;
  uploadingBatch: string | null;
  removingBatch: string | null;
  onUpload: (batch: LocalBatch) => void;
  onValidate: (batch: LocalBatch) => void;
  onRemove: (batch: LocalBatch) => void;
  onViewReport: (batch: LocalBatch) => void;
  onRefresh: () => void;
  driveConnected: boolean;
  onManualUpload: () => void;
}) {
  return (
    <section
      data-testid="inqueue-pool-board"
      className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold text-slate-100">inQueue Pool</p>
            <span className="text-[10px] text-slate-500 border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 rounded">
              {batches.length}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Batches exported from Preply appear here automatically, validated and ready to upload.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            data-testid="refresh-pool-button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-1.5 rounded border border-white/[0.1] bg-white/[0.04] text-[11px] text-slate-300 font-semibold hover:bg-white/[0.08] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {loading && <Spinner />} Refresh
          </button>
          <button
            data-testid="start-batch-button"
            onClick={onManualUpload}
            disabled={!driveConnected}
            title={
              driveConnected
                ? "Scan Google Drive and import a batch by hand"
                : "Connect Google Drive before importing a batch."
            }
            className={`px-3 py-1.5 text-[11px] ${PRIMARY_BTN}`}
          >
            Upload a batch manually
          </button>
        </div>
      </div>

      <div className="px-4 py-4">
        {loading && batches.length === 0 && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1">
            <Spinner /> Loading…
          </div>
        )}
        {!loading && batches.length === 0 && (
          <div className="text-center py-10">
            <p className="text-[13px] text-slate-400">No batches inQueue.</p>
            <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
              Export a batch from Preply and it will show up here on its own — or use
              &quot;Upload a batch manually&quot; to import one from Google Drive.
            </p>
            {!driveConnected && (
              <p className="text-[10px] text-slate-500 mt-2">
                Google Drive is not connected.{" "}
                <a href="/settings" className="text-slate-300 underline hover:text-slate-100 transition-colors">
                  Go to Settings → Connect Google Drive
                </a>
              </p>
            )}
          </div>
        )}
        {batches.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {batches.map((batch) => (
              <PoolCard
                key={batch.folderName}
                batch={batch}
                running={runningBatchFolder === batch.folderName}
                uploading={uploadingBatch === batch.folderName}
                removing={removingBatch === batch.folderName}
                onUpload={onUpload}
                onValidate={onValidate}
                onRemove={onRemove}
                onViewReport={onViewReport}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
