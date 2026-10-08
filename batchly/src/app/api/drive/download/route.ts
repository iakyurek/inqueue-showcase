import { NextResponse } from "next/server";
import { isConnected, downloadBatchFolder } from "@/lib/services/drive";
import { validateBatchFolder } from "@/lib/services/validator";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await isConnected())) {
    return NextResponse.json({ error: "NOT_CONNECTED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { folderId, folderName } = body as { folderId?: unknown; folderName?: unknown };

  if (typeof folderId !== "string" || !folderId.trim()) {
    return NextResponse.json({ error: "INVALID_FOLDER_ID" }, { status: 400 });
  }

  if (typeof folderName !== "string" || !folderName.trim()) {
    return NextResponse.json({ error: "INVALID_FOLDER_NAME" }, { status: 400 });
  }

  // Sanitize: reject path traversal attempts
  if (folderName.includes("..") || folderName.includes("/") || folderName.includes("\\")) {
    return NextResponse.json({ error: "INVALID_FOLDER_NAME" }, { status: 400 });
  }

  try {
    const downloadResult = await downloadBatchFolder(folderId.trim(), folderName.trim());
    const validationResult = await validateBatchFolder(downloadResult.destPath);

    return NextResponse.json({ downloadResult, validationResult });
  } catch (e) {
    const code = e instanceof Error ? e.message : "DOWNLOAD_ERROR";
    if (code === "NOT_CONNECTED") {
      return NextResponse.json({ error: "NOT_CONNECTED" }, { status: 401 });
    }
    return NextResponse.json({ error: "DOWNLOAD_ERROR", detail: code }, { status: 500 });
  }
}
