import { type NextRequest, NextResponse } from "next/server";
import {
  SETTING_KEYS,
  setSetting,
  deleteSetting,
  getPendingFolderId,
  getPendingFolderLastTest,
  getLastDriveScan,
} from "@/lib/services/appSettings";

async function currentSettings() {
  const [pendingFolder, lastTest, lastScan] = await Promise.all([
    getPendingFolderId(),
    getPendingFolderLastTest(),
    getLastDriveScan(),
  ]);
  return {
    googleDrivePendingFolderId: pendingFolder,
    pendingFolderLastTest: lastTest,
    lastDriveScan: lastScan,
  };
}

export async function GET() {
  return NextResponse.json(await currentSettings());
}

export async function POST(req: NextRequest) {
  let body: { googleDrivePendingFolderId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  if (!("googleDrivePendingFolderId" in body)) {
    return NextResponse.json(
      { error: "NO_SETTINGS", fix: "Send googleDrivePendingFolderId in the request body." },
      { status: 400 },
    );
  }

  const raw = body.googleDrivePendingFolderId;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { error: "INVALID_VALUE", fix: "googleDrivePendingFolderId must be a string." },
      { status: 400 },
    );
  }

  const value = raw.trim();
  if (value === "") {
    // Clearing the saved value reverts the effective setting to the env var.
    await deleteSetting(SETTING_KEYS.pendingFolderId);
  } else {
    if (!/^[\w-]{10,}$/.test(value)) {
      return NextResponse.json(
        {
          error: "INVALID_FOLDER_ID",
          fix: "Paste the Drive folder ID from the folder URL (the segment after /folders/).",
        },
        { status: 400 },
      );
    }
    await setSetting(SETTING_KEYS.pendingFolderId, value);
  }

  return NextResponse.json(await currentSettings());
}
