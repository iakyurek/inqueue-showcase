import fs from "fs";
import Papa from "papaparse";
import type { ManifestRow, ValidationError } from "@/types";
import { normalizeVariationProfileKey } from "@/lib/services/variationProfiles";

const REQUIRED_COLUMNS = [
  "store_folder",
  "design_id",
  "sku",
  "title",
  "description",
  "tags",
  "price",
  "product_type",
] as const;

// variation_profile is intentionally OPTIONAL (not in REQUIRED_COLUMNS) so a
// batch_manifest.csv produced before this feature still parses; a missing
// column or blank cell resolves to the default front_sided profile.

const STORE_FOLDER_PATTERN = /^Store_[A-H]$/;
const DESIGN_ID_PATTERN = /^D\d{3}$/;

export interface ManifestParseResult {
  rows: ManifestRow[];
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function parseManifest(csvPath: string): ManifestParseResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!fs.existsSync(csvPath)) {
    return {
      rows: [],
      errors: [{ code: "MISSING_MANIFEST", message: `batch_manifest.csv not found at ${csvPath}`, path: csvPath }],
      warnings: [],
    };
  }

  const content = fs.readFileSync(csvPath, "utf-8");
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  // Check all required columns are present
  const headers = parsed.meta.fields ?? [];
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    errors.push({
      code: "MISSING_COLUMN",
      message: `Missing required columns: ${missingColumns.join(", ")}`,
    });
    return { rows: [], errors, warnings };
  }

  const rows: ManifestRow[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const raw = parsed.data[i];
    const rowNum = i + 2; // 1-indexed + header row
    const rowRef = `Row ${rowNum} (${raw.store_folder}/${raw.design_id})`;

    // store_folder
    if (!raw.store_folder) {
      errors.push({ code: "EMPTY_FIELD", message: `${rowRef}: store_folder is empty` });
    } else if (!STORE_FOLDER_PATTERN.test(raw.store_folder)) {
      errors.push({ code: "INVALID_STORE_FOLDER", message: `${rowRef}: store_folder "${raw.store_folder}" must match Store_[A-H]`, store: raw.store_folder });
    }

    // design_id
    if (!raw.design_id) {
      errors.push({ code: "EMPTY_FIELD", message: `${rowRef}: design_id is empty` });
    } else if (!DESIGN_ID_PATTERN.test(raw.design_id)) {
      errors.push({ code: "INVALID_DESIGN_ID", message: `${rowRef}: design_id "${raw.design_id}" must match D001-D999`, design: raw.design_id });
    }

    // sku, title, description
    for (const field of ["sku", "title", "description"] as const) {
      if (!raw[field]) {
        errors.push({ code: "EMPTY_FIELD", message: `${rowRef}: ${field} is empty`, store: raw.store_folder, design: raw.design_id });
      }
    }

    // tags
    if (!raw.tags) {
      errors.push({ code: "EMPTY_FIELD", message: `${rowRef}: tags is empty`, store: raw.store_folder, design: raw.design_id });
    }

    // price
    const price = parseFloat(raw.price);
    if (isNaN(price) || price <= 0) {
      errors.push({ code: "INVALID_PRICE", message: `${rowRef}: price "${raw.price}" must be a positive number`, store: raw.store_folder, design: raw.design_id });
    }

    // product_type
    if (raw.product_type !== "PHYSICAL") {
      warnings.push({ code: "NON_PHYSICAL_PRODUCT", message: `${rowRef}: product_type "${raw.product_type}" is not PHYSICAL`, store: raw.store_folder, design: raw.design_id });
    }

    rows.push({
      store_folder: raw.store_folder ?? "",
      design_id: raw.design_id ?? "",
      sku: raw.sku ?? "",
      title: raw.title ?? "",
      description: raw.description ?? "",
      tags: raw.tags ?? "",
      price: isNaN(price) ? 0 : price,
      product_type: raw.product_type ?? "",
      // Normalized here so every downstream path (validate, preview, run, retry,
      // reconcile) sees a resolved key; unknown/pending keys are caught later by
      // resolveVariationProfile before any Etsy write.
      variation_profile: normalizeVariationProfileKey(raw.variation_profile),
    });
  }

  if (parsed.errors.length > 0) {
    for (const pe of parsed.errors) {
      warnings.push({ code: "CSV_PARSE_WARNING", message: `CSV parser: ${pe.message} (row ${pe.row})` });
    }
  }

  return { rows, errors, warnings };
}
