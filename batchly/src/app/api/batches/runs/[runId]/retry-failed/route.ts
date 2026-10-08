import { NextRequest, NextResponse } from "next/server";
import { retryFailedRows } from "@/lib/services/batchRunService";

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  if (!runId) return NextResponse.json({ error: "MISSING_RUN_ID" }, { status: 400 });

  try {
    const result = await retryFailedRows(runId);
    return NextResponse.json({
      success: true,
      retriableCount: result.retriableCount,
      partialManualCount: result.partialManualCount,
      repairedPartialCount: result.repairedPartialCount,
      repairErrors: result.repairErrors,
      // keep resetCount as alias for backwards compatibility
      resetCount: result.retriableCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    if (message === "RUN_NOT_FOUND") return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
