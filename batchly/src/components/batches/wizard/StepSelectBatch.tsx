"use client";

import { useEffect, useState } from "react";
import {
  DriveFolder,
  DrivePanelState,
  FolderDownloadState,
  BatchStatusPill,
  Spinner,
  Panel,
  PRIMARY_BTN,
} from "./shared";

// ---------------------------------------------------------------------------
// Step 2 — Select Batch
// Scans Drive automatically on entry (the user already clicked "Start a
// Batch"). One primary action: "Validate Batch" — this downloads the folder
// if needed and then the parent runs validation before anything moves to the
// inQueue pool.
// ---------------------------------------------------------------------------

export function StepSelectBatch({
  driveConnected,
  onValidate,
  onBack,
}: {
  driveConnected: boolean;
  onValidate: (folderName: string) => void;
  onBack: () => void;
}) {
  const [panelState, setPanelState] = useState<DrivePanelState>("scanning");
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [folderStates, setFolderStates] = useState<Record<string, FolderDownloadState>>({});
  const [folderErrors, setFolderErrors] = useState<Record<string, string>>({});
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  async function scan() {
    if (!driveConnected) {
      setPanelState("not_connected");
      return;
    }
    setPanelState("scanning");
    setErrorDetail(null);
    setFolders([]);
    setSelectedFolderId(null);
    try {
      const res = await fetch("/api/batches/scan-drive", { method: "POST" });
      const body = await res.json() as { batches?: DriveFolder[]; error?: string; detail?: string };
      if (!res.ok) {
        if (body.error === "NOT_CONNECTED") setPanelState("not_connected");
        else if (body.error === "PENDING_FOLDER_NOT_CONFIGURED") setPanelState("folder_not_configured");
        else { setErrorDetail(body.detail ?? body.error ?? `Server error ${res.status}`); setPanelState("error"); }
        return;
      }
      if (!body.batches || body.batches.length === 0) { setPanelState("no_folders"); return; }
      setFolders(body.batches);
      setPanelState("ready");
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : "Network error");
      setPanelState("error");
    }
  }

  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleImport(folder: DriveFolder) {
    if (folder.alreadyImported || folder.alreadyCompleted) return;
    setFolderStates((p) => ({ ...p, [folder.id]: "importing" }));
    setFolderErrors((p) => { const n = { ...p }; delete n[folder.id]; return n; });
    try {
      const res = await fetch("/api/batches/local/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folder.id, folderName: folder.name }),
      });
      const body = await res.json() as { imported?: boolean; batchFolder?: string; error?: string; detail?: string; duplicateStatus?: string };
      if (!res.ok) {
        setFolderErrors((p) => ({ ...p, [folder.id]: body.detail ?? body.error ?? `Server error ${res.status}` }));
        setFolderStates((p) => ({ ...p, [folder.id]: "error" }));
        return;
      }
      setFolderStates((p) => ({ ...p, [folder.id]: "done" }));
      onValidate(body.batchFolder ?? folder.name);
    } catch (e) {
      setFolderErrors((p) => ({ ...p, [folder.id]: e instanceof Error ? e.message : "Network error" }));
      setFolderStates((p) => ({ ...p, [folder.id]: "error" }));
    }
  }

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const selectedBlocked = !!(selectedFolder?.alreadyImported || selectedFolder?.alreadyCompleted);
  const importing = selectedFolder ? folderStates[selectedFolder.id] === "importing" : false;

  return (
    <div data-testid="step-select">
      <Panel>
        <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-white/[0.07]">
          <div>
            <p className="text-[14px] font-semibold text-slate-200">Select a batch from Google Drive</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Choose one batch folder, then move it into the inQueue pool</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onBack}
              disabled={importing}
              className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[11px] text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-all disabled:opacity-40"
            >
              ← Back
            </button>
            <button
              onClick={scan}
              disabled={panelState === "scanning" || importing}
              className="px-3 py-1.5 rounded-lg border border-white/[0.08] text-[11px] text-slate-500 hover:text-slate-200 hover:bg-white/[0.05] transition-all disabled:opacity-40"
            >
              Rescan
            </button>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          {panelState === "scanning" && (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Scanning Google Drive for available batches…</div>
          )}
          {panelState === "not_connected" && (
            <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-slate-500">
              Connect Google Drive before starting a batch.{" "}
              <a href="/settings" className="text-slate-200 underline hover:text-slate-100 transition-colors">Go to Settings → Connect Google Drive</a>
            </div>
          )}
          {panelState === "folder_not_configured" && (
            <div className="rounded border border-amber-500/[0.2] bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-400">
              <span className="font-mono">GOOGLE_DRIVE_PENDING_FOLDER_ID</span> not set in <span className="font-mono">.env.local</span>. Set the folder ID and restart the server.
            </div>
          )}
          {panelState === "no_folders" && (
            <p className="text-xs text-slate-500">No batch folders found in the configured Drive folder. Upload a batch folder to Drive first.</p>
          )}
          {panelState === "error" && (
            <div>
              <p className="text-xs text-red-400">Could not list Drive folders.</p>
              {errorDetail && <p className="text-xs text-red-600 font-mono mt-1 break-all">{errorDetail}</p>}
            </div>
          )}
          {panelState === "ready" && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">{folders.length} batch folder{folders.length !== 1 ? "s" : ""} found in Drive</p>
              {folders.map((folder) => {
                const state = folderStates[folder.id] ?? "idle";
                const selected = selectedFolderId === folder.id;
                const blocked = !!(folder.alreadyImported || folder.alreadyCompleted);
                const date = folder.modifiedTime ?? folder.createdTime;
                return (
                  <button
                    key={folder.id}
                    type="button"
                    data-testid={`drive-folder-${folder.name}`}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                      selected
                        ? "border-emerald-500/[0.35] bg-emerald-500/[0.08]"
                        : "border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-200 font-medium font-mono truncate">{folder.name}</p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                          {date && <span>modified {new Date(date).toLocaleString()}</span>}
                          <span>{folder.hasManifest === null || typeof folder.hasManifest === "undefined" ? "manifest checked after import" : folder.hasManifest ? "manifest detected" : "manifest missing"}</span>
                          {typeof folder.manifestRowCount === "number" && <span>{folder.manifestRowCount} listing rows</span>}
                          {folder.storeFoldersDetected && folder.storeFoldersDetected.length > 0 && <span>{folder.storeFoldersDetected.join(", ")}</span>}
                        </div>
                        {folder.duplicateMessage && <p className="text-[10px] text-amber-300 mt-1">{folder.duplicateMessage}</p>}
                        {folder.warnings && folder.warnings.length > 0 && <p className="text-[10px] text-amber-300 mt-1">{folder.warnings[0]}</p>}
                        {state === "done" && <p className="text-[10px] text-emerald-400 mt-1">Downloaded — validating…</p>}
                        {folderErrors[folder.id] && <p className="text-[10px] text-red-400 font-mono mt-1">{folderErrors[folder.id]}</p>}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {blocked && <BatchStatusPill status={folder.alreadyCompleted ? "completed" : "queued"} />}
                        {selected && !blocked && <BatchStatusPill status="selected" />}
                        {state === "importing" && <span className="text-[10px] text-slate-500 flex items-center gap-1"><Spinner /> Importing</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
              <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
                <p className="text-[10px] text-slate-500">
                  {selectedFolder
                    ? selectedBlocked
                      ? selectedFolder.duplicateMessage
                      : `Selected ${selectedFolder.name}`
                    : "Select one Drive folder, then validate it before it enters the inQueue pool."}
                </p>
                <button
                  data-testid="validate-batch-button"
                  onClick={() => selectedFolder && handleImport(selectedFolder)}
                  disabled={!selectedFolder || selectedBlocked || importing}
                  className={`px-4 py-2 text-xs flex items-center gap-2 ${PRIMARY_BTN}`}
                >
                  {importing ? <><Spinner /> Validating…</> : "Validate Batch"}
                </button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
