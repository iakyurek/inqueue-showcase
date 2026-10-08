// Redacted settings/connection status for the Batchly settings UI and the
// inQueue hub Connections tab. All aggregation lives in
// src/lib/services/settingsStatus.ts (shared with the settings page).

import { NextResponse } from "next/server";
import { getBatchlySettingsStatus } from "@/lib/services/settingsStatus";
import { logProductionWarningsOnce } from "@/lib/productionGuardrails";

export const dynamic = "force-dynamic";

export async function GET() {
  logProductionWarningsOnce();
  return NextResponse.json(await getBatchlySettingsStatus());
}
