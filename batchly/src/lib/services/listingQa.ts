import { prisma } from "@/lib/prisma";
import { getListingDetails, getListingImages, getListingInventory } from "@/lib/services/etsy";
import { listSizeChartImages } from "@/lib/services/supplementalImageHelpers";

export type QACheckStatus = "pass" | "warning" | "fail";

export interface QACheck {
  key: string;
  label: string;
  status: QACheckStatus;
  message: string;
}

export interface ListingQAResult {
  success: true;
  storeId: string;
  listingId: string;
  qaStatus: QACheckStatus;
  checks: QACheck[];
  summary: {
    state: string;
    imageCount: number;
    tagCount: number;
    inventoryProductCount: number;
    hasVariations: boolean;
    productSkus: string[];
    descriptionLength: number;
    price: number | null;
    materials: string[];
    itemWeight: number | null;
    itemWeightUnit: string | null;
    itemLength: number | null;
    itemWidth: number | null;
    itemHeight: number | null;
    itemDimensionsUnit: string | null;
  };
}

function worst(statuses: QACheckStatus[]): QACheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warning")) return "warning";
  return "pass";
}

export async function runListingQA(
  storeId: string,
  listingId: string,
  expectedSku?: string,
): Promise<ListingQAResult> {
  const checks: QACheck[] = [];
  const [variationPreset, supplementalPreset, storeEtsyIds] = await Promise.all([
    prisma.globalVariationPreset.findFirst(),
    prisma.globalSupplementalImagePreset.findFirst(),
    prisma.storeEtsyIds.findUnique({ where: { storeId } }),
  ]);

  const [details, images, inventory] = await Promise.all([
    getListingDetails(storeId, listingId),
    getListingImages(storeId, listingId),
    getListingInventory(storeId, listingId),
  ]);

  const stateLower = details.state.toLowerCase();
  const isActive = stateLower === "active";
  const isDraft = stateLower === "draft" || stateLower === "inactive";
  checks.push({
    key: "state",
    label: "Listing state",
    status: isActive ? "fail" : isDraft ? "pass" : "warning",
    message: isActive
      ? `FAIL: Listing is ACTIVE/PUBLISHED (state=${details.state}). It should be a draft.`
      : isDraft
        ? `Pass: Listing is draft/inactive (state=${details.state}).`
        : `Warning: Unexpected state "${details.state}". Verify in Etsy.`,
  });

  const hasTitle = details.title.trim().length > 0;
  const hasTestMarker = /\b(Batchly Test|Draft Test|Test)\b/i.test(details.title);
  checks.push({
    key: "title",
    label: "Title",
    status: !hasTitle || hasTestMarker ? "fail" : "pass",
    message: !hasTitle
      ? "FAIL: Title is empty."
      : hasTestMarker
        ? `FAIL: Title contains a test/debug marker: "${details.title}".`
        : `Pass: Title present with no test/debug marker (${details.title.length} chars).`,
  });

  checks.push({
    key: "description_first_line",
    label: "Description first line",
    status: details.descriptionFirstLine.length > 0 ? "pass" : "warning",
    message: details.descriptionFirstLine.length > 0
      ? `Pass: First line present: "${details.descriptionFirstLine.slice(0, 60)}${details.descriptionFirstLine.length > 60 ? "..." : ""}"`
      : "Warning: Description first line is empty. Should be the manifest row title.",
  });

  checks.push({
    key: "description_length",
    label: "Description length",
    status: details.descriptionLength === 0 ? "warning" : details.descriptionLength > 200 ? "pass" : "warning",
    message: details.descriptionLength === 0
      ? "Warning: Description is empty."
      : details.descriptionLength > 200
        ? `Pass: Description is ${details.descriptionLength} chars (likely includes template).`
        : `Warning: Description is only ${details.descriptionLength} chars; it may be missing the template.`,
  });

  checks.push({
    key: "tags",
    label: "Tags",
    status: details.tagCount === 0 ? "warning" : "pass",
    message: details.tagCount === 0
      ? "Warning: No tags present."
      : `Pass: ${details.tagCount} tag${details.tagCount !== 1 ? "s" : ""} present.`,
  });

  checks.push({
    key: "images",
    label: "Image count",
    status: images.imageCount === 0 ? "fail" : images.imageCount > 10 ? "warning" : "pass",
    message: images.imageCount === 0
      ? "FAIL: No images found on this listing."
      : images.imageCount > 10
        ? `Warning: ${images.imageCount} images exceeds Etsy's 10-image limit.`
        : `Pass: ${images.imageCount} image${images.imageCount !== 1 ? "s" : ""} (ranks: ${images.ranks.join(", ")}).`,
  });

  if (supplementalPreset?.enabled) {
    const maxDesignImages = 10 - (supplementalPreset.maxSupplementalImages ?? 4);
    const likelyHasSupplemental = images.imageCount > Math.max(1, maxDesignImages);
    checks.push({
      key: "supplemental_images",
      label: "Supplemental images",
      status: likelyHasSupplemental ? "pass" : "warning",
      message: likelyHasSupplemental
        ? `Pass: Image count (${images.imageCount}) suggests supplemental images were included.`
        : `Warning: Supplemental images are enabled but image count (${images.imageCount}) may not include them.`,
    });
  }

  if (variationPreset?.enabled) {
    const hasInv = inventory.inventoryProductCount > 0 && inventory.hasVariations;
    checks.push({
      key: "variations",
      label: "Variation inventory",
      status: hasInv ? "pass" : "warning",
      message: hasInv
        ? `Pass: ${inventory.inventoryProductCount} variation product(s) found (${inventory.propertyNames.join(", ")}).`
        : `Warning: Variation preset is enabled but no variation inventory detected.`,
    });
  } else {
    checks.push({
      key: "variations",
      label: "Variation inventory",
      status: "pass",
      message: inventory.hasVariations
        ? `Note: Variation preset is disabled but ${inventory.inventoryProductCount} inventory products were found.`
        : "Pass: Variation preset disabled; no variation inventory expected.",
    });
  }

  if (expectedSku?.trim()) {
    const expected = expectedSku.trim();
    const hasExactSku = inventory.productSkus.includes(expected);
    const hasVariationSku = inventory.productSkus.some((sku) => sku === expected || sku.startsWith(`${expected}-`));
    checks.push({
      key: "inventory_sku",
      label: "Inventory SKU",
      status: hasExactSku || hasVariationSku ? "pass" : "fail",
      message: hasExactSku
        ? `Pass: Manifest SKU ${expected} is present in Etsy inventory.`
        : hasVariationSku
          ? `Pass: Variation SKUs are based on manifest SKU ${expected}.`
          : `FAIL: Manifest SKU ${expected} not found in Etsy inventory. Found: ${inventory.productSkus.join(", ") || "none"}.`,
    });
  }

  if (storeEtsyIds?.taxonomyId && details.taxonomyId != null) {
    const matches = Number(storeEtsyIds.taxonomyId) === details.taxonomyId;
    checks.push({
      key: "taxonomy_id",
      label: "Taxonomy ID",
      status: matches ? "pass" : "warning",
      message: matches
        ? `Pass: Taxonomy ID matches saved value (${details.taxonomyId}).`
        : `Warning: Listing taxonomy ID (${details.taxonomyId}) differs from saved value (${storeEtsyIds.taxonomyId}).`,
    });
  }

  if (storeEtsyIds?.shippingProfileId && details.shippingProfileId != null) {
    const matches = Number(storeEtsyIds.shippingProfileId) === details.shippingProfileId;
    checks.push({
      key: "shipping_profile",
      label: "Shipping profile",
      status: matches ? "pass" : "warning",
      message: matches
        ? `Pass: Shipping profile ID matches saved value (${details.shippingProfileId}).`
        : `Warning: Listing shipping profile (${details.shippingProfileId}) differs from saved value (${storeEtsyIds.shippingProfileId}).`,
    });
  }

  const expectedMaterials = ["cotton", "bella canvas", "gildan"];
  const materialsLower = details.materials.map((m) => m.toLowerCase());
  const missingMaterials = expectedMaterials.filter((m) => !materialsLower.includes(m));
  checks.push({
    key: "materials",
    label: "Materials",
    status: details.materials.length === 0 ? "fail" : missingMaterials.length > 0 ? "warning" : "pass",
    message: details.materials.length === 0
      ? "FAIL: No materials set on this listing."
      : missingMaterials.length > 0
        ? `Warning: Materials present but missing: ${missingMaterials.join(", ")}.`
        : `Pass: Materials include ${details.materials.join(", ")}.`,
  });

  const weightOk = details.itemWeight != null && details.itemWeightUnit === "oz" && details.itemWeight === 4;
  checks.push({
    key: "item_weight",
    label: "Item weight",
    status: details.itemWeight == null ? "fail" : weightOk ? "pass" : "warning",
    message: details.itemWeight == null
      ? "FAIL: No item weight set on this listing."
      : weightOk
        ? `Pass: Item weight is ${details.itemWeight} ${details.itemWeightUnit}.`
        : `Warning: Item weight is ${details.itemWeight} ${details.itemWeightUnit ?? "?"}; expected 4 oz.`,
  });

  const dimsOk = details.itemLength === 13 && details.itemWidth === 10 && details.itemHeight === 1 && details.itemDimensionsUnit === "in";
  checks.push({
    key: "item_dimensions",
    label: "Item dimensions",
    status: details.itemLength == null || details.itemWidth == null || details.itemHeight == null
      ? "fail"
      : dimsOk ? "pass" : "warning",
    message: details.itemLength == null || details.itemWidth == null || details.itemHeight == null
      ? "FAIL: No item dimensions set on this listing."
      : dimsOk
        ? `Pass: Dimensions are ${details.itemLength}x${details.itemWidth}x${details.itemHeight} ${details.itemDimensionsUnit}.`
        : `Warning: Dimensions are ${details.itemLength}x${details.itemWidth}x${details.itemHeight} ${details.itemDimensionsUnit ?? "?"}; expected 13x10x1 in.`,
  });

  if (supplementalPreset?.enabled && supplementalPreset.includeSizeCharts) {
    const sizeCharts = listSizeChartImages(supplementalPreset);
    const required = supplementalPreset.sizeChartRequiredCount ?? 3;
    const filenames = sizeCharts.map((file) => file.basename).join(", ");
    checks.push({
      key: "size_chart_files",
      label: "Size chart images",
      status: sizeCharts.length < required ? "fail" : "pass",
      message: sizeCharts.length < required
        ? `FAIL: ${required} size chart images required; found ${sizeCharts.length}.`
        : `Pass: ${sizeCharts.length} size chart image${sizeCharts.length !== 1 ? "s" : ""} available (${required} required). Files: ${filenames}.`,
    });
  }

  checks.push({
    key: "image_cap",
    label: "Image cap (<=10)",
    status: images.imageCount > 10 ? "fail" : "pass",
    message: images.imageCount > 10
      ? `FAIL: ${images.imageCount} images exceed Etsy's 10-image maximum.`
      : `Pass: ${images.imageCount} image${images.imageCount !== 1 ? "s" : ""}; within the 10-image limit.`,
  });

  return {
    success: true,
    storeId,
    listingId,
    qaStatus: worst(checks.map((check) => check.status)),
    checks,
    summary: {
      state: details.state,
      imageCount: images.imageCount,
      tagCount: details.tagCount,
      inventoryProductCount: inventory.inventoryProductCount,
      hasVariations: inventory.hasVariations,
      productSkus: inventory.productSkus,
      descriptionLength: details.descriptionLength,
      price: details.price,
      materials: details.materials,
      itemWeight: details.itemWeight,
      itemWeightUnit: details.itemWeightUnit,
      itemLength: details.itemLength,
      itemWidth: details.itemWidth,
      itemHeight: details.itemHeight,
      itemDimensionsUnit: details.itemDimensionsUnit,
    },
  };
}
