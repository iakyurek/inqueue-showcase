import { NextResponse } from "next/server";
import { scanPendingBatches } from "@/lib/services/scanPendingBatches";

export async function POST() {
  try {
    const batches = await scanPendingBatches();
    return NextResponse.json({ batches });
  } catch (e) {
    const message = e instanceof Error ? e.message : "DRIVE_ERROR";
    if (message === "NOT_CONNECTED") {
      return NextResponse.json({ error: "NOT_CONNECTED" }, { status: 401 });
    }
    if (message === "PENDING_FOLDER_NOT_CONFIGURED") {
      return NextResponse.json({ error: "PENDING_FOLDER_NOT_CONFIGURED" }, { status: 400 });
    }
    return NextResponse.json({ error: "DRIVE_ERROR", detail: message }, { status: 500 });
  }
}
