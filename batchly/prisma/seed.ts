import { PrismaClient } from "@prisma/client";
import { findDuplicateDriveFolders, formatDuplicateStoreFolderError } from "../src/lib/services/storeIntegrity";

const prisma = new PrismaClient();

const STORE_DATA = [
  { name: "Store A", driveFolderName: "Store_A", skuPrefix: "SA" },
  { name: "Store B", driveFolderName: "Store_B", skuPrefix: "SB" },
  { name: "Store C", driveFolderName: "Store_C", skuPrefix: "SC" },
  { name: "Store D", driveFolderName: "Store_D", skuPrefix: "SD" },
  { name: "Store E", driveFolderName: "Store_E", skuPrefix: "SE" },
  { name: "Store F", driveFolderName: "Store_F", skuPrefix: "SF" },
  { name: "Store G", driveFolderName: "Store_G", skuPrefix: "SG" },
  { name: "Store H", driveFolderName: "Store_H", skuPrefix: "SH" },
];

const BATCH_DATA = [
  { name: "Batch 001 — Summer Floral",      status: "DONE",       createdAt: new Date("2024-11-10") },
  { name: "Batch 002 — Mountain Prints",    status: "PROCESSING", createdAt: new Date("2024-11-14") },
  { name: "Batch 003 — Minimal Typography", status: "READY",      createdAt: new Date("2024-11-16") },
  { name: "Batch 004 — Holiday Collection", status: "PENDING",    createdAt: new Date("2024-11-17") },
];

const DESIGN_CODES = ["D001","D002","D003","D004","D005","D006","D007","D008","D009","D010"];

// 10-slot pattern: 7 DRAFT_CREATED, 1 ERROR, 1 NEEDS_REVIEW, 1 PENDING
const STATUS_PATTERN = [
  "DRAFT_CREATED","DRAFT_CREATED","DRAFT_CREATED","DRAFT_CREATED",
  "DRAFT_CREATED","DRAFT_CREATED","DRAFT_CREATED",
  "ERROR","NEEDS_REVIEW","PENDING",
];

function makeDescription() {
  return "Beautifully designed print-ready artwork. Ships within 3-5 business days.";
}

function makeTags() {
  return "wall art,print,digital,home decor,minimalist,gift";
}

async function main() {
  console.log("🌱 Seeding database...");

  // B5 guard: never seed two stores with the same Drive folder — that would make
  // store lookup nondeterministic and could route listings to the wrong shop.
  const seedDuplicates = findDuplicateDriveFolders(
    STORE_DATA.map((s) => ({ id: s.driveFolderName, name: s.name, driveFolderName: s.driveFolderName })),
  );
  if (seedDuplicates.length > 0) {
    throw new Error(formatDuplicateStoreFolderError(seedDuplicates));
  }

  // Clear existing data (order matters due to FK constraints)
  await prisma.batchLog.deleteMany();
  await prisma.listingImage.deleteMany();
  await prisma.listing.deleteMany();
  await prisma.design.deleteMany();
  await prisma.batchStore.deleteMany();
  await prisma.storeEtsyIds.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.store.deleteMany();
  await prisma.globalListingPreset.deleteMany();
  await prisma.globalVariationPreset.deleteMany();
  await prisma.globalSupplementalImagePreset.deleteMany();

  // Create stores (without OAuth fields — those are set at runtime via Etsy connect)
  const stores = await Promise.all(
    STORE_DATA.map((s) =>
      prisma.store.create({
        data: { name: s.name, driveFolderName: s.driveFolderName, skuPrefix: s.skuPrefix },
      }),
    ),
  );
  console.log(`  ✓ ${stores.length} stores created`);

  // Create batches
  const batches = await Promise.all(
    BATCH_DATA.map((b) =>
      prisma.batch.create({ data: { name: b.name, status: b.status, createdAt: b.createdAt } }),
    ),
  );
  console.log(`  ✓ ${batches.length} batches created`);

  // Link all stores to all batches
  await prisma.batchStore.createMany({
    data: batches.flatMap((batch) =>
      stores.map((store) => ({ batchId: batch.id, storeId: store.id })),
    ),
  });
  console.log(`  ✓ ${batches.length * stores.length} BatchStore links created`);

  // Create designs and listings for each batch
  for (const batch of batches) {
    // 10 designs per batch
    const designs = await Promise.all(
      DESIGN_CODES.map((code) =>
        prisma.design.create({ data: { designCode: code, batchId: batch.id } }),
      ),
    );

    // 80 listings per batch (8 stores × 10 designs)
    const listingRows: {
      batchId: string; storeId: string; designId: string; sku: string;
      title: string; description: string; tags: string; price: number;
      productType: string; status: string; etsyListingId: string | null;
      errorMessage: string | null;
    }[] = [];

    for (const store of stores) {
      for (let i = 0; i < designs.length; i++) {
        const design = designs[i];
        const status = STATUS_PATTERN[i % STATUS_PATTERN.length];
        const sku = `${store.skuPrefix}-${design.designCode}-CU5`;

        listingRows.push({
          batchId: batch.id,
          storeId: store.id,
          designId: design.id,
          sku,
          title: `${batch.name} · ${design.designCode} · ${store.name}`,
          description: makeDescription(),
          tags: makeTags(),
          price: parseFloat((14.99 + i * 0.5).toFixed(2)),
          productType: "PHYSICAL",
          status,
          etsyListingId: status === "DRAFT_CREATED" ? `etsy-mock-${batch.id}-${store.id}-${design.designCode}` : null,
          errorMessage:
            status === "ERROR"
              ? "Image upload failed: file size exceeds 10MB limit."
              : status === "NEEDS_REVIEW"
              ? "Title contains restricted keywords. Please review before publishing."
              : null,
        });
      }
    }

    await prisma.listing.createMany({ data: listingRows });
  }

  const listingCount = await prisma.listing.count();
  const designCount  = await prisma.design.count();
  console.log(`  ✓ ${designCount} designs and ${listingCount} listings created`);

  // Batch logs for the PROCESSING batch (index 1)
  const processingBatch = batches[1];
  await prisma.batchLog.createMany({
    data: [
      { batchId: processingBatch.id, level: "INFO",  message: "Batch started processing.",                                                                 createdAt: new Date("2024-11-14T09:00:00Z") },
      { batchId: processingBatch.id, level: "INFO",  message: "Store_A D001 draft created (etsy-id: 12345678).",                                           createdAt: new Date("2024-11-14T09:01:12Z") },
      { batchId: processingBatch.id, level: "INFO",  message: "Store_A D002 draft created (etsy-id: 12345679).",                                           createdAt: new Date("2024-11-14T09:02:04Z") },
      { batchId: processingBatch.id, level: "ERROR", message: "Store_B D002 image upload failed: file size 11.2MB exceeds 10MB limit.",                    createdAt: new Date("2024-11-14T09:03:45Z") },
      { batchId: processingBatch.id, level: "WARN",  message: "Store_C D005 title contains restricted keyword 'best seller'. Flagged for review.",          createdAt: new Date("2024-11-14T09:05:22Z") },
      { batchId: processingBatch.id, level: "INFO",  message: "42 of 80 listings processed.",                                                              createdAt: new Date("2024-11-14T09:30:00Z") },
    ],
  });
  console.log("  ✓ 6 batch logs created");

  const DEFAULT_DESCRIPTION_TEMPLATE = `ORDERING:

1. Review all photos
2. Choose Size and Color from drop-down menu
3. If personalization box is available, add your text color
4. Add each shirt to cart one at a time
5. Click "Add to Cart" - you can go back to add more products
6. Click "Proceed to Checkout"
7. Add note to seller for any requests

BULK DISCOUNTS AND SPECIAL REQUESTS:
We offer bulk discounts and are open to special requests. Please feel free to direct message us with any inquiries.

CARE INSTRUCTIONS:
Wash inside out, gentle cycle, cold water, tumble dry low, medium iron.

PRODUCTION AND SHIPPING:
Processing time is next day. First Class Shipping is 2-5 business days (after processing time).
If you need an item sooner, upgrade shipping at checkout.
Shipping will automatically combine for multiple orders. Please check color and quantity before checking out.

RETURN POLICY:
We do not accept returns for shirts unless there is a product quality issue. Due to our print-on-demand business model, we cannot accept returns for any other reason. Thank you for understanding.

Thank you for choosing our shop. Our top priority is your satisfaction.`;

  // Upsert one GlobalListingPreset with shared defaults
  await prisma.globalListingPreset.create({
    data: {
      whoMade: "i_did",
      whenMade: "made_to_order",
      listingType: "physical",
      renewalOption: "automatic",
      isPersonalizable: false,
      defaultQuantity: 1,
      defaultPrice: "9.99",
      descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
      materials: "Cotton,bella canvas,gildan",
      itemWeight: 4,
      itemWeightUnit: "oz",
      itemLength: 13,
      itemWidth: 10,
      itemHeight: 1,
      itemDimensionsUnit: "in",
    },
  });
  console.log("  ✓ GlobalListingPreset created");

  // Upsert one StoreEtsyIds record per store (all IDs null — filled via UI)
  await prisma.storeEtsyIds.createMany({
    data: stores.map((s) => ({ storeId: s.id })),
  });
  console.log(`  ✓ ${stores.length} StoreEtsyIds records created`);

  // GlobalVariationPreset — disabled by default until operator configures property IDs
  await prisma.globalVariationPreset.create({
    data: {
      enabled: false,
      variation1Name: "Size",
      variation1PropertyId: null,
      variation1Options: "S,M,L,XL,2XL,3XL",
      variation2Name: "Color",
      variation2PropertyId: null,
      variation2Options: "Black,White,Ash,Sport Grey,Navy",
      quantityPerVariation: 999,
      priceMode: "manifest",
      skuMode: "base-option-combo",
    },
  });
  console.log("  ✓ GlobalVariationPreset created (disabled by default)");

  // GlobalSupplementalImagePreset — size charts enabled by default, promo optional
  await prisma.globalSupplementalImagePreset.create({
    data: {
      enabled: true,
      includeSizeCharts: true,
      sizeChartRequiredCount: 3,
      includePromoImages: false,
      sizeChartFolder: "workspace/supplemental-images/size-charts",
      promoFolder: "workspace/supplemental-images/promo",
      maxSupplementalImages: 4,
    },
  });
  console.log("  ✓ GlobalSupplementalImagePreset created (disabled by default)");

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
