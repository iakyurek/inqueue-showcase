import fs from "fs";
import path from "path";

export const VALID_SUPPLEMENTAL_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

const SUPPLEMENTAL_ROOT = path.join(process.cwd(), "workspace", "supplemental-images");

// Repo-committed default size charts. workspace/ lives on an ephemeral disk
// (wiped on every deploy/idle restart), so the size-chart folder re-seeds
// itself from these bundled assets whenever it is missing or empty — every
// listing always gets its size charts without any operator upload step.
const BUNDLED_SIZE_CHARTS_DIR = path.join(process.cwd(), "assets", "size-charts");

function ensureSizeChartSeed(absFolder: string): void {
  try {
    fs.mkdirSync(absFolder, { recursive: true });
    const existing = fs
      .readdirSync(absFolder)
      .filter((name) => VALID_SUPPLEMENTAL_IMAGE_EXTS.has(path.extname(name).toLowerCase()));
    if (existing.length > 0) return;
    if (!fs.existsSync(BUNDLED_SIZE_CHARTS_DIR)) return;
    for (const name of fs.readdirSync(BUNDLED_SIZE_CHARTS_DIR)) {
      if (!VALID_SUPPLEMENTAL_IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue;
      fs.copyFileSync(path.join(BUNDLED_SIZE_CHARTS_DIR, name), path.join(absFolder, name));
    }
  } catch {
    // Seeding is best-effort; validation will report missing charts loudly.
  }
}

export interface SupplementalImageFile {
  basename: string;
  absolutePath: string;
  category: "size-chart" | "promo";
}

export interface SupplementalImagePresetInput {
  enabled: boolean;
  includeSizeCharts: boolean;
  sizeChartRequiredCount?: number;
  includePromoImages: boolean;
  sizeChartFolder: string;
  promoFolder: string;
  maxSupplementalImages: number;
}

export function listSizeChartImages(preset: SupplementalImagePresetInput): SupplementalImageFile[] {
  if (!preset.includeSizeCharts) return [];
  try {
    const abs = resolveSupplementalFolder(preset.sizeChartFolder);
    return listImagesInFolder(abs, "size-chart");
  } catch {
    return [];
  }
}

// Resolves a relative folder path to an absolute path, constrained under SUPPLEMENTAL_ROOT.
export function resolveSupplementalFolder(relativeFolder: string): string {
  const abs = path.resolve(process.cwd(), relativeFolder);
  // Reject path traversal outside supplemental root
  if (!abs.startsWith(SUPPLEMENTAL_ROOT)) {
    throw new Error(`Folder path must be inside workspace/supplemental-images: ${relativeFolder}`);
  }
  return abs;
}

function listImagesInFolder(absFolder: string, category: "size-chart" | "promo"): SupplementalImageFile[] {
  if (category === "size-chart") ensureSizeChartSeed(absFolder);
  try {
    const entries = fs.readdirSync(absFolder);
    return entries
      .filter((name) => VALID_SUPPLEMENTAL_IMAGE_EXTS.has(path.extname(name).toLowerCase()))
      // Numeric-aware sort so image-10 comes after image-2.
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((basename) => ({
        basename,
        absolutePath: path.join(absFolder, basename),
        category,
      }));
  } catch {
    return [];
  }
}

export function listSupplementalImagesForPreset(preset: SupplementalImagePresetInput): SupplementalImageFile[] {
  if (!preset.enabled) return [];

  const files: SupplementalImageFile[] = [];

  if (preset.includeSizeCharts) {
    try {
      const abs = resolveSupplementalFolder(preset.sizeChartFolder);
      files.push(...listImagesInFolder(abs, "size-chart"));
    } catch {
      // folder path invalid — no files added from this category
    }
  }

  if (preset.includePromoImages) {
    try {
      const abs = resolveSupplementalFolder(preset.promoFolder);
      files.push(...listImagesInFolder(abs, "promo"));
    } catch {
      // folder path invalid
    }
  }

  // Cap to maxSupplementalImages
  return files.slice(0, preset.maxSupplementalImages);
}

export interface SupplementalValidationResult {
  warnings: string[];
  errors: string[];
}

export function validateSupplementalImagePreset(preset: SupplementalImagePresetInput): SupplementalValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!preset.enabled) return { warnings, errors };

  // Validate folder paths
  try {
    resolveSupplementalFolder(preset.sizeChartFolder);
  } catch (e) {
    errors.push(`sizeChartFolder: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    resolveSupplementalFolder(preset.promoFolder);
  } catch (e) {
    errors.push(`promoFolder: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (errors.length > 0) return { warnings, errors };

  const files = listSupplementalImagesForPreset(preset);

  if (preset.includeSizeCharts) {
    try {
      const abs = resolveSupplementalFolder(preset.sizeChartFolder);
      const charts = listImagesInFolder(abs, "size-chart");
      const required = preset.sizeChartRequiredCount ?? 3;
      if (charts.length === 0) {
        warnings.push("Size chart folder is empty — no size chart images will be uploaded.");
      } else if (charts.length < required) {
        warnings.push(`Only ${charts.length} size chart image${charts.length !== 1 ? "s" : ""} found — ${required} required. Add more to workspace/supplemental-images/size-charts/.`);
      }
    } catch { /* already caught above */ }
  }

  if (preset.includePromoImages) {
    try {
      const abs = resolveSupplementalFolder(preset.promoFolder);
      const promos = listImagesInFolder(abs, "promo");
      if (promos.length === 0) warnings.push("Promo folder is empty. No promo images will be uploaded.");
    } catch { /* already caught above */ }
  }

  if (files.length === 0) {
    warnings.push("No supplemental images found in any configured folder.");
  }

  return { warnings, errors };
}
