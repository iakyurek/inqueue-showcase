import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { validateBatchFolder } from "@/lib/services/validator";
import { saveValidationLog } from "@/lib/data";

function sanitizeFolderName(name: string): string {
  // Strip path traversal characters and leading/trailing slashes
  return name.replace(/\.\./g, "").replace(/[/\\]/g, "").trim();
}

export async function POST(req: NextRequest) {
  let batchName: string;
  let batchId: string;

  try {
    const body = await req.json();
    batchName = body.batchName;
    batchId = body.batchId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!batchName || typeof batchName !== "string") {
    return NextResponse.json({ error: "batchName is required" }, { status: 400 });
  }
  if (!batchId || typeof batchId !== "string") {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }

  const safeName = sanitizeFolderName(batchName);
  const batchFolderPath = path.join(process.cwd(), "workspace", "sample-batches", safeName);

  const result = await validateBatchFolder(batchFolderPath);

  // Write a BatchLog summary entry — best effort, don't fail the response if it errors
  try {
    await saveValidationLog(batchId, result);
  } catch {
    // log write failure is non-fatal
  }

  return NextResponse.json(result);
}
