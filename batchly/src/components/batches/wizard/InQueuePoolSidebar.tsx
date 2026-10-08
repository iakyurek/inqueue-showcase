"use client";

import {
  LocalBatch,
  Spinner,
  PoolStatusChip,
  poolStatusFor,
  PRIMARY_BTN,
} from "./shared";

// ---------------------------------------------------------------------------
// Right-side inQueue Pool sidebar — persistent while a wizard step is active.
// Shows all batches currently inQueue with their lifecycle status. Ready
// batches expose the single "Upload Listings" action (draft-only). Non-ready
// batches expose a small "Validate" affordance so pre-existing pool batches
// aren't stranded. PoolCard is shared with InQueuePoolBoard (the home view).
// ---------------------------------------------------------------------------

export function PoolCard({
  batch,
  running,
  uploading,
  removing,
  onUpload,
  onValidate,
  onRemove,
  onViewReport,
}: {
  batch: LocalBatch;
  running: boolean;
  uploading: boolean;
  removing: boolean;
  onUpload: (batch: LocalBatch) => void;
  onValidate: (batch: LocalBatch) => void;
  onRemove: (batch: LocalBatch) => void;
  onViewReport: (batch: LocalBatch) => void;
}) {
  const status = poolStatusFor(batch, running || uploading);
  const stores = batch.storeFoldersFound.length > 0 ? batch.storeFoldersFound.join(", ") : "No stores detected";
  const busy = running || uploading || removing;

  return (
    <div
      data-testid={`pool-card-${batch.folderName}`}
      data-status={status}
      className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] text-slate-200 font-mono font-semibold truncate min-w-0">{batch.folderName}</p>
        <PoolStatusChip status={status} />
      </div>

      <div className="grid grid-cols-2 gap-1 text-[9px] text-slate-500">
        <span className="truncate" title={stores}>Stores: <span className="text-slate-400">{stores}</span></span>
        <span>Listings: <span className="text-slate-400">{batch.listingCount}</span></span>
        <span>Validation: <span className="text-slate-400">{batch.validationStatus.replace(/_/g, " ")}</span></span>
        <span className="truncate" title={batch.skuRangeSummary}>SKUs: <span className="text-slate-400">{batch.skuRangeSummary || "—"}</span></span>
      </div>

      {batch.errors[0] && (
        <p className="text-[9px] text-red-300 truncate" title={batch.errors[0]}>⚠ {batch.errors[0]}</p>
      )}

      <div className="flex flex-col gap-1.5 pt-0.5">
        {status === "Ready" && (
          <button
            data-testid={`upload-listings-button-${batch.folderName}`}
            onClick={() => onUpload(batch)}
            disabled={busy}
            className={`w-full px-3 py-1.5 text-[11px] flex items-center justify-center gap-1.5 ${PRIMARY_BTN}`}
          >
            {uploading ? <><Spinner /> Uploading…</> : "Upload Listings"}
          </button>
        )}
        {status === "Run Complete" && (
          <button
            data-testid={`view-report-button-${batch.folderName}`}
            onClick={() => onViewReport(batch)}
            disabled={busy}
            className="w-full px-3 py-1.5 rounded border border-sky-500/[0.35] bg-sky-500/[0.1] text-[11px] text-sky-200 font-semibold hover:bg-sky-500/[0.16] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            View Run Report
          </button>
        )}
        {(status === "Validating" || status === "Needs Attention") && batch.hasManifest && (
          <button
            data-testid={`revalidate-button-${batch.folderName}`}
            onClick={() => onValidate(batch)}
            disabled={busy}
            className="w-full px-3 py-1.5 rounded border border-white/[0.12] bg-white/[0.06] text-[11px] text-slate-200 font-semibold hover:bg-white/[0.1] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Validate
          </button>
        )}
        <button
          data-testid={`remove-button-${batch.folderName}`}
          onClick={() => onRemove(batch)}
          disabled={busy}
          className="w-full px-3 py-1 rounded border border-white/[0.08] bg-transparent text-[10px] text-slate-500 hover:text-red-300 hover:border-red-500/[0.3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Remove from inQueue
        </button>
      </div>
    </div>
  );
}

export function InQueuePoolSidebar({
  batches,
  loading,
  runningBatchFolder,
  uploadingBatch,
  removingBatch,
  onUpload,
  onValidate,
  onRemove,
  onViewReport,
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
}) {
  return (
    <aside
      data-testid="inqueue-pool-sidebar"
      className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm overflow-hidden lg:sticky lg:top-4 self-start"
    >
      <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
        <div>
          <p className="text-[13px] font-semibold text-slate-200">inQueue Pool</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Validated batches ready to upload</p>
        </div>
        <span className="text-[10px] text-slate-500 border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 rounded">{batches.length}</span>
      </div>
      <div className="px-3 py-3 space-y-2.5 max-h-[calc(100vh-8rem)] overflow-y-auto">
        {loading && batches.length === 0 && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 px-1"><Spinner /> Loading…</div>
        )}
        {!loading && batches.length === 0 && (
          <div className="text-center py-6">
            <p className="text-[11px] text-slate-500">No batches inQueue.</p>
            <p className="text-[10px] text-slate-400 mt-1">Validate a batch to add it here.</p>
          </div>
        )}
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
    </aside>
  );
}
