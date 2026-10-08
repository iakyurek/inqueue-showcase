import fs from "fs";
import path from "path";
import { parseManifest } from "./manifest";
import type { ValidationError, ValidationResult } from "@/types";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const FALLBACK_STORES = ["Store_A", "Store_B", "Store_C", "Store_D", "Store_E", "Store_F", "Store_G", "Store_H"];
const EXPECTED_DESIGNS = ["D001", "D002", "D003", "D004", "D005", "D006", "D007", "D008", "D009", "D010"];
import { ETSY_MAX_LISTING_IMAGES, RESERVED_SIZE_CHART_SLOTS } from "@/lib/services/draftFlowHelpers";

// Mockup images per design — the remaining slots are reserved for the
// supplemental size charts that upload after them.
const MAX_IMAGES_PER_DESIGN = ETSY_MAX_LISTING_IMAGES - RESERVED_SIZE_CHART_SLOTS;

function isImageFile(filename: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export async function validateBatchFolder(batchFolderPath: string): Promise<ValidationResult> {
  const batchName = path.basename(batchFolderPath);
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const missingFolders: string[] = [];
  const missingImages: string[] = [];

  let totalStoresFound = 0;
  let totalDesignFoldersFound = 0;
  let totalImagesFound = 0;

  // Check batch folder itself exists
  if (!fs.existsSync(batchFolderPath)) {
    return {
      valid: false,
      batchName,
      batchFolderPath,
      manifestRowCount: 0,
      manifestStoreFolderCount: 0,
      totalStoresFound: 0,
      totalDesignFoldersFound: 0,
      totalImagesFound: 0,
      missingFolders: [batchFolderPath],
      missingImages: [],
      errors: [{ code: "MISSING_BATCH_FOLDER", message: `Batch folder not found: ${batchFolderPath}`, path: batchFolderPath }],
      warnings: [],
      checkedAt: new Date().toISOString(),
    };
  }

  // Parse manifest
  const csvPath = path.join(batchFolderPath, "batch_manifest.csv");
  const manifest = parseManifest(csvPath);
  errors.push(...manifest.errors);
  warnings.push(...manifest.warnings);

  // Derive store and design lists from manifest when available; fall back to hardcoded defaults
  const manifestDesignCodes = manifest.rows.length > 0
    ? Array.from(new Set(manifest.rows.map((r) => r.design_id)))
    : EXPECTED_DESIGNS;

  const manifestStoreFolders = manifest.rows.length > 0
    ? Array.from(new Set(manifest.rows.map((r) => r.store_folder).filter(Boolean)))
    : FALLBACK_STORES;

  // Walk store folders
  for (const store of manifestStoreFolders) {
    const storePath = path.join(batchFolderPath, store);

    if (!fs.existsSync(storePath)) {
      missingFolders.push(store);
      errors.push({ code: "MISSING_FOLDER", message: `Store folder missing: ${store}`, path: storePath, store });
      continue;
    }

    totalStoresFound++;

    // Walk design folders within this store
    for (const design of manifestDesignCodes) {
      const designPath = path.join(storePath, design);

      if (!fs.existsSync(designPath)) {
        missingFolders.push(`${store}/${design}`);
        errors.push({ code: "MISSING_FOLDER", message: `Design folder missing: ${store}/${design}`, path: designPath, store, design });
        continue;
      }

      totalDesignFoldersFound++;

      // Count images
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(designPath);
      } catch {
        errors.push({ code: "FOLDER_READ_ERROR", message: `Cannot read folder: ${store}/${design}`, path: designPath, store, design });
        continue;
      }

      const images = entries.filter(isImageFile);

      if (images.length === 0) {
        missingImages.push(`${store}/${design} — no images`);
        errors.push({ code: "MISSING_IMAGE", message: `No images found in ${store}/${design}`, path: designPath, store, design });
      } else {
        totalImagesFound += images.length;
        if (images.length > MAX_IMAGES_PER_DESIGN) {
          warnings.push({ code: "TOO_MANY_IMAGES", message: `${store}/${design} has ${images.length} images (max ${MAX_IMAGES_PER_DESIGN} mockups — ${RESERVED_SIZE_CHART_SLOTS} of Etsy's ${ETSY_MAX_LISTING_IMAGES} image slots are reserved for size charts)`, store, design });
        }
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    batchName,
    batchFolderPath,
    manifestRowCount: manifest.rows.length,
    manifestStoreFolderCount: manifestStoreFolders.length,
    totalStoresFound,
    totalDesignFoldersFound,
    totalImagesFound,
    missingFolders,
    missingImages,
    errors,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}
