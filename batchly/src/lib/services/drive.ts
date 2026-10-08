import fs from "fs";
import path from "path";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";
import { getPendingFolderId } from "@/lib/services/appSettings";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// ---------------------------------------------------------------------------
// Token storage — AppSetting key/value row, NOT a file on disk. Render's
// ephemeral filesystem loses .tokens/google.json on every deploy; the
// database row survives. Works identically on SQLite (dev) and Postgres
// (prod, after the docs/deployment.md §3 datasource switch).
// ---------------------------------------------------------------------------

const TOKENS_SETTING_KEY = "googleDriveTokens";
// Pre-DB token file; imported once into the AppSetting row if found, so an
// existing connection survives this upgrade without a reconnect.
const LEGACY_TOKENS_FILE = path.join(process.cwd(), ".tokens", "google.json");

// Alongside Google's credentials the stored value carries two display-only
// fields (connected_email, connected_at) so status reads need no network call.
type StoredTokens = OAuth2Client["credentials"] & {
  connected_email?: string;
  connected_at?: string;
};

export async function readTokens(): Promise<StoredTokens | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: TOKENS_SETTING_KEY } });
  if (row) {
    try {
      return JSON.parse(row.value) as StoredTokens;
    } catch {
      return null;
    }
  }
  // One-time import of a token file written by the pre-DB implementation.
  try {
    const parsed = JSON.parse(fs.readFileSync(LEGACY_TOKENS_FILE, "utf8")) as StoredTokens;
    await writeTokens(parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeTokens(creds: StoredTokens): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: TOKENS_SETTING_KEY },
    create: { key: TOKENS_SETTING_KEY, value: JSON.stringify(creds) },
    update: { value: JSON.stringify(creds) },
  });
}

export async function deleteTokens(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: TOKENS_SETTING_KEY } });
  // Also drop any legacy file so it cannot resurrect the connection through
  // the one-time import above.
  try {
    fs.unlinkSync(LEGACY_TOKENS_FILE);
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// OAuth2 client
// ---------------------------------------------------------------------------

function buildOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3030/api/auth/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env.local");
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Auto-persist refreshed tokens. The googleapis event handler is sync, so
  // the DB write runs fire-and-forget; a failure only costs the refreshed
  // access token (the durable refresh_token row is unchanged).
  client.on("tokens", (tokens) => {
    void (async () => {
      const existing = (await readTokens()) ?? {};
      await writeTokens({ ...existing, ...tokens });
    })().catch((e) => console.error("[drive] failed to persist refreshed tokens:", e));
  });

  return client;
}

// ---------------------------------------------------------------------------
// Test seams — replace the Drive client in tests so no live Google calls run.
// Mirrors the __setEtsyFetchForTests pattern in etsy.ts.
// ---------------------------------------------------------------------------

let _driveClientForTests: drive_v3.Drive | null = null;

export function __setDriveClientForTests(client: drive_v3.Drive): void {
  _driveClientForTests = client;
}

export function __resetDriveClientForTests(): void {
  _driveClientForTests = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function isConnected(): Promise<boolean> {
  if (_driveClientForTests) return true;
  const tokens = await readTokens();
  return !!(tokens?.refresh_token);
}

export interface DriveConnectionInfo {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
}

export async function getConnectionInfo(): Promise<DriveConnectionInfo> {
  const tokens = await readTokens();
  const connected = _driveClientForTests ? true : !!tokens?.refresh_token;
  return {
    connected,
    email: connected ? tokens?.connected_email ?? null : null,
    connectedAt: connected ? tokens?.connected_at ?? null : null,
  };
}

/**
 * Fetch the connected Google account's email via drive.about.get (a metadata
 * read allowed under drive.readonly) and persist it into the token file.
 * Best-effort: failures degrade to email=null and never throw.
 */
export async function fetchAndStoreAccountEmail(): Promise<string | null> {
  try {
    const drive = await getDriveClient();
    const about = await drive.about.get({ fields: "user(emailAddress)" });
    const email = about.data.user?.emailAddress ?? null;
    const tokens = await readTokens();
    if (tokens) {
      await writeTokens({
        ...tokens,
        ...(email ? { connected_email: email } : {}),
        connected_at: tokens.connected_at ?? new Date().toISOString(),
      });
    }
    return email;
  } catch {
    return null;
  }
}

export function getAuthorizationUrl(): string {
  const client = buildOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<void> {
  const client = buildOAuth2Client();
  const { tokens } = await client.getToken(code);
  await writeTokens(tokens);
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (_driveClientForTests) return _driveClientForTests;
  const tokens = await readTokens();
  if (!tokens?.refresh_token) {
    throw new Error("NOT_CONNECTED");
  }

  const client = buildOAuth2Client();
  client.setCredentials(tokens);

  // Test that credentials are still valid; delete and throw if revoked
  try {
    await client.getAccessToken();
  } catch {
    await deleteTokens();
    throw new Error("NOT_CONNECTED");
  }

  return google.drive({ version: "v3", auth: client });
}

export async function listBatchFolders(
  folderIdOverride?: string,
): Promise<{ id: string; name: string; modifiedTime?: string; createdTime?: string }[]> {
  const folderId = folderIdOverride ?? (await getPendingFolderId()).value;
  if (!folderId) throw new Error("PENDING_FOLDER_NOT_CONFIGURED");

  const drive = await getDriveClient();

  const folders: { id: string; name: string; modifiedTime?: string; createdTime?: string }[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name, modifiedTime, createdTime)",
      orderBy: "name",
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const f of res.data.files ?? []) {
      if (f.id && f.name) {
        folders.push({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime ?? undefined,
          createdTime: f.createdTime ?? undefined,
        });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return folders;
}

export interface TestPendingFolderOutcome {
  ok: boolean;
  folderId: string;
  folderName?: string;
  folderCount?: number;
  checkedAt: string;
  error?: string;
}

/**
 * Read-only verification of the pending-batches folder: files.get for
 * existence/metadata plus a single-page folder list. Never writes to Drive.
 */
export async function testPendingFolder(folderId: string): Promise<TestPendingFolderOutcome> {
  const checkedAt = new Date().toISOString();
  try {
    const drive = await getDriveClient();
    const meta = await drive.files.get({
      fileId: folderId,
      fields: "id, name, mimeType, trashed",
    });
    if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
      return { ok: false, folderId, checkedAt, error: "The ID does not point to a folder." };
    }
    if (meta.data.trashed) {
      return { ok: false, folderId, checkedAt, error: "The folder is in the trash." };
    }
    const listing = await drive.files.list({
      q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id)",
      pageSize: 100,
    });
    return {
      ok: true,
      folderId,
      folderName: meta.data.name ?? undefined,
      folderCount: listing.data.files?.length ?? 0,
      checkedAt,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, folderId, checkedAt, error: message };
  }
}

// ---------------------------------------------------------------------------
// Phase 4B — Download helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

function sanitizeSegment(name: string): string | null {
  // Reject anything that could escape the downloads directory
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  // Strip leading dots and control characters
  const safe = name.replace(/[^\w.\-\s]/g, "_").trim();
  return safe.length > 0 ? safe : null;
}

async function listSubfolders(
  drive: drive_v3.Drive,
  parentId: string,
): Promise<{ id: string; name: string }[]> {
  const results: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) results.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return results;
}

async function listFiles(
  drive: drive_v3.Drive,
  parentId: string,
): Promise<{ id: string; name: string }[]> {
  const results: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, name)",
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) results.push({ id: f.id, name: f.name });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return results;
}

async function downloadFileToDisk(
  drive: drive_v3.Drive,
  fileId: string,
  destPath: string,
): Promise<"downloaded" | "skipped"> {
  // The final path only ever holds COMPLETE files: streams land in a .part
  // sidecar and are renamed on success. Before this, a crash mid-stream left
  // a truncated file that every retry skipped as "already downloaded".
  if (fs.existsSync(destPath)) return "skipped";
  const partPath = `${destPath}.part`;

  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" },
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(partPath);
      (res.data as Readable).pipe(writeStream);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
      (res.data as Readable).on("error", reject);
    });
    fs.renameSync(partPath, destPath);
  } catch (e) {
    fs.rmSync(partPath, { force: true });
    throw e;
  }

  return "downloaded";
}

export interface DownloadBatchResult {
  destPath: string;
  filesDownloaded: number;
  filesSkipped: number;
  errors: string[];
}

export async function downloadBatchFolder(
  folderId: string,
  folderName: string,
): Promise<DownloadBatchResult> {
  const drive = await getDriveClient();

  // Download into a temp sibling and move into place only when the walk
  // finishes: the queue/pool never sees a half-downloaded batch as imported,
  // and an interrupted download leaves only a .tmp- dir that the next attempt
  // clears. (The old direct-to-final write also let the auto-validation
  // marker's mkdir make an empty batch folder look imported.)
  const finalPath = path.join(process.cwd(), "workspace", "downloads", folderName);
  const destPath = path.join(process.cwd(), "workspace", "downloads", `.tmp-download-${folderName}`);
  fs.rmSync(destPath, { recursive: true, force: true });
  fs.mkdirSync(destPath, { recursive: true });

  let filesDownloaded = 0;
  let filesSkipped = 0;
  const errors: string[] = [];

  // Download batch_manifest.csv from the batch folder root
  const rootFiles = await listFiles(drive, folderId);
  const manifestFile = rootFiles.find((f) => f.name === "batch_manifest.csv");
  if (manifestFile) {
    try {
      const result = await downloadFileToDisk(drive, manifestFile.id, path.join(destPath, "batch_manifest.csv"));
      if (result === "downloaded") { filesDownloaded++; } else { filesSkipped++; }
    } catch (e) {
      errors.push(`batch_manifest.csv: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    errors.push("batch_manifest.csv not found in Drive batch folder root");
  }

  // Walk the folder tree collecting image tasks, then download in parallel.
  const imageTasks: { fileId: string; dest: string; label: string }[] = [];
  const storeFolders = await listSubfolders(drive, folderId);
  for (const storeFolder of storeFolders) {
    const safeStore = sanitizeSegment(storeFolder.name);
    if (!safeStore) {
      errors.push(`Skipped store folder with unsafe name: ${storeFolder.name}`);
      continue;
    }
    const storePath = path.join(destPath, safeStore);
    fs.mkdirSync(storePath, { recursive: true });

    const designFolders = await listSubfolders(drive, storeFolder.id);
    for (const designFolder of designFolders) {
      const safeDesign = sanitizeSegment(designFolder.name);
      if (!safeDesign) {
        errors.push(`Skipped design folder with unsafe name: ${storeFolder.name}/${designFolder.name}`);
        continue;
      }
      const designPath = path.join(storePath, safeDesign);
      fs.mkdirSync(designPath, { recursive: true });

      const imageFiles = await listFiles(drive, designFolder.id);
      for (const imageFile of imageFiles) {
        const ext = path.extname(imageFile.name).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) continue;

        const safeFile = sanitizeSegment(imageFile.name);
        if (!safeFile) {
          errors.push(`Skipped file with unsafe name: ${storeFolder.name}/${designFolder.name}/${imageFile.name}`);
          continue;
        }
        imageTasks.push({ fileId: imageFile.id, dest: path.join(designPath, safeFile), label: `${safeStore}/${safeDesign}/${safeFile}` });
      }
    }
  }

  // Sequential downloads dominated import time; images are independent, so a
  // small pool cuts wall time ~4x while staying far under Drive rate limits.
  let nextTask = 0;
  await Promise.all(Array.from({ length: Math.min(4, imageTasks.length) }, async () => {
    while (nextTask < imageTasks.length) {
      const task = imageTasks[nextTask++];
      try {
        const result = await downloadFileToDisk(drive, task.fileId, task.dest);
        if (result === "downloaded") { filesDownloaded++; } else { filesSkipped++; }
      } catch (e) {
        errors.push(`${task.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }));

  // Move into place: a re-import replaces the previous copy wholesale.
  fs.rmSync(finalPath, { recursive: true, force: true });
  fs.renameSync(destPath, finalPath);

  return { destPath: finalPath, filesDownloaded, filesSkipped, errors };
}
