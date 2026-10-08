// App-level key/value settings persisted in the database (AppSetting model).
//
// Resolution order for config that also has an env var: DB value wins, env is
// the deploy-time fallback. Saving an empty value deletes the DB row, which
// reverts the effective value to the env var. UIs display the source so the
// operator always knows where a value comes from.

import { prisma } from "@/lib/prisma";

export const SETTING_KEYS = {
  pendingFolderId: "googleDrivePendingFolderId",
  pendingFolderLastTest: "pendingFolderLastTest",
  lastDriveScan: "lastDriveScan",
  // Canonical variation profiles JSON, pushed by the hub config-sync. Batchly
  // consumes this verbatim — it is the single source of the variation matrix.
  variationProfiles: "variationProfiles",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
}

export interface EffectiveSetting {
  value: string | null;
  source: "db" | "env" | null;
}

/** Drive pending-batches folder ID: DB value wins, env var is the fallback. */
export async function getPendingFolderId(): Promise<EffectiveSetting> {
  const dbValue = await getSetting(SETTING_KEYS.pendingFolderId);
  if (dbValue) return { value: dbValue, source: "db" };
  const envValue = process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID;
  if (envValue) return { value: envValue, source: "env" };
  return { value: null, source: null };
}

export interface PendingFolderTestResult {
  ok: boolean;
  folderId: string;
  folderName?: string;
  folderCount?: number;
  checkedAt: string;
  error?: string;
}

export interface LastDriveScan {
  at: string;
  folderCount: number;
  error: string | null;
}

async function getJsonSetting<T>(key: string): Promise<T | null> {
  const raw = await getSetting(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getPendingFolderLastTest(): Promise<PendingFolderTestResult | null> {
  return getJsonSetting<PendingFolderTestResult>(SETTING_KEYS.pendingFolderLastTest);
}

export function setPendingFolderLastTest(result: PendingFolderTestResult): Promise<void> {
  return setSetting(SETTING_KEYS.pendingFolderLastTest, JSON.stringify(result));
}

export function getLastDriveScan(): Promise<LastDriveScan | null> {
  return getJsonSetting<LastDriveScan>(SETTING_KEYS.lastDriveScan);
}

export function setLastDriveScan(scan: LastDriveScan): Promise<void> {
  return setSetting(SETTING_KEYS.lastDriveScan, JSON.stringify(scan));
}
