// storeIntegrity.ts
//
// B5 guard: Batchly must fail loudly if two Store records share a
// driveFolderName. A duplicate makes store lookup (storeByFolder Map /
// findFirst) nondeterministic and could create listings in the WRONG Etsy
// shop. The DB now enforces `@unique` on driveFolderName; this is a
// defense-in-depth runtime check that runs before any listing work so a legacy
// duplicate (from before the constraint) cannot silently drive a batch run.

import { prisma } from "@/lib/prisma";

export interface StoreFolderRef {
  id: string;
  name: string;
  driveFolderName: string;
}

export interface DuplicateStoreFolder {
  driveFolderName: string;
  stores: { id: string; name: string }[];
}

// Pure, testable core: returns one entry per driveFolderName used by >1 store.
export function findDuplicateDriveFolders(stores: StoreFolderRef[]): DuplicateStoreFolder[] {
  const byFolder = new Map<string, { id: string; name: string }[]>();
  for (const store of stores) {
    const key = store.driveFolderName;
    if (!key) continue; // empty/unassigned folders are not a uniqueness conflict here
    const list = byFolder.get(key) ?? [];
    list.push({ id: store.id, name: store.name });
    byFolder.set(key, list);
  }
  const duplicates: DuplicateStoreFolder[] = [];
  byFolder.forEach((list, driveFolderName) => {
    if (list.length > 1) duplicates.push({ driveFolderName, stores: list });
  });
  return duplicates;
}

export function formatDuplicateStoreFolderError(duplicates: DuplicateStoreFolder[]): string {
  const parts = duplicates.map((dup) => {
    const stores = dup.stores.map((s) => `${s.name} (${s.id})`).join(", ");
    return `"${dup.driveFolderName}" is used by ${dup.stores.length} stores: ${stores}`;
  });
  return `DUPLICATE_STORE_DRIVE_FOLDER: ${parts.join("; ")}. Each store must map to a unique Drive folder before a batch can run.`;
}

// Throws (with a clear, store-naming message) if any driveFolderName is shared.
// Call before batch validation / running.
export async function assertUniqueStoreDriveFolders(): Promise<void> {
  const stores = await prisma.store.findMany({
    select: { id: true, name: true, driveFolderName: true },
  });
  const duplicates = findDuplicateDriveFolders(stores);
  if (duplicates.length > 0) {
    throw new Error(formatDuplicateStoreFolderError(duplicates));
  }
}
