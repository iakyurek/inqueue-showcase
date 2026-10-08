import { NextResponse } from "next/server";
import { listBatchFolders, isConnected } from "@/lib/services/drive";

// Request-independent GET handlers are statically prerendered at build time
// by default, freezing build-time data (e.g. "Drive not connected") into the
// deployed bundle. These routes read live DB/env state — force per-request
// rendering.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isConnected())) {
    return NextResponse.json({ error: "NOT_CONNECTED" }, { status: 401 });
  }

  if (!process.env.GOOGLE_DRIVE_PENDING_FOLDER_ID) {
    return NextResponse.json({ error: "PENDING_FOLDER_NOT_CONFIGURED" }, { status: 400 });
  }

  try {
    const folders = await listBatchFolders();
    return NextResponse.json({ folders });
  } catch (e) {
    const code = e instanceof Error ? e.message : "DRIVE_ERROR";
    if (code === "NOT_CONNECTED") {
      return NextResponse.json({ error: "NOT_CONNECTED" }, { status: 401 });
    }
    if (code === "PENDING_FOLDER_NOT_CONFIGURED") {
      return NextResponse.json({ error: "PENDING_FOLDER_NOT_CONFIGURED" }, { status: 400 });
    }
    return NextResponse.json({ error: "DRIVE_ERROR", detail: code }, { status: 500 });
  }
}
