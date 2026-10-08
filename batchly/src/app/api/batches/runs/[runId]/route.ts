import { NextRequest, NextResponse } from "next/server";
import { getBatchRunProgress } from "@/lib/services/batchRunService";

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  if (!runId) return NextResponse.json({ error: "MISSING_RUN_ID" }, { status: 400 });

  try {
    const progress = await getBatchRunProgress(runId);
    return NextResponse.json(progress);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    if (message === "RUN_NOT_FOUND" || message.includes("Invalid") || message.includes("not found")) {
      return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
