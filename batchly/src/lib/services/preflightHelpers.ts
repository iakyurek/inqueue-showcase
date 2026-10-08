import { parseVariationOptions, buildDraftInventoryProducts } from "@/lib/services/inventoryHelpers";
import { listSupplementalImagesForPreset, validateSupplementalImagePreset } from "@/lib/services/supplementalImageHelpers";
import { buildListingDescription } from "@/lib/services/draftFlowHelpers";
import { type PresetSizeChartResult, calcSizeChartSlots } from "@/lib/services/presetSizeCharts";
import type { GlobalListingPreset, GlobalVariationPreset, GlobalSupplementalImagePreset, StoreEtsyIds } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreflightCheckStatus = "pass" | "warning" | "fail";

export interface PreflightCheck {
  key: string;
  label: string;
  status: PreflightCheckStatus;
  message: string;
}

export interface PreflightSummary {
  selectedCount: number;
  totalImageMax: number;
  supplementalImagesAvailable: number;
  variationEnabled: boolean;
  variationCombinationCount: number;
}

export interface PreflightResult {
  status: PreflightCheckStatus;
  canCreate: boolean;
  checks: PreflightCheck[];
  summary: PreflightSummary;
}

// RowPreview shape needed for preflight (only fields we use)
interface RowPreviewInput {
  designId: string;
  sku: string;
  title: string;
  eligible: boolean;
  alreadyCreated: boolean;
  imageCount: number;
  imageFiles: string[];
  cleanedTags: string[];
  errors: string[];
  warnings: string[];
}

// Store connection shape
interface StoreInput {
  etsyShopId: string | null;
  refreshToken: string | null;
}

// ---------------------------------------------------------------------------
// Etsy limits
// ---------------------------------------------------------------------------
const ETSY_MAX_IMAGES = 10;
const ETSY_MAX_TAGS = 13;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pass(key: string, label: string, message: string): PreflightCheck {
  return { key, label, status: "pass", message };
}

function warn(key: string, label: string, message: string): PreflightCheck {
  return { key, label, status: "warning", message };
}

function fail(key: string, label: string, message: string): PreflightCheck {
  return { key, label, status: "fail", message };
}

// ---------------------------------------------------------------------------
// Main preflight builder
// ---------------------------------------------------------------------------

export function buildPreflight({
  store,
  storeEtsyIds,
  rows,
  selectedDesignIds,
  preset,
  variationPreset,
  supplementalPreset,
  presetSizeCharts,
}: {
  store: StoreInput;
  storeEtsyIds: StoreEtsyIds | null;
  rows: RowPreviewInput[];
  selectedDesignIds: string[];
  preset: GlobalListingPreset | null;
  variationPreset: GlobalVariationPreset | null;
  supplementalPreset: GlobalSupplementalImagePreset | null;
  presetSizeCharts?: PresetSizeChartResult;
}): PreflightResult {
  const checks: PreflightCheck[] = [];

  // -------------------------------------------------------------------------
  // Store setup checks
  // -------------------------------------------------------------------------
  if (store.etsyShopId && store.refreshToken) {
    checks.push(pass("store_connected", "Store connected", "Store has etsyShopId and refresh token."));
  } else {
    checks.push(fail("store_connected", "Store connected", "Store is not connected to Etsy. Connect via OAuth first."));
  }

  if (storeEtsyIds?.taxonomyId) {
    checks.push(pass("taxonomy_id", "Taxonomy ID", `Saved: ${storeEtsyIds.taxonomyId}`));
  } else {
    checks.push(fail("taxonomy_id", "Taxonomy ID", "taxonomyId not saved. Save it in the Store Etsy IDs form on /stores."));
  }

  if (storeEtsyIds?.shippingProfileId) {
    checks.push(pass("shipping_profile_id", "Shipping profile ID", `Saved: ${storeEtsyIds.shippingProfileId}`));
  } else {
    checks.push(fail("shipping_profile_id", "Shipping profile ID", "shippingProfileId not saved. Save it in the Store Etsy IDs form on /stores."));
  }

  if (storeEtsyIds?.readinessStateId) {
    checks.push(pass("readiness_state_id", "Readiness state ID", `Saved: ${storeEtsyIds.readinessStateId}`));
  } else {
    checks.push(fail("readiness_state_id", "Readiness state ID", "readinessStateId not saved. Save it in the Store Etsy IDs form on /stores."));
  }

  // -------------------------------------------------------------------------
  // Selected rows checks
  // -------------------------------------------------------------------------
  if (selectedDesignIds.length < 1) {
    checks.push(fail("selected_count", "Selected rows", "No rows selected. Select at least 1 eligible row."));
  } else if (selectedDesignIds.length > 3) {
    checks.push(fail("selected_count", "Selected rows", `Too many rows selected (${selectedDesignIds.length}). Max 3.`));
  } else {
    checks.push(pass("selected_count", "Selected rows", `${selectedDesignIds.length} row${selectedDesignIds.length !== 1 ? "s" : ""} selected (max 3).`));
  }

  // Per-selected-row checks
  for (const designId of selectedDesignIds) {
    const row = rows.find((r) => r.designId === designId);

    if (!row) {
      checks.push(fail(`row_exists_${designId}`, `Row ${designId} exists`, `Design ${designId} not found in manifest for this store.`));
      continue;
    }

    if (row.alreadyCreated) {
      checks.push(fail(`row_not_created_${designId}`, `Row ${designId} not created`, `${designId} already has a draft created. Duplicate protection prevents recreation.`));
      continue;
    }

    if (!row.eligible) {
      checks.push(fail(`row_eligible_${designId}`, `Row ${designId} eligible`, `${designId} is not eligible: ${row.errors.join("; ")}`));
      continue;
    }

    checks.push(pass(`row_eligible_${designId}`, `Row ${designId} eligible`, `${designId} is eligible.`));

    if (!row.title?.trim()) {
      checks.push(fail(`row_title_${designId}`, `Row ${designId} title`, `${designId} has no title.`));
    } else {
      checks.push(pass(`row_title_${designId}`, `Row ${designId} title`, `Title present (${row.title.length} chars).`));
    }

    if (!row.sku?.trim()) {
      checks.push(fail(`row_sku_${designId}`, `Row ${designId} SKU`, `${designId} has no SKU.`));
    } else {
      checks.push(pass(`row_sku_${designId}`, `Row ${designId} SKU`, `SKU: ${row.sku}`));
    }

    if (row.imageCount < 1) {
      checks.push(fail(`row_images_${designId}`, `Row ${designId} images`, `${designId} has no design/mockup images.`));
    } else {
      checks.push(pass(`row_images_${designId}`, `Row ${designId} images`, `${row.imageCount} design image${row.imageCount !== 1 ? "s" : ""} found.`));
    }
  }

  // -------------------------------------------------------------------------
  // Description checks (against first selected eligible row's title if any)
  // -------------------------------------------------------------------------
  if (!preset) {
    checks.push(fail("description_preset", "Description preset", "GlobalListingPreset not found. Run npm run db:seed."));
  } else {
    checks.push(pass("description_preset", "Description preset", "GlobalListingPreset loaded."));

    if (preset.descriptionTemplate?.trim()) {
      checks.push(pass("description_template", "Description template", `Template present (${preset.descriptionTemplate.trim().length} chars).`));

      // Validate description for the first selected eligible row
      const firstEligibleId = selectedDesignIds.find((id) => {
        const row = rows.find((r) => r.designId === id);
        return row?.eligible && !row.alreadyCreated;
      });
      if (firstEligibleId) {
        const row = rows.find((r) => r.designId === firstEligibleId)!;
        const finalDesc = buildListingDescription(row.title, preset.descriptionTemplate);
        if (!finalDesc.startsWith(row.title.trim())) {
          checks.push(warn("description_starts_with_title", "Description starts with title", "Final description does not start with manifest title."));
        } else {
          checks.push(pass("description_starts_with_title", "Description starts with title", "Description starts with manifest title."));
        }
        if (!finalDesc.includes("ORDER")) {
          checks.push(warn("description_ordering", "Description ordering section", "ORDERING section not detected in description template. Verify the template is complete."));
        } else {
          checks.push(pass("description_ordering", "Description ordering section", "ORDERING section found in description."));
        }
        if (finalDesc.length > 5000) {
          checks.push(warn("description_length", "Description length", `Description is ${finalDesc.length} chars. Very long descriptions may cause issues.`));
        } else {
          checks.push(pass("description_length", "Description length", `Description is ${finalDesc.length} chars.`));
        }
      }
    } else {
      checks.push(warn("description_template", "Description template", "No description template in GlobalListingPreset. Description will be title only."));
    }
  }

  // -------------------------------------------------------------------------
  // Tags checks (first selected eligible row)
  // -------------------------------------------------------------------------
  const firstEligibleRow = selectedDesignIds
    .map((id) => rows.find((r) => r.designId === id))
    .find((r) => r?.eligible && !r.alreadyCreated);

  if (firstEligibleRow) {
    if (firstEligibleRow.cleanedTags.length === 0) {
      checks.push(fail("tags_exist", "Tags", `${firstEligibleRow.designId} has no tags after cleaning.`));
    } else {
      checks.push(pass("tags_exist", "Tags", `${firstEligibleRow.cleanedTags.length} tag${firstEligibleRow.cleanedTags.length !== 1 ? "s" : ""} for ${firstEligibleRow.designId}.`));
    }
    if (firstEligibleRow.cleanedTags.length > ETSY_MAX_TAGS) {
      checks.push(fail("tags_count", "Tags count", `${firstEligibleRow.cleanedTags.length} tags exceeds Etsy max of ${ETSY_MAX_TAGS}.`));
    } else {
      checks.push(pass("tags_count", "Tags count", `${firstEligibleRow.cleanedTags.length} ≤ ${ETSY_MAX_TAGS} (Etsy max).`));
    }
    if (firstEligibleRow.warnings.length > 0) {
      checks.push(warn("tags_ip_warning", "IP/trademark warnings", `Detected: ${firstEligibleRow.warnings.join(", ")}. Review before creating drafts.`));
    }
  }

  // -------------------------------------------------------------------------
  // Preset size chart checks (always-on — hard fail if images missing)
  // -------------------------------------------------------------------------
  const sizeChartCount = presetSizeCharts?.charts.length ?? 0;

  if (!presetSizeCharts) {
    checks.push(pass("preset_size_charts", "Preset size charts", "Preset size chart check skipped."));
  } else if (!presetSizeCharts.found) {
    checks.push(fail(
      "preset_size_charts",
      "Preset size charts",
      `MISSING — ${presetSizeCharts.error ?? "No size chart images found in assets/size-charts/."}`,
    ));
  } else {
    checks.push(pass(
      "preset_size_charts",
      "Preset size charts",
      `${sizeChartCount} size chart${sizeChartCount !== 1 ? "s" : ""} ready in assets/size-charts/ (${presetSizeCharts.charts.map((c) => c.basename).join(", ")}).`,
    ));
  }

  // -------------------------------------------------------------------------
  // Supplemental images checks
  // -------------------------------------------------------------------------
  let supplementalImagesAvailable = 0;

  if (!supplementalPreset || !supplementalPreset.enabled) {
    checks.push(pass("supplemental_images", "Supplemental images", "Supplemental images disabled. No extra images will be added."));
  } else {
    const { warnings: suppWarnings, errors: suppErrors } = validateSupplementalImagePreset(supplementalPreset);

    if (suppErrors.length > 0) {
      checks.push(fail("supplemental_images_folders", "Supplemental image folders", `Folder errors: ${suppErrors.join("; ")}`));
    } else {
      const suppFiles = listSupplementalImagesForPreset(supplementalPreset);
      supplementalImagesAvailable = suppFiles.length;

      if (suppFiles.length === 0) {
        checks.push(warn("supplemental_images_found", "Supplemental images found", "Supplemental images enabled but no files found in configured folders."));
      } else {
        checks.push(pass("supplemental_images_found", "Supplemental images found", `${suppFiles.length} supplemental image${suppFiles.length !== 1 ? "s" : ""} available.`));
      }

      if (suppWarnings.length > 0) {
        checks.push(warn("supplemental_images_warnings", "Supplemental image warnings", suppWarnings.join("; ")));
      }
    }
  }

  // Total image count check (per selected row) — includes preset size charts
  for (const designId of selectedDesignIds) {
    const row = rows.find((r) => r.designId === designId);
    if (!row || !row.eligible || row.alreadyCreated) continue;

    const { chartsToUpload, limitWarning } = calcSizeChartSlots(row.imageCount, sizeChartCount);
    const totalAfterCharts = row.imageCount + chartsToUpload;
    const totalWithSupplemental = totalAfterCharts + supplementalImagesAvailable;
    const finalTotal = Math.min(totalWithSupplemental, ETSY_MAX_IMAGES);

    if (limitWarning) {
      checks.push(warn(
        `image_total_${designId}`,
        `Row ${designId} total images`,
        `${limitWarning}${supplementalImagesAvailable > 0 ? ` (${supplementalImagesAvailable} supplemental image${supplementalImagesAvailable !== 1 ? "s" : ""} may also be skipped)` : ""}`,
      ));
    } else if (totalWithSupplemental > ETSY_MAX_IMAGES) {
      const suppSkipped = totalWithSupplemental - ETSY_MAX_IMAGES;
      checks.push(warn(
        `image_total_${designId}`,
        `Row ${designId} total images`,
        `${row.imageCount} mockup + ${chartsToUpload} size chart + ${supplementalImagesAvailable} supplemental = ${totalWithSupplemental}. Etsy max is ${ETSY_MAX_IMAGES}. ${suppSkipped} supplemental image${suppSkipped !== 1 ? "s" : ""} will be skipped.`,
      ));
    } else {
      const parts: string[] = [`${row.imageCount} mockup`];
      if (chartsToUpload > 0) parts.push(`${chartsToUpload} size chart`);
      if (supplementalImagesAvailable > 0) parts.push(`${supplementalImagesAvailable} supplemental`);
      checks.push(pass(
        `image_total_${designId}`,
        `Row ${designId} total images`,
        `${parts.join(" + ")} = ${finalTotal} (within ${ETSY_MAX_IMAGES} max).`,
      ));
    }
  }

  // -------------------------------------------------------------------------
  // Variation/inventory checks
  // -------------------------------------------------------------------------
  let variationCombinationCount = 0;

  if (!variationPreset || !variationPreset.enabled) {
    checks.push(pass("variation_preset", "Variation preset", "Variation preset disabled. Inventory will not be updated."));
  } else {
    const v1Options = parseVariationOptions(variationPreset.variation1Options);
    const v2Options = parseVariationOptions(variationPreset.variation2Options);
    variationCombinationCount = v1Options.length * v2Options.length;

    if (!variationPreset.variation1PropertyId) {
      checks.push(fail("variation_prop1", `Variation 1 property ID (${variationPreset.variation1Name})`, "variation1PropertyId not set. Save it in Settings → Global Variation Preset."));
    } else {
      checks.push(pass("variation_prop1", `Variation 1 property ID (${variationPreset.variation1Name})`, `Property ID: ${variationPreset.variation1PropertyId}`));
    }

    if (!variationPreset.variation2PropertyId) {
      checks.push(fail("variation_prop2", `Variation 2 property ID (${variationPreset.variation2Name})`, "variation2PropertyId not set. Save it in Settings → Global Variation Preset."));
    } else {
      checks.push(pass("variation_prop2", `Variation 2 property ID (${variationPreset.variation2Name})`, `Property ID: ${variationPreset.variation2PropertyId}`));
    }

    if (v1Options.length === 0) {
      checks.push(fail("variation_options1", `Variation 1 options (${variationPreset.variation1Name})`, "No options defined."));
    } else {
      checks.push(pass("variation_options1", `Variation 1 options (${variationPreset.variation1Name})`, `${v1Options.length} option${v1Options.length !== 1 ? "s" : ""}: ${v1Options.join(", ")}`));
    }

    if (v2Options.length === 0) {
      checks.push(fail("variation_options2", `Variation 2 options (${variationPreset.variation2Name})`, "No options defined."));
    } else {
      checks.push(pass("variation_options2", `Variation 2 options (${variationPreset.variation2Name})`, `${v2Options.length} option${v2Options.length !== 1 ? "s" : ""}: ${v2Options.join(", ")}`));
    }

    if (variationCombinationCount > 100) {
      checks.push(fail("variation_combinations", "Variation combinations", `${variationCombinationCount} combinations exceeds Etsy max of 100.`));
    } else if (variationCombinationCount === 0) {
      checks.push(fail("variation_combinations", "Variation combinations", "0 combinations — check that both variation option lists are non-empty."));
    } else {
      checks.push(pass("variation_combinations", "Variation combinations", `${variationCombinationCount} combinations (≤ 100).`));
    }

    if (variationPreset.quantityPerVariation < 1) {
      checks.push(fail("variation_quantity", "Quantity per variation", `Quantity per variation is ${variationPreset.quantityPerVariation} — must be at least 1.`));
    } else {
      checks.push(pass("variation_quantity", "Quantity per variation", `${variationPreset.quantityPerVariation} per variation.`));
    }

    // Attempt a dry-run build for the first eligible row
    if (firstEligibleRow && variationPreset.variation1PropertyId && variationPreset.variation2PropertyId) {
      const dryRun = buildDraftInventoryProducts({
        baseSku: firstEligibleRow.sku,
        price: 9.99,
        quantityPerVariation: variationPreset.quantityPerVariation,
        variation1PropertyId: Number(variationPreset.variation1PropertyId),
        variation1Name: variationPreset.variation1Name,
        variation1Values: v1Options,
        variation2PropertyId: Number(variationPreset.variation2PropertyId),
        variation2Name: variationPreset.variation2Name,
        variation2Values: v2Options,
      });
      if (!dryRun.ok) {
        checks.push(fail("variation_build", "Variation inventory build", `Dry-run build failed: ${dryRun.error}`));
      } else {
        checks.push(pass("variation_build", "Variation inventory build", `Dry-run OK — ${dryRun.combinationCount} products.`));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Compute final status
  // -------------------------------------------------------------------------
  const hasFail = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warning");
  const overallStatus: PreflightCheckStatus = hasFail ? "fail" : hasWarn ? "warning" : "pass";
  const canCreate = !hasFail;

  // Max image count across selected eligible rows (mockups + size charts + supplemental)
  const maxDesignImages = selectedDesignIds.reduce((max, id) => {
    const row = rows.find((r) => r.designId === id);
    return row ? Math.max(max, row.imageCount) : max;
  }, 0);
  const { chartsToUpload: maxCharts } = calcSizeChartSlots(maxDesignImages, sizeChartCount);
  const totalImageMax = Math.min(maxDesignImages + maxCharts + supplementalImagesAvailable, ETSY_MAX_IMAGES);

  return {
    status: overallStatus,
    canCreate,
    checks,
    summary: {
      selectedCount: selectedDesignIds.length,
      totalImageMax,
      supplementalImagesAvailable,
      variationEnabled: variationPreset?.enabled ?? false,
      variationCombinationCount,
    },
  };
}
