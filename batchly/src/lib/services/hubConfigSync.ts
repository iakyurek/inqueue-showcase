// Hub store-config sync — Batchly side.
//
// The inQueue hub pushes its full store configuration (see the repo-root plan
// docs/plans/store-config-hub-plan.md). Batchly maps the hub-owned fields onto
// its own rows:
//   displayName → Store.name
//   enabled     → Store.configEnabled   (consulted only when the
//                                        INQUEUE_STORE_CONFIG_SOURCE=hub flag is on)
//   skuPrefix   → Store.skuPrefix
//   etsyIds     → StoreEtsyIds (5 resource IDs, stored as strings)
//   presets     → the three Global*Preset singletons
//
// NEVER touched here: accessToken, refreshToken, tokenExpiresAt, etsyShopId,
// etsyShopName — Batchly is the Etsy token custodian; the hub only mirrors
// connection status through /api/internal/etsy/test-connection.
//
// Modes (INQUEUE_STORE_CONFIG_SOURCE):
//   unset/'local' → dry-run: validate + report the field diff, write nothing.
//   'hub'         → apply, then record the payload version in AppSetting.

import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/services/appSettings";
import { saveSyncedVariationProfiles, type VariationProfilesPayload } from "@/lib/services/variationProfiles";

export const HUB_CONFIG_VERSION_KEY = "inqueue.config.appliedVersion";

const SLOT_RE = /^Store_[A-F]$/;
const ETSY_ID_FIELDS = ["taxonomyId", "shippingProfileId", "readinessStateId", "returnPolicyId", "sectionId"] as const;

export interface HubSyncStore {
  slot: string;
  displayName?: string;
  enabled?: boolean;
  skuPrefix?: string;
  driveFolderId?: string;
  notes?: string;
  etsyIds?: Partial<Record<(typeof ETSY_ID_FIELDS)[number], number | string | null>>;
}

export interface HubSyncPayload {
  configVersion: number;
  generatedAt?: string;
  stores: HubSyncStore[];
  presets?: {
    listing?: Record<string, unknown>;
    variation?: Record<string, unknown>;
    supplemental?: Record<string, unknown>;
  };
  // Canonical variation profiles (front_sided complete, double_sided pending).
  // Consumed verbatim and stored as-is; never edited on the Batchly side.
  variationProfiles?: VariationProfilesPayload;
}

export interface HubSyncDiffEntry {
  slot: string;
  field: string;
  current: unknown;
  incoming: unknown;
}

export interface HubSyncResult {
  applied: boolean;
  mode: "hub" | "dry-run";
  appliedVersion?: number | null;
  diff?: HubSyncDiffEntry[];
  error?: string;
  warnings?: string[];
}

function getMode(): "hub" | "dry-run" {
  return process.env.INQUEUE_STORE_CONFIG_SOURCE === "hub" ? "hub" : "dry-run";
}

function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}

export function validateHubSyncPayload(payload: unknown): string | null {
  const p = payload as HubSyncPayload;
  if (!p || typeof p !== "object") return "expected a JSON object";
  if (!Number.isInteger(p.configVersion) || p.configVersion < 0) return "configVersion must be a non-negative integer";
  if (!Array.isArray(p.stores)) return "stores must be an array";
  for (const store of p.stores) {
    if (!store || typeof store !== "object" || !SLOT_RE.test(store.slot ?? "")) {
      return `invalid store slot: ${store?.slot}`;
    }
  }
  return null;
}

export async function computeHubSyncDiff(payload: HubSyncPayload): Promise<{ diff: HubSyncDiffEntry[]; warnings: string[] }> {
  const diff: HubSyncDiffEntry[] = [];
  const warnings: string[] = [];
  for (const hubStore of payload.stores) {
    const store = await prisma.store.findUnique({
      where: { driveFolderName: hubStore.slot },
      include: { etsyIds: true },
    });
    if (!store) {
      // No row for this slot yet — e.g. a freshly provisioned Postgres that was
      // never seeded. The hub owns store identity, so sync CREATES the row
      // (never with tokens; Etsy is connected separately). Without this, the
      // Etsy Connect flow fails with store_not_synced.
      diff.push({ slot: hubStore.slot, field: "row", current: null, incoming: "create" });
      continue;
    }
    const checks: Array<[string, unknown, unknown]> = [
      ["displayName", store.name, hubStore.displayName ?? ""],
      ["enabled", store.configEnabled, hubStore.enabled === true],
      ["skuPrefix", store.skuPrefix, hubStore.skuPrefix ?? ""],
    ];
    for (const field of ETSY_ID_FIELDS) {
      checks.push([`etsyIds.${field}`, store.etsyIds?.[field] ?? null, normalizeId(hubStore.etsyIds?.[field])]);
    }
    for (const [field, current, incoming] of checks) {
      if (current !== incoming) diff.push({ slot: hubStore.slot, field, current, incoming });
    }
  }
  return { diff, warnings };
}

export async function applyHubConfigSync(payload: unknown): Promise<HubSyncResult> {
  const invalid = validateHubSyncPayload(payload);
  if (invalid) return { applied: false, mode: getMode(), error: `invalid payload: ${invalid}` };
  const p = payload as HubSyncPayload;

  const appliedRaw = await getSetting(HUB_CONFIG_VERSION_KEY);
  const lastApplied = appliedRaw !== null ? Number(appliedRaw) : null;
  if (lastApplied !== null && p.configVersion < lastApplied) {
    return { applied: false, mode: getMode(), error: "stale", appliedVersion: lastApplied };
  }

  const { diff, warnings } = await computeHubSyncDiff(p);

  if (getMode() !== "hub") {
    return { applied: false, mode: "dry-run", diff, warnings, appliedVersion: lastApplied };
  }

  // Apply per store. Upsert on driveFolderName (the unique cross-tool key), so
  // a slot missing from this database — a fresh Postgres that was never seeded —
  // is created rather than skipped. Tokens and shop identity are structurally
  // untouchable here: neither the create nor the update payload mentions
  // accessToken / refreshToken / tokenExpiresAt / etsyShopId / etsyShopName, so
  // an existing Etsy connection always survives a sync.
  for (const hubStore of p.stores) {
    const store = await prisma.store.upsert({
      where: { driveFolderName: hubStore.slot },
      create: {
        name: hubStore.displayName || hubStore.slot,
        driveFolderName: hubStore.slot,
        skuPrefix: hubStore.skuPrefix ?? "",
        configEnabled: hubStore.enabled === true,
      },
      update: {
        ...(hubStore.displayName ? { name: hubStore.displayName } : {}),
        skuPrefix: hubStore.skuPrefix ?? "",
        configEnabled: hubStore.enabled === true,
      },
      select: { id: true },
    });
    if (hubStore.etsyIds) {
      const ids = Object.fromEntries(ETSY_ID_FIELDS.map((f) => [f, normalizeId(hubStore.etsyIds?.[f])]));
      await prisma.storeEtsyIds.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id, ...ids },
        update: ids,
      });
    }
  }

  // Presets: upsert the three singletons following the settings routes' pattern
  // (findFirst → update/create). Only whitelisted, type-checked fields are
  // forwarded — never the raw payload (no id/createdAt/unknown-column injection).
  await applyPresets(p.presets);

  // Variation profiles: stored verbatim as the JSON source of truth for the
  // matrix. Only accepted when well-formed so a malformed push can't wipe a
  // previously-synced good copy.
  if (p.variationProfiles && Array.isArray(p.variationProfiles.profiles)) {
    await saveSyncedVariationProfiles(p.variationProfiles);
  }

  await setSetting(HUB_CONFIG_VERSION_KEY, String(p.configVersion));
  return { applied: true, mode: "hub", appliedVersion: p.configVersion, diff, warnings };
}

type FieldSpec = Record<string, "string" | "number" | "boolean">;

function pick(source: Record<string, unknown> | undefined, spec: FieldSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!source || typeof source !== "object") return out;
  for (const [field, type] of Object.entries(spec)) {
    if (typeof source[field] === type) out[field] = source[field];
  }
  return out;
}

const LISTING_FIELDS: FieldSpec = {
  whoMade: "string", whenMade: "string", listingType: "string", renewalOption: "string",
  isPersonalizable: "boolean", defaultQuantity: "number", defaultPrice: "string",
  descriptionTemplate: "string", materials: "string",
  itemWeight: "number", itemWeightUnit: "string",
  itemLength: "number", itemWidth: "number", itemHeight: "number", itemDimensionsUnit: "string",
};
const VARIATION_FIELDS: FieldSpec = {
  enabled: "boolean",
  variation1Name: "string", variation1PropertyId: "string", variation1Options: "string",
  variation2Name: "string", variation2PropertyId: "string", variation2Options: "string",
  quantityPerVariation: "number", priceMode: "string", skuMode: "string",
};
const SUPPLEMENTAL_FIELDS: FieldSpec = {
  enabled: "boolean", includeSizeCharts: "boolean", sizeChartRequiredCount: "number",
  includePromoImages: "boolean", sizeChartFolder: "string", promoFolder: "string",
  maxSupplementalImages: "number",
};

async function applyPresets(presets: HubSyncPayload["presets"]): Promise<void> {
  if (!presets || typeof presets !== "object") return;
  const listing = pick(presets.listing, LISTING_FIELDS);
  if (Object.keys(listing).length) {
    const existing = await prisma.globalListingPreset.findFirst();
    if (existing) await prisma.globalListingPreset.update({ where: { id: existing.id }, data: listing });
    else await prisma.globalListingPreset.create({ data: listing });
  }
  const variation = pick(presets.variation, VARIATION_FIELDS);
  if (Object.keys(variation).length) {
    const existing = await prisma.globalVariationPreset.findFirst();
    if (existing) await prisma.globalVariationPreset.update({ where: { id: existing.id }, data: variation });
    else await prisma.globalVariationPreset.create({ data: variation });
  }
  const supplemental = pick(presets.supplemental, SUPPLEMENTAL_FIELDS);
  if (Object.keys(supplemental).length) {
    const existing = await prisma.globalSupplementalImagePreset.findFirst();
    if (existing) await prisma.globalSupplementalImagePreset.update({ where: { id: existing.id }, data: supplemental });
    else await prisma.globalSupplementalImagePreset.create({ data: supplemental });
  }
}
