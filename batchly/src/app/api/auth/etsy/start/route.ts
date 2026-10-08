import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthorizationUrl,
  writePkceState,
} from "@/lib/services/etsy";
import { buildHubConfigureRedirect, canonicalStoreFolder } from "@/lib/sso";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3030";
const HUB_URL = process.env.INQUEUE_HUB_URL ?? "http://localhost:4000";

export async function GET(req: NextRequest) {
  // Two ways to name the store:
  //   storeId     — Batchly's own /stores page (internal cuid)
  //   storeFolder — the inQueue hub's Configure tab (Store_A..Store_F); the
  //                 hub never learns cuids, the folder is the cross-tool key.
  const storeId = req.nextUrl.searchParams.get("storeId");
  const rawFolder = req.nextUrl.searchParams.get("storeFolder");
  const storeFolder = canonicalStoreFolder(rawFolder);

  // returnTo: ONLY the literal sentinel "hub" is honored — anything else is
  // silently dropped. The hub URL is resolved from INQUEUE_HUB_URL below, so no
  // request-supplied URL can ever steer a redirect.
  const returnTo = req.nextUrl.searchParams.get("returnTo") === "hub" ? ("hub" as const) : undefined;

  // Every failure before the OAuth hop lands here. When the hub started the
  // flow, send the user back to the hub Configure tab — NOT to Batchly's
  // /stores page, which the hub user never asked for.
  const fail = (reason: string) =>
    NextResponse.redirect(
      returnTo === "hub"
        ? buildHubConfigureRedirect(HUB_URL, { etsy: "error", reason, store: storeFolder ?? "" })
        : `${BASE}/stores?etsy=error&reason=${encodeURIComponent(reason)}`,
    );

  if (!storeId && !rawFolder) return fail("missing_store_id");
  if (rawFolder && !storeFolder) return fail("invalid_store_folder");
  if (!process.env.ETSY_CLIENT_ID) return fail("missing_credentials");

  // Verify the store exists (and resolve folder → id when the hub initiated).
  const store = storeId
    ? await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, driveFolderName: true } })
    : await prisma.store.findUnique({ where: { driveFolderName: storeFolder as string }, select: { id: true, driveFolderName: true } });
  if (!store) {
    // The hub owns store identity: a missing row means this Batchly database
    // has never received a config sync (e.g. a fresh Postgres that was never
    // seeded). "Sync now" on the Configure tab creates the row.
    return fail("store_not_synced");
  }

  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await writePkceState(state, {
    storeId: store.id,
    storeFolder: store.driveFolderName,
    codeVerifier,
    ...(returnTo ? { returnTo } : {}),
  });

  try {
    const authUrl = buildAuthorizationUrl(state, codeChallenge);
    return NextResponse.redirect(authUrl);
  } catch {
    return fail("missing_credentials");
  }
}
