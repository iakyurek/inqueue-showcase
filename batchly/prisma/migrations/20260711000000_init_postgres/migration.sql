-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "etsyShopName" TEXT,
    "driveFolderName" TEXT NOT NULL,
    "skuPrefix" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "etsyShopId" TEXT,
    "configEnabled" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "GlobalListingPreset" (
    "id" TEXT NOT NULL,
    "whoMade" TEXT NOT NULL DEFAULT 'i_did',
    "whenMade" TEXT NOT NULL DEFAULT 'made_to_order',
    "listingType" TEXT NOT NULL DEFAULT 'physical',
    "renewalOption" TEXT NOT NULL DEFAULT 'automatic',
    "isPersonalizable" BOOLEAN NOT NULL DEFAULT false,
    "defaultQuantity" INTEGER NOT NULL DEFAULT 1,
    "defaultPrice" TEXT NOT NULL DEFAULT '9.99',
    "descriptionTemplate" TEXT,
    "materials" TEXT NOT NULL DEFAULT 'Cotton,bella canvas,gildan',
    "itemWeight" DOUBLE PRECISION NOT NULL DEFAULT 4,
    "itemWeightUnit" TEXT NOT NULL DEFAULT 'oz',
    "itemLength" DOUBLE PRECISION NOT NULL DEFAULT 13,
    "itemWidth" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "itemHeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "itemDimensionsUnit" TEXT NOT NULL DEFAULT 'in',

    CONSTRAINT "GlobalListingPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalVariationPreset" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "variation1Name" TEXT NOT NULL DEFAULT 'Size',
    "variation1PropertyId" TEXT,
    "variation1Options" TEXT NOT NULL DEFAULT 'S,M,L,XL,2XL,3XL',
    "variation2Name" TEXT NOT NULL DEFAULT 'Color',
    "variation2PropertyId" TEXT,
    "variation2Options" TEXT NOT NULL DEFAULT 'Black,White,Ash,Sport Grey,Navy',
    "quantityPerVariation" INTEGER NOT NULL DEFAULT 999,
    "priceMode" TEXT NOT NULL DEFAULT 'manifest',
    "skuMode" TEXT NOT NULL DEFAULT 'base-option-combo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalVariationPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalSupplementalImagePreset" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includeSizeCharts" BOOLEAN NOT NULL DEFAULT true,
    "sizeChartRequiredCount" INTEGER NOT NULL DEFAULT 3,
    "includePromoImages" BOOLEAN NOT NULL DEFAULT false,
    "sizeChartFolder" TEXT NOT NULL DEFAULT 'workspace/supplemental-images/size-charts',
    "promoFolder" TEXT NOT NULL DEFAULT 'workspace/supplemental-images/promo',
    "maxSupplementalImages" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSupplementalImagePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreEtsyIds" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "taxonomyId" TEXT,
    "shippingProfileId" TEXT,
    "readinessStateId" TEXT,
    "returnPolicyId" TEXT,
    "sectionId" TEXT,

    CONSTRAINT "StoreEtsyIds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driveFolder" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchStore" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "BatchStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "designCode" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "productType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "etsyListingId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftCreationRun" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "storeFolder" TEXT NOT NULL,
    "batchFolder" TEXT NOT NULL,
    "requestedDesignIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DraftCreationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftCreationRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "storeId" TEXT NOT NULL,
    "storeFolder" TEXT NOT NULL,
    "batchFolder" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "listingId" TEXT,
    "status" TEXT NOT NULL,
    "imagesAttempted" INTEGER NOT NULL DEFAULT 0,
    "imagesUploaded" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT,
    "errors" TEXT,
    "imageErrors" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftCreationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchLog" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRun" (
    "id" TEXT NOT NULL,
    "batchFolder" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalStores" INTEGER NOT NULL DEFAULT 0,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "partial" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "BatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRunStore" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "storeFolder" TEXT NOT NULL,
    "storeName" TEXT NOT NULL,
    "storeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "skipReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attempted" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "partial" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BatchRunStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRunRow" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "storeRunId" TEXT NOT NULL,
    "storeFolder" TEXT NOT NULL,
    "batchFolder" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "listingId" TEXT,
    "imagesAttempted" INTEGER NOT NULL DEFAULT 0,
    "imagesUploaded" INTEGER NOT NULL DEFAULT 0,
    "imageErrors" TEXT,
    "variationInventoryStatus" TEXT NOT NULL DEFAULT 'disabled',
    "variationProductCount" INTEGER,
    "variationError" TEXT,
    "supplementalImageStatus" TEXT NOT NULL DEFAULT 'disabled',
    "supplementalImagesAttempted" INTEGER NOT NULL DEFAULT 0,
    "supplementalImagesUploaded" INTEGER NOT NULL DEFAULT 0,
    "supplementalImageErrors" TEXT,
    "warnings" TEXT,
    "errors" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BatchRunRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_driveFolderName_key" ON "Store"("driveFolderName");

-- CreateIndex
CREATE UNIQUE INDEX "StoreEtsyIds_storeId_key" ON "StoreEtsyIds"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchStore_batchId_storeId_key" ON "BatchStore"("batchId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Design_batchId_designCode_key" ON "Design"("batchId", "designCode");

-- CreateIndex
CREATE UNIQUE INDEX "DraftCreationRecord_storeId_batchFolder_designId_key" ON "DraftCreationRecord"("storeId", "batchFolder", "designId");

-- AddForeignKey
ALTER TABLE "StoreEtsyIds" ADD CONSTRAINT "StoreEtsyIds_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStore" ADD CONSTRAINT "BatchStore_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchStore" ADD CONSTRAINT "BatchStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftCreationRecord" ADD CONSTRAINT "DraftCreationRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DraftCreationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchLog" ADD CONSTRAINT "BatchLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRunStore" ADD CONSTRAINT "BatchRunStore_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRunRow" ADD CONSTRAINT "BatchRunRow_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BatchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRunRow" ADD CONSTRAINT "BatchRunRow_storeRunId_fkey" FOREIGN KEY ("storeRunId") REFERENCES "BatchRunStore"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

