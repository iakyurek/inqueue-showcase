import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  readPkceState,
  deletePkceState,
  exchangeCodeForTokens,
  fetchShopIdentity,
  saveEtsyTokens,
} from "@/lib/services/etsy";
import { buildHubConfigureRedirect } from "@/lib/sso";

const BASE = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3030";
const HUB_URL = process.env.INQUEUE_HUB_URL ?? "http://localhost:4000";

// Terminal redirect for every branch AFTER the PKCE state is read. When the
// flow was initiated from the hub Configure tab (returnTo === "hub" in the
// single-use state file — never from the callback query string), the browser
// goes back to the hub's /configure route, identifying the store by its slot
// (the hub's vocabulary). Otherwise Batchly's own /stores page, as before.
// The hub origin comes from env, so nothing request-supplied is ever followed.
function finalRedirect(
  pkce: { returnTo?: "hub"; storeFolder?: string; storeId: string },
  params: Record<string, string>,
): string {
  if (pkce.returnTo === "hub") {
    return buildHubConfigureRedirect(HUB_URL, { ...params, store: pkce.storeFolder ?? "" });
  }
  const query = new URLSearchParams({ ...params, store: pkce.storeId }).toString();
  return `${BASE}/stores?${query}`;
}

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  // Read the PKCE state FIRST (when we have one) so that even "user denied on
  // Etsy" and "missing code" land the hub user back on the hub Configure tab
  // rather than on Batchly's /stores page.
  const pkce = state ? await readPkceState(state) : null;

  if (!state || !pkce) {
    const reason = !state ? "missing_state" : "invalid_state";
    return NextResponse.redirect(`${BASE}/stores?etsy=error&reason=${reason}`);
  }

  // Delete PKCE state immediately — single use
  await deletePkceState(state);

  if (error) {
    return NextResponse.redirect(finalRedirect(pkce, { etsy: "error", reason: error }));
  }

  if (!code) {
    return NextResponse.redirect(finalRedirect(pkce, { etsy: "error", reason: "missing_code" }));
  }

  const { storeId, codeVerifier } = pkce;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(finalRedirect(pkce, { etsy: "error", reason }));
  }

  // Fetch shop identity (non-fatal — tokens are saved even if shop fetch fails)
  const shop = await fetchShopIdentity(tokens.access_token);
  if (!shop) {
    console.warn(`[etsy/callback] shop identity fetch returned null for storeId=${storeId}`);
  }

  // Duplicate-shop guard: block if this Etsy shop is already connected to a DIFFERENT store
  if (shop?.shopId) {
    const existing = await prisma.store.findFirst({
      where: { etsyShopId: shop.shopId, id: { not: storeId } },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.redirect(
        finalRedirect(pkce, {
          etsy: "error",
          reason: "shop_already_connected",
          conflictStore: existing.name,
          shopName: shop.shopName ?? shop.shopId,
        }),
      );
    }
  }

  try {
    await saveEtsyTokens(storeId, tokens, shop);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "db_write_failed";
    return NextResponse.redirect(finalRedirect(pkce, { etsy: "error", reason }));
  }

  return NextResponse.redirect(
    finalRedirect(pkce, {
      etsy: "connected",
      ...(shop ? {} : { shopWarning: "shop_missing" }),
    }),
  );
}
