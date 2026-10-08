import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { parseManifest } from "@/lib/services/manifest";
import type { ManifestRow } from "@/types";
import type { GlobalListingPreset, StoreEtsyIds } from "@prisma/client";

// ---------------------------------------------------------------------------
// Scope constants — Phase 6E, Store A / D001 only
// ---------------------------------------------------------------------------

export const TEST_STORE_FOLDER = "Store_A";
export const TEST_DESIGN_ID = "D001";

// Server-side explicit enablement. All 8 stores opt-in here; no arbitrary client folder accepted.
// LEGACY allowlist — the effective gate when INQUEUE_STORE_CONFIG_SOURCE is unset/'local'.
export const MINI_BATCH_ENABLED_STORE_FOLDERS = new Set([
  "Store_A",
  "Store_B",
  "Store_C",
  "Store_D",
  "Store_E",
  "Store_F",
  "Store_G",
  "Store_H",
]);

// Store enablement gate. Two modes, switched by INQUEUE_STORE_CONFIG_SOURCE:
//   unset / 'local' — today's behavior, byte-for-byte: the hardcoded Set above.
//   'hub'           — hub-managed: Store.configEnabled must be exactly true
//                     (null means "never synced" and is treated as disabled,
//                     so a wrong flip cannot silently enable anything; the
//                     flip runbook's empty-diff check guarantees Store_A is
//                     synced true before the flag changes).
export async function isStoreFolderEnabled(storeFolder: string): Promise<boolean> {
  if (process.env.INQUEUE_STORE_CONFIG_SOURCE !== "hub") {
    return MINI_BATCH_ENABLED_STORE_FOLDERS.has(storeFolder);
  }
  const store = await prisma.store.findUnique({
    where: { driveFolderName: storeFolder },
    select: { configEnabled: true },
  });
  return store?.configEnabled === true;
}

const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");
const VALID_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

// Etsy's per-listing image cap. Etsy raised this to 20; override with
// ETSY_MAX_LISTING_IMAGES=10 if a shop/API tier still enforces the old cap
// (the run engine treats an Etsy "image limit" rejection as a warning, not a
// row failure, so a wrong value degrades gracefully).
export const ETSY_MAX_LISTING_IMAGES = (() => {
  const n = Number(process.env.ETSY_MAX_LISTING_IMAGES);
  return Number.isFinite(n) && n >= 4 && n <= 20 ? Math.floor(n) : 20;
})();

// Slots held back for the supplemental size charts, which upload AFTER the
// mockups. Reserving them here — at mockup-discovery time — is what
// guarantees every listing ends with its full set of charts; before this,
// enough mockups silently squeezed the charts out of the 10-image cap.
export const RESERVED_SIZE_CHART_SLOTS = 3;
const MAX_MOCKUP_IMAGES = ETSY_MAX_LISTING_IMAGES - RESERVED_SIZE_CHART_SLOTS;

// ---------------------------------------------------------------------------
// Description builder
// ---------------------------------------------------------------------------

export function buildListingDescription(
  title: string,
  descriptionTemplate?: string | null,
): string {
  const trimmedTitle = title.trim();
  const trimmedTemplate = descriptionTemplate?.trim() ?? "";
  if (trimmedTemplate) {
    return `${trimmedTitle}\n\n${trimmedTemplate}`;
  }
  return trimmedTitle;
}

// ---------------------------------------------------------------------------
// Tag cleaning
// ---------------------------------------------------------------------------

export function cleanTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().slice(0, 20))
    .filter((t) => t.length > 0)
    .slice(0, 13);
}

// ---------------------------------------------------------------------------
// Title builder
// ---------------------------------------------------------------------------

// Etsy title hard limit.
const ETSY_TITLE_MAX = 140;

// Builds the production listing title directly from the manifest title.
// No debug/test prefix. Only Etsy-safe normalization: collapse whitespace,
// strip leading non-alphanumerics (Etsy requires the title to start with a
// letter or number), and truncate at a word boundary to <= 140 chars.
export function buildListingTitle(rawTitle: string): string {
  let title = rawTitle.replace(/\s+/g, " ").trim();
  if (!title) {
    throw new Error("Manifest title is empty — cannot build a listing title.");
  }
  // Etsy disallows a leading non-alphanumeric character.
  title = title.replace(/^[^A-Za-z0-9]+/, "").trim();
  if (!title) {
    throw new Error(`Title "${rawTitle}" has no usable leading letter or number.`);
  }
  if (title.length > ETSY_TITLE_MAX) {
    const truncated = title.slice(0, ETSY_TITLE_MAX);
    const lastSpace = truncated.lastIndexOf(" ");
    title = (lastSpace > 40 ? truncated.slice(0, lastSpace) : truncated).trim();
  }
  return title;
}

// Backwards-compatible alias kept for older imports; now returns the real
// (non-prefixed) listing title.
export const buildTestTitle = buildListingTitle;

// ---------------------------------------------------------------------------
// IP / trademark warning check (non-blocking)
// ---------------------------------------------------------------------------

const TRADEMARK_TERMS = [
  "World Cup",
  "FIFA",
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "NCAA",
  "Disney",
  "Nike",
  "Adidas",
  "Cristiano Ronaldo",
  "Lionel Messi",
  "Neymar",
];

export function checkTrademarkWarnings(texts: string[]): string[] {
  const combined = texts.join(" ").toLowerCase();
  return TRADEMARK_TERMS.filter((t) => combined.includes(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Duplicate draft prevention — in-memory lock
// ---------------------------------------------------------------------------

const _draftInProgress = new Set<string>();

export function acquireDraftLock(key: string): boolean {
  if (_draftInProgress.has(key)) return false;
  _draftInProgress.add(key);
  return true;
}

export function releaseDraftLock(key: string): void {
  _draftInProgress.delete(key);
}

// ---------------------------------------------------------------------------
// DB loader — GlobalListingPreset + StoreEtsyIds
// ---------------------------------------------------------------------------

export interface PresetAndIds {
  preset: GlobalListingPreset;
  storeEtsyIds: StoreEtsyIds;
}

export interface PresetAndIdsError {
  error: string;
  status: number;
}

export async function loadPresetAndIds(
  storeId: string,
): Promise<PresetAndIds | PresetAndIdsError> {
  const [preset, storeEtsyIds] = await Promise.all([
    prisma.globalListingPreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
  ]);

  if (!preset) {
    return { error: "GlobalListingPreset not found. Run npm run db:seed.", status: 400 };
  }
  if (!storeEtsyIds?.taxonomyId) {
    return {
      error: "Missing taxonomyId. Save it in the Store Etsy IDs form on /stores first.",
      status: 400,
    };
  }
  if (!storeEtsyIds.shippingProfileId) {
    return {
      error: "Missing shippingProfileId. Save it in the Store Etsy IDs form on /stores first.",
      status: 400,
    };
  }
  if (!storeEtsyIds.readinessStateId) {
    return {
      error: "Missing readinessStateId. Save it in the Store Etsy IDs form on /stores first.",
      status: 400,
    };
  }

  return { preset, storeEtsyIds };
}

export function isPresetAndIdsError(v: PresetAndIds | PresetAndIdsError): v is PresetAndIdsError {
  return "error" in v;
}

// ---------------------------------------------------------------------------
// Manifest + optional image discovery
// ---------------------------------------------------------------------------

export interface ManifestData {
  row: ManifestRow;
  folderName: string;
  images: string[];
}

// ---------------------------------------------------------------------------
// Latest manifest folder discovery
// ---------------------------------------------------------------------------

export function findLatestManifestFolder(): string | null {
  if (!fs.existsSync(DOWNLOADS_DIR)) return null;

  const entries = fs
    .readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .reverse(); // newest-first by folder name

  for (const folderName of entries) {
    const csvPath = path.join(DOWNLOADS_DIR, folderName, "batch_manifest.csv");
    if (fs.existsSync(csvPath)) return folderName;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Image discovery for a specific design — returns basenames only
// ---------------------------------------------------------------------------

export function findImagesForDesign(
  folderName: string,
  storeFolder: string,
  designId: string,
): string[] {
  const imageDir = path.join(DOWNLOADS_DIR, folderName, storeFolder, designId);
  if (!fs.existsSync(imageDir)) return [];

  return fs
    .readdirSync(imageDir)
    .filter((f) => VALID_IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    // Numeric-aware sort so _10.jpg comes after _2.jpg (Etsy upload order).
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, MAX_MOCKUP_IMAGES);
}

// ---------------------------------------------------------------------------
// Per-row preview builder for mini-batch preview
// ---------------------------------------------------------------------------

export interface RowPreview {
  storeFolder: string;
  designId: string;
  sku: string;
  title: string;
  testTitle: string | null;
  descriptionLength: number;
  descriptionSource: "global_preset" | "title_only";
  finalDescriptionPreview: string;
  price: number;
  cleanedTags: string[];
  tagCount: number;
  imageCount: number;
  imageFiles: string[];
  warnings: string[];
  errors: string[];
  eligible: boolean;
}

export function buildRowPreview(
  row: ManifestRow,
  folderName: string,
  preset: GlobalListingPreset | null,
  storeEtsyIds: StoreEtsyIds | null,
): RowPreview {
  const errors: string[] = [];

  if (!row.design_id) errors.push("design_id is empty");
  if (!row.sku) errors.push("sku is empty");

  let testTitle: string | null = null;
  if (!row.title.trim()) {
    errors.push("title is empty");
  } else {
    try {
      testTitle = buildTestTitle(row.title);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Invalid title");
    }
  }

  const cleanedTags = cleanTags(row.tags);
  if (cleanedTags.length === 0) errors.push("no valid tags after cleaning");
  // Metadata quality gate: silent truncation/shortfall weakens Etsy search
  // without anyone noticing. Name the exact offending tags so the fix is
  // one edit away.
  const rawTags = row.tags.split(",").map((t) => t.trim()).filter(Boolean);
  const overlongTags = rawTags.filter((t) => t.length > 20);
  if (overlongTags.length > 0) {
    errors.push(`tag(s) over Etsy's 20-character limit (would be cut mid-word): ${overlongTags.join(" | ")}`);
  }
  const dedupedTags = new Set(rawTags.map((t) => t.toLowerCase()));
  if (dedupedTags.size < rawTags.length) {
    errors.push("duplicate tags — every tag must be unique");
  }
  if (rawTags.length > 0 && rawTags.length < 13) {
    errors.push(`only ${rawTags.length} of 13 tags — full tag coverage drives Etsy search ranking`);
  }

  const effectivePrice =
    row.price > 0
      ? row.price
      : preset?.defaultPrice
        ? parseFloat(preset.defaultPrice)
        : NaN;
  if (isNaN(effectivePrice) || effectivePrice <= 0) {
    errors.push("price is invalid and no default price fallback exists");
  }

  if (!storeEtsyIds?.taxonomyId) errors.push("taxonomyId is missing — save it in the Store Etsy IDs form on /stores");
  if (!storeEtsyIds?.shippingProfileId) errors.push("shippingProfileId is missing — save it in the Store Etsy IDs form on /stores");
  if (!storeEtsyIds?.readinessStateId) errors.push("readinessStateId is missing — save it in the Store Etsy IDs form on /stores");

  const imageFiles = row.design_id
    ? findImagesForDesign(folderName, row.store_folder, row.design_id)
    : [];

  const imageDir = path.join(
    DOWNLOADS_DIR,
    folderName,
    row.store_folder,
    row.design_id,
  );
  if (!fs.existsSync(imageDir)) {
    errors.push(`image folder missing: ${row.store_folder}/${row.design_id}/`);
  } else if (imageFiles.length === 0) {
    errors.push("no valid image files (.jpg, .jpeg, .png) found in image folder");
  }

  const finalDescription = buildListingDescription(row.title, preset?.descriptionTemplate);
  const descriptionSource = preset?.descriptionTemplate?.trim()
    ? ("global_preset" as const)
    : ("title_only" as const);
  const finalDescriptionPreview = finalDescription.slice(0, 120) + (finalDescription.length > 120 ? "…" : "");

  const warnings = checkTrademarkWarnings([row.title, row.description, row.tags, finalDescription]);

  return {
    storeFolder: row.store_folder,
    designId: row.design_id,
    sku: row.sku,
    title: row.title,
    testTitle,
    descriptionLength: finalDescription.length,
    descriptionSource,
    finalDescriptionPreview,
    price: row.price,
    cleanedTags,
    tagCount: cleanedTags.length,
    imageCount: imageFiles.length,
    imageFiles,
    warnings,
    errors,
    eligible: errors.length === 0,
  };
}

export function findManifestData(
  storeFolder: string,
  designId: string,
  includeImages = false,
): ManifestData | null {
  if (!fs.existsSync(DOWNLOADS_DIR)) return null;

  const entries = fs
    .readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .reverse(); // newest-first by folder name

  for (const folderName of entries) {
    const csvPath = path.join(DOWNLOADS_DIR, folderName, "batch_manifest.csv");
    if (!fs.existsSync(csvPath)) continue;

    const result = parseManifest(csvPath);
    const row = result.rows.find(
      (r) => r.store_folder === storeFolder && r.design_id === designId,
    );
    if (!row) continue;

    let images: string[] = [];
    if (includeImages) {
      const imageDir = path.join(DOWNLOADS_DIR, folderName, storeFolder, designId);
      if (fs.existsSync(imageDir)) {
        images = fs
          .readdirSync(imageDir)
          .filter((f) => VALID_IMAGE_EXTS.has(path.extname(f).toLowerCase()))
          // Numeric-aware sort so _10.jpg comes after _2.jpg (Etsy upload order).
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .slice(0, MAX_MOCKUP_IMAGES)
          .map((f) => path.join(imageDir, f));
      }
    }

    return { row, folderName, images };
  }

  return null;
}
