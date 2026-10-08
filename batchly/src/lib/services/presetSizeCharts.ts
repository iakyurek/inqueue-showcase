import fs from "fs";
import path from "path";

const ETSY_MAX_IMAGES = 10;
const PRESET_DIR = path.join(process.cwd(), "assets", "size-charts");
const VALID_EXTS = new Set([".jpg", ".jpeg", ".png"]);

export const PRESET_SIZE_CHARTS_DIR = PRESET_DIR;

export interface PresetSizeChart {
  basename: string;
  absolutePath: string;
}

export interface PresetSizeChartResult {
  found: boolean;
  charts: PresetSizeChart[];
  error?: string;
}

/**
 * Reads preset size charts from assets/size-charts/ (sorted alphabetically).
 * Replace the image files in that folder to change the size charts — no code change needed.
 */
export function loadPresetSizeCharts(): PresetSizeChartResult {
  if (!fs.existsSync(PRESET_DIR)) {
    return {
      found: false,
      charts: [],
      error: `Preset size chart folder not found: assets/size-charts/. Create the folder and add .jpg/.png images.`,
    };
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(PRESET_DIR);
  } catch (e) {
    return {
      found: false,
      charts: [],
      error: `Cannot read assets/size-charts/: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const charts = entries
    .filter((name) => VALID_EXTS.has(path.extname(name).toLowerCase()))
    // Numeric-aware sort so size-chart-10 comes after size-chart-2.
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((basename) => ({ basename, absolutePath: path.join(PRESET_DIR, basename) }));

  if (charts.length === 0) {
    return {
      found: false,
      charts: [],
      error: `assets/size-charts/ exists but contains no images (.jpg/.jpeg/.png). Add size chart images there.`,
    };
  }

  return { found: true, charts };
}

/**
 * Given the number of mockup images already in a listing, calculates how many
 * size charts can be appended without exceeding the Etsy 10-image limit.
 */
export function calcSizeChartSlots(mockupCount: number, chartCount: number): {
  chartsToUpload: number;
  skipped: number;
  limitWarning: string | null;
} {
  const remaining = Math.max(0, ETSY_MAX_IMAGES - mockupCount);
  const chartsToUpload = Math.min(chartCount, remaining);
  const skipped = chartCount - chartsToUpload;

  const limitWarning =
    skipped > 0
      ? `${mockupCount} mockup${mockupCount !== 1 ? "s" : ""} + ${chartCount} size chart${chartCount !== 1 ? "s" : ""} = ${mockupCount + chartCount} exceeds Etsy max of ${ETSY_MAX_IMAGES}. ${skipped} size chart${skipped !== 1 ? "s" : ""} skipped.`
      : null;

  return { chartsToUpload, skipped, limitWarning };
}
