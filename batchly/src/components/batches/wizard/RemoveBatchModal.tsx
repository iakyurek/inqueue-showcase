"use client";

import { LocalBatch, Spinner } from "./shared";

export function RemoveBatchModal({
  batch,
  onConfirm,
  onCancel,
  removing,
}: {
  batch: LocalBatch;
  onConfirm: () => void;
  onCancel: () => void;
  removing: boolean;
}) {
  const hasCreatedDraftRecords = batch.completedListingCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="remove-batch-title">
      <div className="w-full max-w-lg rounded-xl border border-white/[0.1] bg-[#1b1e27] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] bg-red-500/[0.06]">
          <p id="remove-batch-title" className="text-sm font-semibold text-red-200">Remove from inQueue</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{batch.folderName}</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-2 text-[12px] text-slate-300">
            <p>
              Remove this batch from inQueue? This will delete the local Batchly workspace folder for this batch.
              It will not delete Etsy drafts, Google Drive folders, Preply exports, or completed batch history.
            </p>
            {hasCreatedDraftRecords && (
              <p className="rounded border border-amber-500/[0.25] bg-amber-500/[0.08] px-3 py-2 text-amber-300">
                This batch has Etsy draft records. Removing it will only delete local workspace files and will not delete Etsy drafts.
              </p>
            )}
          </div>

          <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px] text-slate-500 space-y-1">
            <p className="font-semibold text-slate-400">Local folder to delete</p>
            <p className="font-mono break-all">workspace/downloads/{batch.folderName}</p>
            <p>Draft creation records are preserved for duplicate protection.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={removing}
              className="flex-1 px-4 py-2.5 rounded border border-white/[0.08] bg-white/[0.06] text-sm text-slate-300 hover:bg-white/[0.1] hover:text-slate-100 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={removing}
              className="flex-1 px-4 py-2.5 rounded border border-red-600 bg-red-700/80 text-sm text-white font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {removing ? <><Spinner /> Removing…</> : "Remove from inQueue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
