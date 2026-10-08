import { NextResponse } from "next/server";
import { deleteTokens } from "@/lib/services/drive";

export async function POST() {
  await deleteTokens();
  return NextResponse.json({ ok: true });
}
