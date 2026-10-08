import { TopBar } from "@/components/layout/TopBar";
import { prisma } from "@/lib/prisma";
import { StoreCardTabs } from "@/components/etsy/StoreCardTabs";
import { isStoreFolderEnabled } from "@/lib/services/draftFlowHelpers";

interface PageProps {
  searchParams: {
    etsy?: string;
    store?: string;
    reason?: string;
    shopWarning?: string;
    conflictStore?: string;
    shopName?: string;
  };
}

// Dark-mode inline notice (used only on the dark stores page)
function DarkNotice({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: "info" | "success" | "warning" | "error";
}) {
  const cfg = {
    info:    "border-blue-500/[0.2]   bg-blue-950/[0.3]   text-blue-300",
    success: "border-emerald-500/[0.2] bg-emerald-950/[0.3] text-emerald-300",
    warning: "border-amber-500/[0.2]  bg-amber-950/[0.3]  text-amber-300",
    error:   "border-red-500/[0.2]    bg-red-950/[0.3]    text-red-300",
  }[variant];
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${cfg}`}>
      {children}
    </div>
  );
}

export default async function StoresPage({ searchParams }: PageProps) {
  const rawStores = await prisma.store.findMany({ orderBy: { name: "asc" } });
  const allEtsyIds = await prisma.storeEtsyIds.findMany();
  const enabledByFolder = new Map(
    await Promise.all(
      rawStores.map(async (s) => [s.driveFolderName, await isStoreFolderEnabled(s.driveFolderName)] as const),
    ),
  );
  const hubConfigureUrl = `${process.env.INQUEUE_HUB_URL ?? "http://localhost:4000"}/#configure`;

  const connectedCount = rawStores.filter((s) => s.etsyShopId && s.refreshToken && s.etsyShopName).length;
  const readyCount     = rawStores.filter((s) => {
    const ids = allEtsyIds.find((e) => e.storeId === s.id);
    return !!(s.etsyShopId && s.refreshToken && s.etsyShopName && ids?.taxonomyId && ids?.shippingProfileId && ids?.readinessStateId);
  }).length;
  const missingCredentials = !process.env.ETSY_CLIENT_ID;

  const etsyStatus    = searchParams.etsy;
  const etsyReason    = searchParams.reason;
  const etsyStoreId   = searchParams.store;
  const shopWarning   = searchParams.shopWarning;
  const conflictStore = searchParams.conflictStore;
  const shopName      = searchParams.shopName;
  const connectedStoreName = etsyStoreId
    ? rawStores.find((s) => s.id === etsyStoreId)?.name
    : undefined;

  return (
    <div className="flex flex-col flex-1 bg-[#111318]">
      <TopBar
        dark
        title="Stores"
        subtitle={`${rawStores.length} stores · ${connectedCount} connected · ${readyCount} ready`}
      />

      <div className="p-6 max-w-7xl space-y-5">

        {/* ── Banners ── */}
        {missingCredentials && (
          <DarkNotice variant="warning">
            <span className="font-semibold">Etsy credentials not configured.</span>{" "}
            Add{" "}
            <code className="font-mono text-xs bg-amber-900/40 px-1 rounded">ETSY_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs bg-amber-900/40 px-1 rounded">ETSY_REDIRECT_URI</code> to{" "}
            <code className="font-mono text-xs bg-amber-900/40 px-1 rounded">.env.local</code> and restart.
          </DarkNotice>
        )}

        {etsyStatus === "connected" && !shopWarning && (
          <DarkNotice variant="success">
            <span className="font-semibold">{connectedStoreName ?? "Store"}</span> connected to Etsy.{" "}
            Click <strong>Details ›</strong> on the store card, then <strong>Auto Setup</strong> to
            configure IDs.
          </DarkNotice>
        )}

        {etsyStatus === "connected" && shopWarning === "shop_missing" && (
          <DarkNotice variant="warning">
            <span className="font-semibold">{connectedStoreName ?? "Store"}:</span>{" "}
            Token saved, but Etsy shop info could not be fetched. Reconnect to retry.
          </DarkNotice>
        )}

        {etsyStatus === "error" && etsyReason === "shop_already_connected" && (
          <DarkNotice variant="error">
            <p>
              <span className="font-semibold">Connection blocked.</span>{" "}
              The Etsy shop{" "}
              <strong>{shopName ? decodeURIComponent(shopName) : "selected"}</strong> is already
              connected to{" "}
              <strong>{conflictStore ? decodeURIComponent(conflictStore) : "another store"}</strong>.
            </p>
            <p className="mt-1 opacity-80">
              Each Etsy shop can only be linked to one Batchly store. Sign out of Etsy in your browser
              first, then reconnect this store with a different account.
            </p>
          </DarkNotice>
        )}

        {etsyStatus === "error" && etsyReason !== "shop_already_connected" && (
          <DarkNotice variant="error">
            <span className="font-semibold">Etsy connection failed.</span>{" "}
            {etsyReason && (
              <code className="font-mono text-xs">{decodeURIComponent(etsyReason)}</code>
            )}
          </DarkNotice>
        )}

        {/* ── Workflow hint ── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-slate-500 bg-white/[0.03] rounded-lg border border-white/[0.07] px-5 py-3">
          <span className="font-semibold text-emerald-500/80 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Draft-only — nothing published
          </span>
          <span className="text-white/10">|</span>
          <span>1. Connect Etsy</span>
          <span className="text-white/10">→</span>
          <span>2. Auto Setup IDs</span>
          <span className="text-white/10">→</span>
          <span>3. Validate on /batches</span>
          <span className="text-white/10">→</span>
          <span>4. Run batch</span>
        </div>

        {/* ── Hub config pointer ── */}
        <DarkNotice variant="info">
          Store names, SKU prefixes, enablement, and Etsy resource IDs are managed centrally.{" "}
          <a href={hubConfigureUrl} className="font-semibold underline underline-offset-2 hover:opacity-80">
            Configure stores in the inQueue Hub ↗
          </a>{" "}
          — this page shows connection status and lets you connect Etsy, run Auto Setup, and QA.
        </DarkNotice>

        {/* ── Store grid ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rawStores.map((store) => {
            const hasShop     = !!(store.etsyShopName);
            const etsyIds     = allEtsyIds.find((e) => e.storeId === store.id) ?? null;
            const isEnabled   = enabledByFolder.get(store.driveFolderName) ?? false;
            const isConnected = !!(store.etsyShopId && (store as { refreshToken?: string | null }).refreshToken);

            return (
              <StoreCardTabs
                key={store.id}
                storeId={store.id}
                storeName={store.name}
                storeFolder={store.driveFolderName}
                etsyShopId={store.etsyShopId}
                etsyShopName={store.etsyShopName}
                hasToken={isConnected}
                hasShop={hasShop}
                isEnabled={isEnabled}
                missingCredentials={missingCredentials}
                etsyIds={etsyIds}
              />
            );
          })}
        </div>

      </div>
    </div>
  );
}
