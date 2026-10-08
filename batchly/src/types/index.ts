export type BatchStatus = "PENDING" | "VALIDATING" | "READY" | "PROCESSING" | "DONE" | "ERROR";
export type ListingStatus = "PENDING" | "DOWNLOADING" | "READY" | "UPLOADING" | "DRAFT_CREATED" | "ERROR" | "NEEDS_REVIEW";
export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface Store {
  id: string;
  name: string;            // display name: "Store A"
  etsyShopName?: string;
  driveFolderName: string; // Drive folder: "Store_A"
  skuPrefix: string;       // SKU prefix: "SA"
  connected: boolean;
  listingCount: number;
  createdAt: string;
}

export interface Design {
  id: string;
  designCode: string; // e.g. "D001"
  batchId: string;
}

export interface Listing {
  id: string;
  batchId: string;
  batchName: string;
  storeId: string;
  storeName: string;
  designId: string;
  designCode: string;
  sku: string;
  title: string;
  description: string;
  tags: string;
  price: number;
  productType: string;
  status: ListingStatus;
  etsyListingId?: string;
  errorMessage?: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  name: string;
  driveFolder?: string;
  status: BatchStatus;
  storeCount: number;
  designCount: number;
  totalListings: number;
  completedListings: number;
  errorListings: number;
  createdAt: string;
}

export interface BatchDetail extends Batch {
  stores: Store[];
  designs: Design[];
  listings: Listing[];
}

export interface BatchLog {
  id: string;
  batchId: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface DashboardStats {
  activeBatches: number;
  listingsCreatedToday: number;
  errorCount: number;
  storeCount: number;
  totalDraftsAllTime: number;
}

// ---------------------------------------------------------------------------
// Phase 3 — Manifest + Validation types
// ---------------------------------------------------------------------------

export interface ManifestRow {
  store_folder: string;  // "Store_A"
  design_id: string;     // "D001"
  sku: string;
  title: string;
  description: string;
  tags: string;          // comma-separated
  price: number;
  product_type: string;  // "PHYSICAL"
  // Stable variation-profile key ("front_sided" | "double_sided"). Optional in
  // the CSV — legacy manifests without the column resolve to "front_sided".
  variation_profile: string;
}

export interface ValidationError {
  code: string;    // e.g. "MISSING_FOLDER" | "MISSING_IMAGE" | "INVALID_PRICE" | "MISSING_COLUMN"
  message: string;
  path?: string;   // affected file/folder path
  store?: string;
  design?: string;
}

export interface ValidationResult {
  valid: boolean;
  batchName: string;
  batchFolderPath: string;
  manifestRowCount: number;
  manifestStoreFolderCount: number;
  totalStoresFound: number;
  totalDesignFoldersFound: number;
  totalImagesFound: number;
  missingFolders: string[];
  missingImages: string[];
  errors: ValidationError[];
  warnings: ValidationError[];
  checkedAt: string; // ISO timestamp
}
