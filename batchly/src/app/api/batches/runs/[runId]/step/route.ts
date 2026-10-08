import { NextRequest, NextResponse } from "next/server";
import { processNextRow } from "@/lib/services/batchRunService";

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  if (!runId) return NextResponse.json({ error: "MISSING_RUN_ID" }, { status: 400 });

  try {
    const result = await processNextRow(runId);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN_ERROR";
    if (message === "RUN_NOT_FOUND") return NextResponse.json({ error: "RUN_NOT_FOUND" }, { status: 404 });
    if (message === "RUN_CANCELED") return NextResponse.json({ error: "RUN_CANCELED" }, { status: 409 });
    console.error(`[runs/step] runId=${runId} error: ${message}`);
    return NextResponse.json({ error: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
