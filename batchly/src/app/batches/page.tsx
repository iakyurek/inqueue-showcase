"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import {
  WizardStep,
  LocalBatch,
  ReadinessData,
  BatchValidationResult,
  BatchRunProgress,
  RecentRun,
  RemoveBatchResult,
  Spinner,
  poolStatusFor,
} from "@/components/batches/wizard/shared";
import { WizardStepper } from "@/components/batches/wizard/WizardStepper";
import { StepSelectBatch } from "@/components/batches/wizard/StepSelectBatch";
import { StepValidate } from "@/components/batches/wizard/StepValidate";
import { StepReport } from "@/components/batches/wizard/StepReport";
import { InQueuePoolSidebar } from "@/components/batches/wizard/InQueuePoolSidebar";
import { InQueuePoolBoard } from "@/components/batches/wizard/InQueuePoolBoard";
import { CompletedBatches } from "@/components/batches/wizard/CompletedBatches";
import { UploadConfirmModal } from "@/components/batches/wizard/UploadConfirmModal";
import { AdvancedSection } from "@/components/batches/wizard/AdvancedSection";
import { RemoveBatchModal } from "@/components/batches/wizard/RemoveBatchModal";

// ---------------------------------------------------------------------------
// Pool-first batches page.
//   Home ("start"): the inQueue Pool board + Completed Batches are the main
//   attractions — batches arrive there automatically from Preply. The manual
//   Drive-scan wizard (Select → Validate → Move to inQueue) hides behind the
//   small "Upload a batch manually" button and keeps its two-column layout
//   (pool sidebar on the right) while active.
// Upload (the existing draft-only Etsy run) is triggered only from pool cards.
// All API routes and services are unchanged; this page only orchestrates.
// ---------------------------------------------------------------------------

export default function BatchesPage() {
  const [step, setStep] = useState<WizardStep>("start");

  const [localBatches, setLocalBatches] = useState<LocalBatch[]>([]);
  const [batchesLoading, setBatchesLoading] = useState(false);

  // Validation state (main area)
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [validateState, setValidateState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [validationResult, setValidationResult] = useState<BatchValidationResult | null>(null);
  const [validateError, setValidateError] = useState("");
  const [moving, setMoving] = useState(false);
  // A freshly-validated batch stays hidden from the pool sidebar until the
  // user explicitly clicks "Move to inQueue".
  const [stagedBatch, setStagedBatch] = useState<string | null>(null);

  // Run state
  const [uploadCandidate, setUploadCandidate] = useState<LocalBatch | null>(null);
  const [startingRun, setStartingRun] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runProgress, setRunProgress] = useState<BatchRunProgress | null>(null);
  const [stepping, setStepping] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [runError, setRunError] = useState("");
  const [uploadingBatch, setUploadingBatch] = useState<string | null>(null);

  // Remove / complete state
  const [removeCandidate, setRemoveCandidate] = useState<LocalBatch | null>(null);
  const [removingBatch, setRemovingBatch] = useState<string | null>(null);
  const [completingBatch, setCompletingBatch] = useState<string | null>(null);

  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [toast, setToast] = useState<{ tone: "good" | "bad"; message: string } | null>(null);

  const stepLoopRef = useRef(false);

  // -------------------------------------------------------------------------
  // Loaders
  // -------------------------------------------------------------------------

  const loadLocalBatches = useCallback(async () => {
    setBatchesLoading(true);
    try {
      const res = await fetch("/api/batches/local");
      const json = await res.json() as { batches?: LocalBatch[] };
      if (res.ok && json.batches) setLocalBatches(json.batches);
    } catch { /* non-fatal */ }
    finally { setBatchesLoading(false); }
  }, []);

  const loadRecentRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/batches/runs");
      const json = await res.json() as { runs?: RecentRun[] };
      if (res.ok && json.runs) setRecentRuns(json.runs);
    } catch { /* non-fatal */ }
  }, []);

  const loadReadiness = useCallback(async () => {
    try {
      const res = await fetch("/api/readiness");
      if (res.ok) setReadiness(await res.json() as ReadinessData);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    void loadLocalBatches();
    void loadRecentRuns();
    void loadReadiness();
  }, [loadLocalBatches, loadRecentRuns, loadReadiness]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Auto-refresh while any pool batch is still auto-validating (Preply handoff
  // downloads + validates in the background) — a "Validating" card used to sit
  // stale until a manual refresh. Stops itself when nothing is validating;
  // paused during an upload run, which already refreshes on completion.
  const anyValidating = localBatches.some(
    (batch) => batch.queueSection === "inqueue" && poolStatusFor(batch, false) === "Validating",
  );
  useEffect(() => {
    if (!anyValidating || stepping) return;
    const id = setInterval(() => { void loadLocalBatches(); }, 8000);
    return () => clearInterval(id);
  }, [anyValidating, stepping, loadLocalBatches]);

  // -------------------------------------------------------------------------
  // Wizard navigation
  // -------------------------------------------------------------------------

  function resetToStart() {
    stepLoopRef.current = false;
    setStep("start");
    setSelectedBatch(null);
    setValidateState("idle");
    setValidationResult(null);
    setValidateError("");
    setStagedBatch(null);
    setStartingRun(false);
    setActiveRunId(null);
    setRunProgress(null);
    setRunError("");
    setUploadingBatch(null);
    void loadLocalBatches();
    void loadRecentRuns();
    void loadReadiness();
  }

  // -------------------------------------------------------------------------
  // Validate
  // -------------------------------------------------------------------------

  async function runValidation(folderName: string, staged: boolean) {
    setStep("validate");
    setSelectedBatch(folderName);
    setValidateState("loading");
    setValidateError("");
    setValidationResult(null);
    setStagedBatch(staged ? folderName : null);
    setActiveRunId(null);
    setRunProgress(null);
    setRunError("");
    // Refresh the pool so the just-downloaded batch is known (it stays hidden
    // from the sidebar via stagedBatch until the user moves it).
    void loadLocalBatches();

    try {
      const res = await fetch("/api/batches/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchFolder: folderName }),
      });
      const json = await res.json() as BatchValidationResult & { error?: string };
      if (!res.ok) { setValidateError(json.error ?? "VALIDATION_ERROR"); setValidateState("error"); return; }
      setValidationResult(json);
      setValidateState("done");
    } catch {
      setValidateError("Network error — check server logs.");
      setValidateState("error");
    }
  }

  // From the Select step: the folder was just downloaded, validate as staged.
  function handleValidateFromSelect(folderName: string) {
    void runValidation(folderName, true);
  }

  // From the pool sidebar: an existing pool batch, validate in place.
  function handleRevalidate(batch: LocalBatch) {
    void runValidation(batch.folderName, false);
  }

  async function handleMoveToInQueue() {
    if (!selectedBatch || !validationResult) return;
    setMoving(true);
    try {
      await loadLocalBatches();
      await loadReadiness();
      setStagedBatch(null);
      setToast({ tone: "good", message: "Batch moved to inQueue." });
      setStep("start");
      setValidateState("idle");
      setValidationResult(null);
      setSelectedBatch(null);
    } finally {
      setMoving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Upload Listings (from the pool sidebar) → existing draft-only run
  // -------------------------------------------------------------------------

  async function runStepLoop(runId: string) {
    stepLoopRef.current = true;
    setStepping(true);

    while (stepLoopRef.current) {
      try {
        const res = await fetch(`/api/batches/runs/${runId}/step`, { method: "POST" });
        const json = await res.json() as { done?: boolean; progress?: BatchRunProgress; error?: string };

        if (!res.ok) {
          setRunError(json.error ?? "STEP_ERROR");
          break;
        }
        if (json.progress) setRunProgress(json.progress);
        if (json.done) {
          void loadLocalBatches();
          void loadRecentRuns();
          void loadReadiness();
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      } catch {
        setRunError("Network error during run — click Refresh to check status.");
        break;
      }
    }

    setStepping(false);
    stepLoopRef.current = false;
  }

  async function startBatchRun(batchFolder: string, storeFolders: string[]) {
    setStartingRun(true);
    setUploadingBatch(batchFolder);
    setRunError("");
    setRunProgress(null);

    try {
      const res = await fetch("/api/batches/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchFolder,
          selectedStoreFolders: storeFolders.length > 0 ? storeFolders : undefined,
        }),
      });
      const json = await res.json() as { runId?: string; totalRows?: number; error?: string };
      if (!res.ok || !json.runId) {
        setRunError(json.error ?? "Failed to create batch run");
        setToast({ tone: "bad", message: json.error ?? "Failed to start upload." });
        setStartingRun(false);
        setUploadingBatch(null);
        return;
      }

      setActiveRunId(json.runId);
      setStep("report");

      const progressRes = await fetch(`/api/batches/runs/${json.runId}`);
      const progressJson = await progressRes.json() as BatchRunProgress;
      setRunProgress(progressJson);

      setStartingRun(false);
      setUploadingBatch(null);

      if ((json.totalRows ?? 0) === 0) {
        void loadLocalBatches();
        void loadRecentRuns();
        return;
      }

      void runStepLoop(json.runId);
    } catch {
      setRunError("Network error — check server logs.");
      setStartingRun(false);
      setUploadingBatch(null);
    }
  }

  // Sidebar "Upload Listings" → confirm modal.
  function handleUploadListings(batch: LocalBatch) {
    setUploadCandidate(batch);
  }

  // Confirm modal → re-validate for fresh ready stores + duplicate marking,
  // then run the existing draft-only path.
  async function handleConfirmUpload() {
    const batch = uploadCandidate;
    if (!batch) return;
    setUploadCandidate(null);
    setUploadingBatch(batch.folderName);
    setRunError("");

    try {
      const res = await fetch("/api/batches/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchFolder: batch.folderName }),
      });
      const json = await res.json() as BatchValidationResult & { error?: string };
      if (!res.ok) {
        setUploadingBatch(null);
        setToast({ tone: "bad", message: json.error ?? "Validation failed before upload." });
        return;
      }

      const readyFolders = json.storeResults
        .filter((s) => s.errors.length === 0 && s.etsyConnected && s.etsySetupReady && s.eligibleNotCreatedCount > 0)
        .map((s) => s.storeFolder);

      if (readyFolders.length === 0) {
        setUploadingBatch(null);
        setToast({ tone: "bad", message: "No ready stores with new listings — batch may already be uploaded." });
        void loadLocalBatches();
        return;
      }

      await startBatchRun(batch.folderName, readyFolders);
    } catch {
      setUploadingBatch(null);
      setToast({ tone: "bad", message: "Network error before upload." });
    }
  }

  // -------------------------------------------------------------------------
  // Remove / confirm-complete
  // -------------------------------------------------------------------------

  function handleRequestRemove(batch: LocalBatch) {
    if (uploadingBatch === batch.folderName || (runProgress?.batchFolder === batch.folderName && stepping)) {
      setToast({ tone: "bad", message: "This batch is uploading. Wait for it to finish before removing it." });
      return;
    }
    if (uploadingBatch) {
      setToast({ tone: "bad", message: "Wait for the current upload to finish before removing batches." });
      return;
    }
    setRemoveCandidate(batch);
  }

  async function handleConfirmRemove() {
    if (!removeCandidate) return;
    const batch = removeCandidate;
    setRemovingBatch(batch.folderName);

    try {
      const res = await fetch(`/api/batches/local/${encodeURIComponent(batch.folderName)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmDraftRecords: batch.completedListingCount > 0 }),
      });
      const json = await res.json() as RemoveBatchResult;

      if (!res.ok || !json.removed) {
        setToast({ tone: "bad", message: json.error ?? "Could not remove this batch from inQueue." });
        return;
      }

      setLocalBatches((existing) => existing.filter((item) => item.folderName !== batch.folderName));
      if (selectedBatch === batch.folderName) {
        setSelectedBatch(null);
        setValidateState("idle");
        setValidationResult(null);
        setStagedBatch(null);
        if (step !== "start") setStep("start");
      }
      if (runProgress?.batchFolder === batch.folderName) {
        setRunProgress(null);
        setActiveRunId(null);
        setRunError("");
      }
      setToast({ tone: "good", message: `Removed ${batch.folderName} from inQueue.` });
      setRemoveCandidate(null);
      void loadLocalBatches();
      void loadReadiness();
    } catch {
      setToast({ tone: "bad", message: "Network error while removing the batch." });
    } finally {
      setRemovingBatch(null);
    }
  }

  async function handleConfirmComplete(batch: LocalBatch) {
    const ok = window.confirm("Move this completed run to Completed Batches?");
    if (!ok) return;

    setCompletingBatch(batch.folderName);
    try {
      const res = await fetch(`/api/batches/${encodeURIComponent(batch.folderName)}/confirm-complete`, {
        method: "POST",
      });
      const json = await res.json() as { completed?: boolean; error?: string; completedAt?: string };
      if (!res.ok || !json.completed) {
        setToast({ tone: "bad", message: json.error ?? "Could not move this batch to Completed Batches." });
        return;
      }
      setToast({ tone: "good", message: "Batch moved to Completed Batches." });
      void loadLocalBatches();
      void loadReadiness();
    } catch {
      setToast({ tone: "bad", message: "Network error while moving the batch to Completed Batches." });
    } finally {
      setCompletingBatch(null);
    }
  }

  // -------------------------------------------------------------------------
  // Report helpers
  // -------------------------------------------------------------------------

  async function handleRefreshProgress() {
    if (!activeRunId) return;
    try {
      const res = await fetch(`/api/batches/runs/${activeRunId}`);
      const json = await res.json() as BatchRunProgress;
      if (res.ok) setRunProgress(json);
    } catch { /* non-fatal */ }
  }

  async function handleRetryFailed() {
    if (!activeRunId) return;
    setRetrying(true);
    setRunError("");
    try {
      const res = await fetch(`/api/batches/runs/${activeRunId}/retry-failed`, { method: "POST" });
      const json = await res.json() as { retriableCount?: number; resetCount?: number; error?: string };
      if (!res.ok) { setRunError(json.error ?? "RETRY_ERROR"); setRetrying(false); return; }
      const retried = json.retriableCount ?? json.resetCount ?? 0;
      const progressRes = await fetch(`/api/batches/runs/${activeRunId}`);
      const progressJson = await progressRes.json() as BatchRunProgress;
      if (progressRes.ok) setRunProgress(progressJson);
      setRetrying(false);
      void loadLocalBatches();
      if (retried === 0) {
        void loadRecentRuns();
        void loadReadiness();
        return;
      }
      void runStepLoop(activeRunId);
    } catch {
      setRunError("Network error during retry.");
      setRetrying(false);
    }
  }

  async function handleSelectRun(runId: string) {
    setActiveRunId(runId);
    setStep("report");
    try {
      const res = await fetch(`/api/batches/runs/${runId}`);
      const json = await res.json() as BatchRunProgress;
      if (res.ok) setRunProgress(json);
    } catch { /* non-fatal */ }
  }

  function handleViewRunReport(batch: LocalBatch) {
    if (!batch.latestRunId) return;
    setSelectedBatch(batch.folderName);
    setValidateState("idle");
    setValidationResult(null);
    setRunError("");
    void handleSelectRun(batch.latestRunId);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const runningBatchFolder = stepping ? runProgress?.batchFolder ?? null : null;
  const poolBatches = localBatches.filter(
    (batch) => batch.queueSection === "inqueue" && batch.folderName !== stagedBatch,
  );
  const reportBatch = runProgress
    ? localBatches.find((batch) => batch.folderName === runProgress.batchFolder) ?? null
    : null;

  return (
    <div className="flex flex-col flex-1 bg-[#0f1115]">
      <TopBar
        title="Batches"
        subtitle="inQueue Pool → Upload Listings → Report · upload batches manually when needed"
      />
      <div className="p-6 max-w-6xl space-y-4">

        {/* Safety strip */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-500 bg-white/[0.03] border border-white/[0.07] rounded-lg px-5 py-3">
          <span className="font-semibold text-emerald-400 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Draft-only — nothing published or activated</span>
          <span className="text-slate-300">|</span>
          <span>Max 30 listings/store</span>
          <span className="text-slate-300">|</span>
          <span>Duplicates skipped automatically</span>
          <span className="text-slate-300">|</span>
          <span>Progress saved to database</span>
        </div>

        {/* Wizard progress — only while the manual import wizard is active */}
        {step !== "start" && <WizardStepper current={step} />}

        {runError && (
          <div className="rounded-lg border border-red-500/[0.2] bg-red-500/[0.07] px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-red-400">Run error</p>
            <p className="text-[10px] text-red-500 font-mono">{runError}</p>
            <button
              className="text-[10px] text-slate-500 underline hover:text-slate-200 transition-colors"
              onClick={() => setRunError("")}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Home: pool board + completed batches as the main attractions */}
        {step === "start" && (
          <div data-testid="step-start" className="space-y-4">
            <InQueuePoolBoard
              batches={poolBatches}
              loading={batchesLoading}
              runningBatchFolder={runningBatchFolder}
              uploadingBatch={uploadingBatch}
              removingBatch={removingBatch}
              onUpload={handleUploadListings}
              onValidate={handleRevalidate}
              onRemove={handleRequestRemove}
              onViewReport={handleViewRunReport}
              onRefresh={() => { void loadLocalBatches(); void loadReadiness(); }}
              driveConnected={!!readiness?.driveConnected}
              onManualUpload={() => setStep("select")}
            />
            <CompletedBatches
              batches={localBatches}
              loading={batchesLoading}
              onViewRunReport={handleViewRunReport}
            />
          </div>
        )}

        {/* Manual wizard: main workflow + right-side inQueue pool */}
        {step !== "start" && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {step === "select" && (
              <StepSelectBatch
                driveConnected={!!readiness?.driveConnected}
                onValidate={handleValidateFromSelect}
                onBack={() => setStep("start")}
              />
            )}

            {step === "validate" && (
              <>
                {validateState === "loading" && (
                  <div className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm px-5 py-4 flex items-center gap-3">
                    <Spinner />
                    <p className="text-[13px] text-slate-400">
                      Validating <span className="font-mono font-medium text-slate-200">{selectedBatch}</span>…
                    </p>
                  </div>
                )}
                {validateState === "error" && (
                  <div className="rounded-lg border border-red-500/[0.2] bg-red-500/[0.07] px-5 py-4 space-y-2">
                    <p className="text-[13px] font-semibold text-red-400">Validation failed</p>
                    <p className="text-[11px] text-red-500 font-mono">{validateError}</p>
                    <button
                      onClick={() => setStep("start")}
                      className="text-[11px] text-slate-500 underline hover:text-slate-200 transition-colors"
                    >
                      ← Back to Start
                    </button>
                  </div>
                )}
                {validateState === "done" && validationResult && (
                  <StepValidate
                    result={validationResult}
                    onMoveToInQueue={() => void handleMoveToInQueue()}
                    onBack={() => setStep("start")}
                    moving={moving}
                  />
                )}
              </>
            )}

            {step === "report" && (
              <>
                {!runProgress && (
                  <div className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm px-5 py-4 flex items-center gap-3">
                    <Spinner />
                    <p className="text-[13px] text-slate-400">Loading run report…</p>
                  </div>
                )}
                {runProgress && (
                  <StepReport
                    progress={runProgress}
                    running={stepping}
                    onRetryFailed={() => void handleRetryFailed()}
                    onRefresh={() => void handleRefreshProgress()}
                    retrying={retrying}
                    batch={reportBatch}
                    onConfirmComplete={(batch) => void handleConfirmComplete(batch)}
                    completing={completingBatch !== null}
                    onStartNew={resetToStart}
                  />
                )}
              </>
            )}
          </div>

          {/* Right-side inQueue Pool */}
          <InQueuePoolSidebar
            batches={poolBatches}
            loading={batchesLoading}
            runningBatchFolder={runningBatchFolder}
            uploadingBatch={uploadingBatch}
            removingBatch={removingBatch}
            onUpload={handleUploadListings}
            onValidate={handleRevalidate}
            onRemove={handleRequestRemove}
            onViewReport={handleViewRunReport}
          />
        </div>
        )}

        {/* Advanced / Debug */}
        <AdvancedSection
          runs={recentRuns}
          onSelectRun={(runId) => void handleSelectRun(runId)}
          activeRunId={activeRunId}
          onRefreshBatches={() => { void loadLocalBatches(); void loadReadiness(); }}
          loading={batchesLoading}
          readiness={readiness}
        />

        {/* Footer links */}
        <p className="text-[10px] text-slate-400 pt-2 flex flex-wrap gap-x-3">
          <a href="/stores" className="underline hover:text-slate-500 transition-colors">Stores (setup & QA)</a>
          <a href="/operator-guide" className="underline hover:text-slate-500 transition-colors">Operator Guide</a>
          <a href="/settings" className="underline hover:text-slate-500 transition-colors">Settings</a>
        </p>
      </div>

      {/* Upload confirmation modal */}
      {uploadCandidate && (
        <UploadConfirmModal
          batch={uploadCandidate}
          onConfirm={() => void handleConfirmUpload()}
          onCancel={() => setUploadCandidate(null)}
          starting={startingRun}
        />
      )}

      {/* Remove confirmation modal */}
      {removeCandidate && (
        <RemoveBatchModal
          batch={removeCandidate}
          onConfirm={() => void handleConfirmRemove()}
          onCancel={() => { if (!removingBatch) setRemoveCandidate(null); }}
          removing={removingBatch === removeCandidate.folderName}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          data-testid="toast"
          className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-3 text-xs font-semibold shadow-xl ${
            toast.tone === "good"
              ? "border-emerald-500/[0.3] bg-emerald-950/90 text-emerald-200"
              : "border-red-500/[0.3] bg-red-950/90 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
