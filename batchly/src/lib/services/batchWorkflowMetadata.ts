import fs from "fs";
import path from "path";

export const DOWNLOADS_DIR = path.resolve(process.cwd(), "workspace", "downloads");
export const WORKFLOW_METADATA_FILE = ".batchly-workflow.json";

export type WorkflowStage =
  | "added_to_inqueue"
  | "importing"
  | "validating"
  | "ready_to_run"
  | "running"
  | "run_complete_awaiting_confirmation"
  | "failed_needs_attention"
  | "completed";

export interface BatchWorkflowMetadata {
  sourceDriveFolderId?: string;
  sourceDriveFolderName?: string;
  importedAt?: string;
  selectedAt?: string;
  stage?: WorkflowStage;
  lastValidatedAt?: string;
  lastRunId?: string;
  confirmedCompletedAt?: string;
  completedAt?: string;
}

export function isSafeBatchFolderName(folderName: string): boolean {
  return !!folderName.trim() &&
    folderName !== "." &&
    folderName !== ".." &&
    !folderName.includes("/") &&
    !folderName.includes("\\") &&
    !folderName.includes("\0");
}

export function resolveBatchFolderPath(folderName: string): { batchPath: string; error?: string } {
  const trimmed = folderName.trim();
  if (!isSafeBatchFolderName(trimmed)) return { batchPath: "", error: "Invalid batch name." };

  const batchPath = path.resolve(DOWNLOADS_DIR, trimmed);
  const relative = path.relative(DOWNLOADS_DIR, batchPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { batchPath: "", error: "Refusing to access outside the Batchly downloads workspace." };
  }

  return { batchPath };
}

export function metadataPathForBatch(folderName: string): string | null {
  const resolved = resolveBatchFolderPath(folderName);
  if (resolved.error) return null;
  return path.join(resolved.batchPath, WORKFLOW_METADATA_FILE);
}

export function readBatchWorkflowMetadata(folderName: string): BatchWorkflowMetadata | null {
  const metadataPath = metadataPathForBatch(folderName);
  if (!metadataPath || !fs.existsSync(metadataPath)) return null;

  try {
    const raw = fs.readFileSync(metadataPath, "utf8");
    const parsed = JSON.parse(raw) as BatchWorkflowMetadata;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBatchWorkflowMetadata(
  folderName: string,
  updates: BatchWorkflowMetadata,
): BatchWorkflowMetadata {
  const resolved = resolveBatchFolderPath(folderName);
  if (resolved.error) throw new Error(resolved.error);
  fs.mkdirSync(resolved.batchPath, { recursive: true });

  const existing = readBatchWorkflowMetadata(folderName) ?? {};
  const next: BatchWorkflowMetadata = { ...existing, ...updates };
  const metadataPath = path.join(resolved.batchPath, WORKFLOW_METADATA_FILE);
  fs.writeFileSync(metadataPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
