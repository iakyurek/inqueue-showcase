"use client";

import { useState } from "react";

interface DriveFolder {
  id: string;
  name: string;
}

type PanelState =
  | "collapsed"
  | "loading"
  | "not_connected"
  | "folder_not_configured"
  | "no_folders"
  | "error"
  | "ready";

type FolderState = "idle" | "downloading" | "done" | "error";

interface FolderResult {
  filesDownloaded: number;
  filesSkipped: number;
  downloadErrors: string[];
  valid: boolean;
  validationErrorCount: number;
  validationWarningCount: number;
  validationErrors: { code: string; message: string }[];
  missingFolders: string[];
  missingImages: string[];
}

export function DriveImportPanel() {
  const [panelState, setPanelState] = useState<PanelState>("collapsed");
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [folderStates, setFolderStates] = useState<Record<string, FolderState>>({});
  const [folderResults, setFolderResults] = useState<Record<string, FolderResult>>({});
  const [folderErrors, setFolderErrors] = useState<Record<string, string>>({});

  async function expand() {
    if (panelState !== "collapsed") {
      setPanelState("collapsed");
      return;
    }

    setPanelState("loading");
    setErrorDetail(null);

    try {
      const res = await fetch("/api/drive/folders");
      const body = await res.json() as { folders?: DriveFolder[]; error?: string; detail?: string };

      if (!res.ok) {
        if (body.error === "NOT_CONNECTED") {
          setPanelState("not_connected");
        } else if (body.error === "PENDING_FOLDER_NOT_CONFIGURED") {
          setPanelState("folder_not_configured");
        } else {
          setErrorDetail(body.detail ?? body.error ?? `Server error ${res.status}`);
          setPanelState("error");
        }
        return;
      }

      if (!body.folders || body.folders.length === 0) {
        setPanelState("no_folders");
        return;
      }

      setFolders(body.folders);
      setPanelState("ready");
    } catch (e) {
      setErrorDetail(e instanceof Error ? e.message : "Unknown error");
      setPanelState("error");
    }
  }

  async function handleDownload(folder: DriveFolder) {
    setFolderStates((prev) => ({ ...prev, [folder.id]: "downloading" }));
    setFolderErrors((prev) => { const next = { ...prev }; delete next[folder.id]; return next; });

    try {
      const res = await fetch("/api/drive/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folder.id, folderName: folder.name }),
      });

      const body = await res.json() as {
        downloadResult?: {
          filesDownloaded: number;
          filesSkipped: number;
          errors: string[];
        };
        validationResult?: {
          valid: boolean;
          errors: { code: string; message: string }[];
          warnings: { code: string; message: string }[];
          missingFolders: string[];
          missingImages: string[];
        };
        error?: string;
        detail?: string;
      };

      console.log(`[DriveImportPanel] Download & Validate — ${folder.name}`, body);

      if (!res.ok) {
        setFolderErrors((prev) => ({
          ...prev,
          [folder.id]: body.detail ?? body.error ?? `Server error ${res.status}`,
        }));
        setFolderStates((prev) => ({ ...prev, [folder.id]: "error" }));
        return;
      }

      const dr = body.downloadResult;
      const vr = body.validationResult;

      setFolderResults((prev) => ({
        ...prev,
        [folder.id]: {
          filesDownloaded: dr?.filesDownloaded ?? 0,
          filesSkipped: dr?.filesSkipped ?? 0,
          downloadErrors: dr?.errors ?? [],
          valid: vr?.valid ?? false,
          validationErrorCount: vr?.errors?.length ?? 0,
          validationWarningCount: vr?.warnings?.length ?? 0,
          validationErrors: vr?.errors ?? [],
          missingFolders: vr?.missingFolders ?? [],
          missingImages: vr?.missingImages ?? [],
        },
      }));
      setFolderStates((prev) => ({ ...prev, [folder.id]: "done" }));
    } catch (e) {
      setFolderErrors((prev) => ({
        ...prev,
        [folder.id]: e instanceof Error ? e.message : "Unknown error",
      }));
      setFolderStates((prev) => ({ ...prev, [folder.id]: "error" }));
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={expand}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <div>
          <span className="text-sm font-semibold text-zinc-200">Import from Google Drive</span>
          <span className="ml-2 text-[10px] font-semibold text-zinc-500 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded uppercase tracking-wide">
            Phase 4B
          </span>
        </div>
        <span className="text-zinc-500 text-xs">
          {panelState === "collapsed" ? "▸ Open" : "▾ Close"}
        </span>
      </button>

      {/* Body */}
      {panelState !== "collapsed" && (
        <div className="border-t border-zinc-800 px-5 py-4">

          {panelState === "loading" && (
            <p className="text-xs text-zinc-500">Loading Drive folders…</p>
          )}

          {panelState === "not_connected" && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-400">Google Drive is not connected.</span>
              <a href="/settings" className="text-xs text-zinc-300 underline underline-offset-2 hover:text-white">
                Go to Settings →
              </a>
            </div>
          )}

          {panelState === "folder_not_configured" && (
            <p className="text-xs text-zinc-400">
              <span className="font-mono text-zinc-300">GOOGLE_DRIVE_PENDING_FOLDER_ID</span> is not
              set in <span className="font-mono text-zinc-300">.env.local</span>. Add the folder ID
              and restart the dev server.
            </p>
          )}

          {panelState === "no_folders" && (
            <p className="text-xs text-zinc-500">No batch folders found inside the configured pending Drive folder.</p>
          )}

          {panelState === "error" && (
            <div className="space-y-1">
              <p className="text-xs text-red-400">Error listing Drive folders.</p>
              {errorDetail && <p className="text-xs text-red-600 font-mono">{errorDetail}</p>}
              <button
                onClick={() => setPanelState("collapsed")}
                className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300 mt-1"
              >
                Dismiss
              </button>
            </div>
          )}

          {panelState === "ready" && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-500">
                {folders.length} batch folder{folders.length !== 1 ? "s" : ""} found in Drive.
              </p>
              <ul className="space-y-4">
                {folders.map((folder) => {
                  const state = folderStates[folder.id] ?? "idle";
                  const result = folderResults[folder.id];
                  const errMsg = folderErrors[folder.id];

                  return (
                    <li key={folder.id} className="space-y-2">
                      {/* Folder row */}
                      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-zinc-800/50 border border-zinc-700/50">
                        <span className="text-xs text-zinc-200 font-medium">{folder.name}</span>

                        {state === "idle" && (
                          <button
                            onClick={() => handleDownload(folder)}
                            className="px-2.5 py-1 rounded-md bg-zinc-700 border border-zinc-600 text-xs text-zinc-200 hover:bg-zinc-600 hover:text-white transition-colors"
                          >
                            Download &amp; Validate
                          </button>
                        )}

                        {state === "downloading" && (
                          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-zinc-300 rounded-full animate-spin" />
                            Downloading…
                          </span>
                        )}

                        {state === "done" && result && (
                          <span className="flex items-center gap-1.5 text-xs">
                            <span className={result.valid ? "text-emerald-400" : "text-red-400"}>
                              {result.valid ? "✓ valid" : "✗ invalid"}
                            </span>
                          </span>
                        )}

                        {state === "error" && (
                          <span className="text-xs text-red-400">Error</span>
                        )}
                      </div>

                      {/* Network/fetch error */}
                      {state === "error" && errMsg && (
                        <p className="px-3 text-[11px] text-red-600 font-mono">{errMsg}</p>
                      )}

                      {/* Detailed result panel */}
                      {state === "done" && result && (
                        <div className="ml-3 space-y-3 text-[11px]">

                          {/* Download stats */}
                          <div className="space-y-1">
                            <p className="text-zinc-500 font-semibold uppercase tracking-wide text-[10px]">Download</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-zinc-400">
                              <span>{result.filesDownloaded} downloaded</span>
                              <span>{result.filesSkipped} skipped</span>
                              {result.downloadErrors.length > 0 && (
                                <span className="text-red-400">{result.downloadErrors.length} download error{result.downloadErrors.length !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                            {result.downloadErrors.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {result.downloadErrors.slice(0, 10).map((msg, i) => (
                                  <li key={i} className="font-mono text-red-500 truncate" title={msg}>{msg}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/* Validation stats */}
                          <div className="space-y-1">
                            <p className="text-zinc-500 font-semibold uppercase tracking-wide text-[10px]">Validation</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-zinc-400">
                              <span className={result.valid ? "text-emerald-400" : "text-red-400"}>
                                {result.valid ? "Valid" : "Invalid"}
                              </span>
                              <span>
                                {result.validationErrorCount} error{result.validationErrorCount !== 1 ? "s" : ""}
                              </span>
                              <span>
                                {result.validationWarningCount} warning{result.validationWarningCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          {/* Validation errors */}
                          {result.validationErrors.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-zinc-500 font-semibold uppercase tracking-wide text-[10px]">
                                Errors {result.validationErrors.length > 10 && `(first 10 of ${result.validationErrors.length})`}
                              </p>
                              <ul className="space-y-0.5">
                                {result.validationErrors.slice(0, 10).map((err, i) => (
                                  <li key={i} className="text-red-400">
                                    <span className="font-mono text-red-600 mr-1">[{err.code}]</span>
                                    {err.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Missing folders */}
                          {result.missingFolders.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-zinc-500 font-semibold uppercase tracking-wide text-[10px]">
                                Missing folders {result.missingFolders.length > 10 && `(first 10 of ${result.missingFolders.length})`}
                              </p>
                              <ul className="space-y-0.5">
                                {result.missingFolders.slice(0, 10).map((f, i) => (
                                  <li key={i} className="font-mono text-zinc-500 truncate" title={f}>{f}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Missing images */}
                          {result.missingImages.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-zinc-500 font-semibold uppercase tracking-wide text-[10px]">
                                Missing images {result.missingImages.length > 10 && `(first 10 of ${result.missingImages.length})`}
                              </p>
                              <ul className="space-y-0.5">
                                {result.missingImages.slice(0, 10).map((m, i) => (
                                  <li key={i} className="font-mono text-zinc-500 truncate" title={m}>{m}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
