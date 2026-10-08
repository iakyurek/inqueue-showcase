"use client";

// ---------------------------------------------------------------------------
// Shared types + UI primitives for the guided batch wizard.
// Extracted from src/app/batches/page.tsx — visual language unchanged.
// ---------------------------------------------------------------------------

export type WizardStep = "start" | "select" | "validate" | "report";

// ---------------------------------------------------------------------------
// Primary action button style — dark emerald with a restrained glow on
// hover/focus. Callers add their own sizing (px/py/text). Disabled state is
// clearly muted and never glows.
// ---------------------------------------------------------------------------

export const PRIMARY_BTN =
  "rounded-lg border border-emerald-600/70 bg-emerald-800 text-white font-semibold transition-all " +
  "hover:bg-emerald-700 hover:border-emerald-500 hover:shadow-[0_0_14px_-2px_rgba(16,185,129,0.5)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#1b1e27] " +
  "active:bg-emerald-900 active:shadow-none " +
  "disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed disabled:hover:bg-emerald-800 disabled:hover:border-emerald-600/70 disabled:hover:shadow-none";

export interface LocalBatch {
  folderName: string;
  sourceDriveFolderId: string | null;
  sourceDriveFolderName: string | null;
  importedAt: string | null;
  confirmedCompletedAt: string | null;
  hasManifest: boolean;
  manifestRowCount: number | null;
  storeFoldersFound: string[];
  detectedAt: string;
  lastUpdatedAt: string;
  queueSection: "inqueue" | "completed";
  batchStatus: "detected" | "scanned" | "validated" | "ready" | "ready_to_upload" | "retryable" | "failed" | "completed";
  validationStatus: "not_validated" | "ok" | "warnings" | "errors" | "completed";
  listingCount: number;
  completedListingCount: number;
  totalImageCount: number;
  rowsWithImages: number;
  missingImageCount: number;
  imageSummary: string;
  skuRangeSummary: string;
  currentStage: "added_to_inqueue" | "importing" | "validating" | "ready_to_run" | "running" | "run_complete_awaiting_confirmation" | "failed_needs_attention" | "completed";
  canConfirmComplete: boolean;
  uploadReady: boolean;
  readyStoreFolders: string[];
  uploadDisabledReason: string | null;
  warnings: string[];
  errors: string[];
  completedAt: string | null;
  etsyDraftResult: string | null;
  latestRunId: string | null;
  latestRunStatus: string | null;
}

export interface ReadinessData {
  driveConnected: boolean;
  driveStatusLabel?: string;
  localBatchCount: number;
  connectedStoreCount: number;
  readyStoreCount: number;
  connectedStores?: {
    id: string;
    name: string;
    driveFolderName: string;
    etsyShopName: string | null;
  }[];
  latestRun: {
    id: string;
    status: string;
    batchFolder: string;
    created: number;
    failed: number;
    partial: number;
    totalRows: number;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

export interface DriveFolder {
  id: string;
  name: string;
  modifiedTime?: string | null;
  createdTime?: string | null;
  localExists?: boolean;
  alreadyImported?: boolean;
  alreadyCompleted?: boolean;
  duplicateMessage?: string | null;
  storeFoldersDetected?: string[];
  hasManifest?: boolean | null;
  manifestRowCount?: number | null;
  warnings?: string[];
}

export type DrivePanelState = "scanning" | "not_connected" | "folder_not_configured" | "no_folders" | "error" | "ready";
export type FolderDownloadState = "idle" | "importing" | "done" | "error";

export interface StoreValidationResult {
  storeFolder: string;
  storeName: string;
  storeId: string | null;
  etsyConnected: boolean;
  etsyShopName: string | null;
  etsySetupReady: boolean;
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  manifestRowCount: number;
  validListingsCount: number;
  ineligibleCount: number;
  missingImageCount: number;
  missingTitleCount: number;
  missingSkuCount: number;
  missingTagsCount: number;
  invalidPriceCount: number;
  alreadyCreatedCount: number;
  eligibleNotCreatedCount: number;
  estimatedListings: number;
  warnings: string[];
  errors: string[];
}

export interface BatchValidationResult {
  batchFolder: string;
  overallStatus: "ready" | "warnings" | "failed";
  manifestStatus: "ok" | "warnings" | "errors";
  manifestRowCount: number;
  manifestErrors: string[];
  manifestWarnings: string[];
  storesInManifest: string[];
  globalPreset: { exists: boolean; hasTemplate: boolean; descriptionTemplateLength: number };
  variationPreset: { enabled: boolean; ready: boolean; combinationCount: number; issues: string[] };
  supplementalPreset: { enabled: boolean; filesAvailable: number; sizeChartCount: number; sizeChartRequired: number; issues: string[] };
  storeResults: StoreValidationResult[];
  validatedAt: string;
}

export interface BatchRunRowProgress {
  rowId: string;
  designId: string;
  sku: string | null;
  title: string | null;
  status: string;
  listingId: string | null;
  imagesAttempted: number;
  imagesUploaded: number;
  variationInventoryStatus: string;
  supplementalImageStatus: string;
  supplementalImagesAttempted: number;
  supplementalImagesUploaded: number;
  errors: string[];
  warnings: string[];
}

export interface BatchRunStoreProgress {
  storeRunId: string;
  storeFolder: string;
  storeName: string;
  status: string;
  skipReason: string | null;
  attempted: number;
  created: number;
  skipped: number;
  partial: number;
  failed: number;
  rows: BatchRunRowProgress[];
}

export interface BatchRunProgress {
  runId: string;
  batchFolder: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalStores: number;
  totalRows: number;
  attempted: number;
  created: number;
  skipped: number;
  partial: number;
  failed: number;
  percentComplete: number;
  currentStore: string | null;
  currentDesignId: string | null;
  stores: BatchRunStoreProgress[];
}

export interface RecentRun {
  id: string;
  batchFolder: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalRows: number;
  created: number;
  failed: number;
  stores: { id: string; storeFolder: string; status: string; created: number; failed: number; attempted: number }[];
}

export interface RemoveBatchResult {
  removed?: boolean;
  deletedPath?: string;
  error?: string;
  requiresDraftRecordConfirmation?: boolean;
  preservedRecords?: {
    draftCreationRecords: number;
    createdDraftRecords: number;
    batchRuns: number;
  };
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === "ready" || status === "ok" || status === "completed" || status === "created" || status === "Draft-only verified path"
      ? "bg-emerald-500/[0.12] text-emerald-400 border-emerald-500/[0.25]"
      : status === "warnings" || status === "partial" || status === "running"
        ? "bg-amber-500/[0.12] text-amber-400 border-amber-500/[0.25]"
        : status === "queued" || status === "selected" || status === "duplicate" || status === "skipped"
          ? "bg-white/[0.06] text-slate-400 border-white/[0.1]"
          : "bg-red-500/[0.12] text-red-400 border-red-500/[0.25]";
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${cfg}`}>
      {status}
    </span>
  );
}

export function BatchStatusPill({ status }: { status: string }) {
  const cls =
    status === "completed" ? "border-emerald-500/[0.25] bg-emerald-500/[0.08] text-emerald-300"
    : status === "ready_to_upload" || status === "ready" ? "border-sky-500/[0.25] bg-sky-500/[0.08] text-sky-300"
    : status === "retryable" || status === "warnings" ? "border-amber-500/[0.25] bg-amber-500/[0.08] text-amber-300"
    : status === "failed" || status === "errors" ? "border-red-500/[0.25] bg-red-500/[0.08] text-red-300"
    : "border-white/[0.1] bg-white/[0.05] text-slate-400";
  return <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

export function BatchFact({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const valueCls =
    tone === "good" ? "text-emerald-300"
    : tone === "warn" ? "text-amber-300"
    : tone === "bad" ? "text-red-300"
    : "text-slate-300";
  return (
    <div className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 min-w-0">
      <p className="text-[9px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-[11px] font-medium mt-0.5 truncate ${valueCls}`} title={value}>{value}</p>
    </div>
  );
}

export function ProgressBar({ percent, status, thin }: { percent: number; status: string; thin?: boolean }) {
  const color =
    status === "completed" ? "bg-emerald-500"
    : status === "partial" ? "bg-amber-500"
    : status === "failed" ? "bg-red-500"
    : status === "running" ? "bg-sky-500"
    : "bg-slate-400";
  return (
    <div className={`w-full ${thin ? "h-1" : "h-1.5"} bg-white/[0.08] rounded-full overflow-hidden`}>
      <div className={`h-full ${color} transition-all duration-500 ease-out`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-white/[0.12] border-t-slate-400 rounded-full animate-spin shrink-0" />;
}

export function RowStatusDot({ status }: { status: string }) {
  const cls =
    status === "created" ? "bg-emerald-500"
    : status === "partial" ? "bg-yellow-500"
    : status === "failed" ? "bg-red-500"
    : status === "running" ? "bg-blue-400 animate-pulse"
    : status === "duplicate" ? "bg-blue-700"
    : status === "queued" ? "bg-slate-400"
    : "bg-slate-200";
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} title={status} />;
}

export function workflowStageLabel(stage: LocalBatch["currentStage"]): string {
  switch (stage) {
    case "added_to_inqueue": return "Added to inQueue";
    case "importing": return "Importing";
    case "validating": return "Validating";
    case "ready_to_run": return "Ready to Run";
    case "running": return "Running";
    case "run_complete_awaiting_confirmation": return "Run Complete — Awaiting Confirmation";
    case "failed_needs_attention": return "Failed / Needs Attention";
    case "completed": return "Completed";
  }
}

// ---------------------------------------------------------------------------
// inQueue Pool status chip — derives a single lifecycle label for a batch
// sitting in the pool sidebar.
// ---------------------------------------------------------------------------

export type PoolStatus = "Validating" | "Ready" | "Needs Attention" | "Running" | "Run Complete";

export function poolStatusFor(batch: LocalBatch, isRunning: boolean): PoolStatus {
  if (isRunning || batch.currentStage === "running") return "Running";
  if (batch.canConfirmComplete || batch.currentStage === "run_complete_awaiting_confirmation") return "Run Complete";
  if (batch.errors.length > 0 || batch.validationStatus === "errors" || batch.currentStage === "failed_needs_attention") return "Needs Attention";
  if (batch.uploadReady) return "Ready";
  return "Validating";
}

export function PoolStatusChip({ status }: { status: PoolStatus }) {
  const cls =
    status === "Ready" ? "border-emerald-500/[0.3] bg-emerald-500/[0.12] text-emerald-300"
    : status === "Run Complete" ? "border-sky-500/[0.3] bg-sky-500/[0.12] text-sky-300"
    : status === "Running" ? "border-amber-500/[0.3] bg-amber-500/[0.12] text-amber-300"
    : status === "Needs Attention" ? "border-red-500/[0.3] bg-red-500/[0.12] text-red-300"
    : "border-white/[0.12] bg-white/[0.06] text-slate-400";
  return <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border uppercase tracking-wide ${cls}`}>{status}</span>;
}

export function Panel({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm overflow-hidden">
      {children}
    </div>
  );
}
