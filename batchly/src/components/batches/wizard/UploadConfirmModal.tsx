"use client";

import {
  LocalBatch,
  Spinner,
  PRIMARY_BTN,
} from "./shared";

// ---------------------------------------------------------------------------
// Draft-only confirmation before uploading listings from the inQueue pool.
// This is the single gate in front of the existing Etsy draft-creation run.
// ---------------------------------------------------------------------------

export function UploadConfirmModal({
  batch,
  onConfirm,
  onCancel,
  starting,
}: {
  batch: LocalBatch;
  onConfirm: () => void;
  onCancel: () => void;
  starting: boolean;
}) {
  const stores = batch.readyStoreFolders.length > 0
    ? batch.readyStoreFolders.join(", ")
    : batch.storeFoldersFound.join(", ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="upload-confirm-title">
      <div className="w-full max-w-lg rounded-xl border border-white/[0.1] bg-[#1b1e27] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] bg-emerald-500/[0.06]">
          <p id="upload-confirm-title" className="text-sm font-semibold text-emerald-200">Upload Listings</p>
          <p className="text-[10px] text-slate-400 font-mono mt-0.5">{batch.folderName}</p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-[13px] text-slate-200 font-semibold">
            This will create Etsy draft listings only. Continue?
          </p>

          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center">
              <p className="text-slate-500">Stores</p>
              <p className="text-slate-300 font-semibold text-sm mt-0.5 truncate" title={stores}>{stores || "—"}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center">
              <p className="text-slate-500">Listings</p>
              <p className="text-slate-300 font-semibold text-sm mt-0.5">{batch.listingCount}</p>
            </div>
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-center">
              <p className="text-slate-500">SKUs</p>
              <p className="text-slate-300 font-semibold text-sm mt-0.5 truncate" title={batch.skuRangeSummary}>{batch.skuRangeSummary || "—"}</p>
            </div>
          </div>

          <div className="rounded border border-emerald-500/[0.2] bg-emerald-500/[0.07] px-3 py-2 text-[10px] text-emerald-400 space-y-0.5">
            <p>✓ Creates Etsy drafts only. Nothing is published or activated.</p>
            <p>✓ Manifest titles are used as-is (no test prefix); manifest SKUs are written to Etsy inventory.</p>
            <p>✓ Mockups upload first, then size charts, within Etsy&apos;s 10-image limit.</p>
            <p>✓ Duplicates are skipped automatically. Progress is saved to the database.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={starting}
              className="flex-1 px-4 py-2.5 rounded border border-white/[0.08] bg-white/[0.06] text-sm text-slate-300 hover:bg-white/[0.1] hover:text-slate-100 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              data-testid="upload-confirm-button"
              onClick={onConfirm}
              disabled={starting}
              className={`flex-1 px-4 py-2.5 text-sm flex items-center justify-center gap-2 ${PRIMARY_BTN}`}
            >
              {starting ? <><Spinner /> Starting…</> : "Upload Listings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
