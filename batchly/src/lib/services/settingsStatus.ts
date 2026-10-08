// Shared, redacted settings/connection aggregate used by both the
// GET /api/settings/status route (hub Connections tab) and the server-rendered
// settings page. Returns booleans, names, and timestamps only — never token
// values or client secrets. Read-only: no Drive or Etsy network calls, and no
// imports from draft-creation code.

import { prisma } from "@/lib/prisma";
import { getConnectionInfo } from "@/lib/services/drive";
import {
  getPendingFolderId,
  getPendingFolderLastTest,
  getLastDriveScan,
  type PendingFolderTestResult,
  type LastDriveScan,
  type EffectiveSetting,
} from "@/lib/services/appSettings";
import { findDuplicateDriveFolders } from "@/lib/services/storeIntegrity";
import {
  computeProductionWarnings,
  isProductionEnv,
  type ProductionWarning,
} from "@/lib/productionGuardrails";

export type TokenState = "ok" | "expiring" | "expired" | "none";

export interface EtsyStoreStatus {
  id: string;
  name: string;
  driveFolderName: string;
  skuPrefix: string;
  connected: boolean;
  shopName: string | null;
  etsyShopId: string | null;
  tokenState: TokenState;
  tokenExpiresAt: string | null;
  hasEtsyIds: boolean;
  readinessMissing: string[];
}

export interface BatchlySettingsStatus {
  app: "batchly";
  production: boolean;
  warnings: ProductionWarning[];
  drive: {
    connected: boolean;
    email: string | null;
    connectedAt: string | null;
    pendingFolder: {
      configured: boolean;
      source: EffectiveSetting["source"];
      lastTest: PendingFolderTestResult | null;
      lastScan: LastDriveScan | null;
    };
  };
  etsy: {
    stores: EtsyStoreStatus[];
    duplicateDriveFolders: string[];
  };
}

function deriveTokenState(store: {
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): TokenState {
  // Etsy access tokens rotate hourly and refresh automatically; the refresh
  // token is what keeps a store connected, so its presence drives the state.
  if (!store.refreshToken) return "none";
  if (!store.tokenExpiresAt) return "ok";
  const msLeft = store.tokenExpiresAt.getTime() - Date.now();
  if (msLeft <= 0) return "expired"; // informational — refresh will renew it
  if (msLeft < 10 * 60 * 1000) return "expiring";
  return "ok";
}

const READINESS_ID_FIELDS = [
  "taxonomyId",
  "shippingProfileId",
  "readinessStateId",
] as const;

export async function getBatchlySettingsStatus(): Promise<BatchlySettingsStatus> {
  const [stores, pendingFolder, lastTest, lastScan] = await Promise.all([
    prisma.store.findMany({
      // Deliberately select presence-checkable fields only; raw token strings
      // stay server-side and are reduced to booleans/derived state below.
      select: {
        id: true,
        name: true,
        driveFolderName: true,
        skuPrefix: true,
        etsyShopId: true,
        etsyShopName: true,
        refreshToken: true,
        tokenExpiresAt: true,
        etsyIds: {
          select: {
            taxonomyId: true,
            shippingProfileId: true,
            readinessStateId: true,
          },
        },
      },
      orderBy: { driveFolderName: "asc" },
    }),
    getPendingFolderId(),
    getPendingFolderLastTest(),
    getLastDriveScan(),
  ]);

  const duplicates = findDuplicateDriveFolders(stores);

  const etsyStores: EtsyStoreStatus[] = stores.map((store) => ({
    id: store.id,
    name: store.name,
    driveFolderName: store.driveFolderName,
    skuPrefix: store.skuPrefix,
    connected: !!store.refreshToken,
    shopName: store.etsyShopName,
    etsyShopId: store.etsyShopId,
    tokenState: deriveTokenState(store),
    tokenExpiresAt: store.tokenExpiresAt?.toISOString() ?? null,
    hasEtsyIds: !!store.etsyIds,
    readinessMissing: READINESS_ID_FIELDS.filter((field) => !store.etsyIds?.[field]),
  }));

  return {
    app: "batchly",
    production: isProductionEnv(),
    warnings: computeProductionWarnings(),
    drive: {
      ...(await getConnectionInfo()),
      pendingFolder: {
        configured: !!pendingFolder.value,
        source: pendingFolder.source,
        lastTest,
        lastScan,
      },
    },
    etsy: {
      stores: etsyStores,
      duplicateDriveFolders: duplicates.map((d) => d.driveFolderName),
    },
  };
}
