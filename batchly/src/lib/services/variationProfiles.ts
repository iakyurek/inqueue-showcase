import { getSetting, setSetting, SETTING_KEYS } from "@/lib/services/appSettings";

// ---------------------------------------------------------------------------
// Variation profiles — CONSUMER side.
//
// The canonical matrix is defined in the hub (lib/variationProfiles) and pushed
// here by config-sync as a JSON blob (AppSetting `variationProfiles`). Batchly
// never re-derives or edits the matrix; it resolves the profile a manifest row
// declares and validates it before any Etsy write.
//
// Safety model (additive): front_sided is the default and is always allowed so
// existing front-only listings keep working even before the first sync. Any
// other profile (double_sided, or an unknown key) is allowed ONLY when the hub
// has synced a definition whose status is "complete" with offerings. So a
// double_sided row fails validation until the hub has synced the double_sided
// matrix — it can never silently borrow front_sided pricing, and there is no
// fallback from double_sided to front_sided.
// ---------------------------------------------------------------------------

export const VARIATION_PROFILE_KEYS = {
  FRONT_SIDED: "front_sided",
  DOUBLE_SIDED: "double_sided",
} as const;

export const DEFAULT_VARIATION_PROFILE = VARIATION_PROFILE_KEYS.FRONT_SIDED;

export interface VariationProfileOffering {
  styleKey: string;
  styleLabel: string;
  colorKey: string;
  colorLabel: string;
  price: string;
  quantity: number;
  enabled: boolean;
}

export interface VariationProfile {
  key: string;
  label: string;
  version: number;
  status: "complete" | "pending" | string;
  variation1: { name: string; options: unknown[] };
  variation2: { name: string; options: unknown[] };
  offerings: VariationProfileOffering[];
  disabledCombinations?: unknown[];
}

export interface VariationProfilesPayload {
  defaultProfileKey: string;
  profiles: VariationProfile[];
}

// Manifest values are free text; fold empties/whitespace/case to the default so
// legacy manifests (no column) and blank cells resolve to front_sided.
export function normalizeVariationProfileKey(raw: string | null | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "" ? DEFAULT_VARIATION_PROFILE : v;
}

// Test seam: when test mode is on, the resolver reads _seededDefault (which may
// be null to simulate "nothing synced") and never touches the database.
let _testMode = false;
let _seededDefault: VariationProfilesPayload | null = null;
export function __setDefaultVariationProfilesForTests(p: VariationProfilesPayload | null): void {
  _testMode = true;
  _seededDefault = p;
}
export function __clearVariationProfileTestMode(): void {
  _testMode = false;
  _seededDefault = null;
}

// Persist the hub-synced payload (called by hubConfigSync).
export async function saveSyncedVariationProfiles(payload: VariationProfilesPayload): Promise<void> {
  await setSetting(SETTING_KEYS.variationProfiles, JSON.stringify(payload));
}

export async function getSyncedVariationProfiles(): Promise<VariationProfilesPayload | null> {
  // Test seam takes precedence so the resolver can be exercised without a DB.
  if (_testMode) return _seededDefault;
  const raw = await getSetting(SETTING_KEYS.variationProfiles);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VariationProfilesPayload;
  } catch {
    return null;
  }
}

export async function getVariationProfile(key: string): Promise<VariationProfile | null> {
  const payload = await getSyncedVariationProfiles();
  const normalized = normalizeVariationProfileKey(key);
  return payload?.profiles.find((p) => p.key === normalized) ?? null;
}

export interface ProfileResolution {
  key: string;                 // normalized profile key the row uses
  usable: boolean;             // safe to create an Etsy draft with?
  reason?: string;             // populated when !usable (surfaced to the operator)
  profile: VariationProfile | null;
}

// The gate every draft-creation path must pass through. Returns a structured
// result rather than throwing so callers can attach it to validation/preview.
export async function resolveVariationProfile(rawKey: string | null | undefined): Promise<ProfileResolution> {
  const key = normalizeVariationProfileKey(rawKey);
  const profile = await getVariationProfile(key);

  // front_sided is the default and always allowed (existing behavior). Its rich
  // matrix is applied when synced; when not yet synced it still proceeds exactly
  // as today.
  if (key === VARIATION_PROFILE_KEYS.FRONT_SIDED) {
    return { key, usable: true, profile };
  }

  if (!profile) {
    return {
      key,
      usable: false,
      reason: `Variation profile "${key}" is not recognized (no synced definition). Only front_sided is available; run Sync now in the hub after configuring it.`,
      profile: null,
    };
  }

  if (profile.status !== "complete" || profile.offerings.length === 0) {
    return {
      key,
      usable: false,
      reason: `The ${profile.label || key} variation profile is not configured yet (status: ${profile.status}). Supply its variation matrix in the hub before creating this draft.`,
      profile,
    };
  }

  return { key, usable: true, profile };
}
