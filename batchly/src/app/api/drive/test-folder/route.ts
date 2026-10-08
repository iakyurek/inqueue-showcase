import { type NextRequest, NextResponse } from "next/server";
import { isConnected, testPendingFolder } from "@/lib/services/drive";
import { getPendingFolderId, setPendingFolderLastTest } from "@/lib/services/appSettings";

// Read-only Drive check (files.get + one-page list). Never writes to Drive.
export async function POST(req: NextRequest) {
  let body: { folderId?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // empty body → test the effective configured folder
  }

  const requested = typeof body.folderId === "string" ? body.folderId.trim() : "";
  const folderId = requested || (await getPendingFolderId()).value;

  if (!folderId) {
    return NextResponse.json(
      {
        error: "PENDING_FOLDER_NOT_CONFIGURED",
        fix: "Save a pending-batches folder ID in Settings, or set GOOGLE_DRIVE_PENDING_FOLDER_ID.",
      },
      { status: 400 },
    );
  }
  if (!(await isConnected())) {
    return NextResponse.json(
      { error: "NOT_CONNECTED", fix: "Connect Google Drive in Settings first." },
      { status: 401 },
    );
  }

  const result = await testPendingFolder(folderId);
  await setPendingFolderLastTest(result).catch(() => {});
  return NextResponse.json(result);
}
