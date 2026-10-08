// Compact per-store Etsy connection summary for the settings page. Read-only:
// connect / auto-setup / disconnect actions live on the Stores page, linked
// below. No token values are ever rendered — only derived states.

import Link from "next/link";
import type { EtsyStoreStatus } from "@/lib/services/settingsStatus";

function StoreChip({ store }: { store: EtsyStoreStatus }) {
  if (!store.connected) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white/[0.05] border border-white/[0.1] text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" />
        Needs setup
      </span>
    );
  }
  if (store.readinessMissing.length > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/[0.12] border border-amber-500/[0.25] text-amber-400">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
        Connected · setup incomplete
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/[0.12] border border-emerald-500/[0.25] text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
      Ready
    </span>
  );
}

export function EtsyStoresSummary({
  stores,
  duplicateDriveFolders,
  missingCredentials,
}: {
  stores: EtsyStoreStatus[];
  duplicateDriveFolders: string[];
  missingCredentials: boolean;
}) {
  const duplicateSet = new Set(duplicateDriveFolders);

  return (
    <div className="space-y-3">
      {missingCredentials && (
        <p className="text-[12px] text-amber-400">
          ETSY_CLIENT_ID is not configured — stores cannot connect until it is set.
        </p>
      )}
      {duplicateDriveFolders.length > 0 && (
        <p className="text-[12px] text-red-400">
          Duplicate Drive folder assignment: {duplicateDriveFolders.join(", ")} — each store
          must map to a unique folder before a batch can run.
        </p>
      )}

      <div className="divide-y divide-white/[0.06]">
        {stores.map((store) => (
          <div key={store.id} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-[13px] text-slate-200 font-medium truncate">{store.name}</p>
                <span className="text-[11px] font-mono text-slate-500">{store.driveFolderName}</span>
                {duplicateSet.has(store.driveFolderName) && (
                  <span className="text-[10px] font-semibold text-red-400 border border-red-500/40 rounded px-1.5 py-0.5">
                    duplicate folder
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {store.connected
                  ? `${store.shopName ?? "Shop name pending"}${store.etsyShopId ? ` · shop ${store.etsyShopId}` : ""}`
                  : "No Etsy shop connected"}
                {store.connected && store.readinessMissing.length > 0 &&
                  ` · missing: ${store.readinessMissing.join(", ")}`}
              </p>
            </div>
            <div className="shrink-0">
              <StoreChip store={store} />
            </div>
          </div>
        ))}
        {stores.length === 0 && (
          <p className="text-[12px] text-slate-500 py-2">No stores yet.</p>
        )}
      </div>

      <Link
        href="/stores"
        className="inline-block text-[12px] text-slate-300 hover:text-white underline underline-offset-4 decoration-slate-600"
      >
        Manage connections on the Stores page →
      </Link>
    </div>
  );
}
