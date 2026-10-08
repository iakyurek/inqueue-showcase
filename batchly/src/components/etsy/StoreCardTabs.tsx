"use client";

import { useState } from "react";
import { AutoSetupButton } from "@/components/etsy/AutoSetupButton";
import { ListingQAPanel } from "@/components/etsy/ListingQAPanel";

interface StoreEtsyIds {
  id: string;
  storeId: string;
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  returnPolicyId: string | null;
  sectionId: string | null;
}

interface Props {
  storeId: string;
  storeName: string;
  storeFolder: string;
  etsyShopId: string | null;
  etsyShopName: string | null;
  hasToken: boolean;
  hasShop: boolean;
  isEnabled: boolean;
  missingCredentials: boolean;
  etsyIds: StoreEtsyIds | null;
}

type Tab = "overview" | "ids" | "autosetup" | "qa" | "advanced";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview",  label: "Overview"   },
  { id: "ids",       label: "Etsy IDs"   },
  { id: "autosetup", label: "Auto Setup" },
  { id: "qa",        label: "QA"         },
  { id: "advanced",  label: "Advanced"   },
];

function IdRow({ label, value }: { label: string; value: string | null }) {
  const ok = !!value;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      <div className="flex items-center gap-2">
        {ok ? (
          <span className="text-[11px] font-mono text-slate-300 select-all truncate max-w-[140px]">{value}</span>
        ) : (
          <span className="text-[11px] text-red-400 font-medium">— missing</span>
        )}
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? "bg-emerald-500" : "bg-red-500/60"}`} />
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="text-[11px] text-slate-300">{value}</span>
    </div>
  );
}

function DisconnectButton({ storeId, storeName, etsyShopName }: {
  storeId: string;
  storeName: string;
  etsyShopName: string | null;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleDisconnect() {
    setPhase("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/etsy/disconnect-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setErrorMsg(json.error ?? "Server error");
        setPhase("error");
        return;
      }
      setPhase("done");
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setErrorMsg("Network error");
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <p className="text-[11px] text-emerald-400 font-medium text-center py-1">
        ✓ Disconnected — reloading…
      </p>
    );
  }

  if (phase === "confirm") {
    return (
      <div className="rounded-lg border border-red-500/[0.2] bg-red-950/30 px-4 py-3 space-y-2.5">
        <p className="text-[12px] font-semibold text-red-300">
          Disconnect {etsyShopName ? `"${etsyShopName}"` : "Etsy"} from {storeName}?
        </p>
        <p className="text-[11px] text-red-400/80 leading-relaxed">
          Removes local OAuth only. Etsy listings and saved IDs are not affected.
        </p>
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => setPhase("idle")}
            className="flex-1 px-3 py-1.5 rounded-md border border-white/10 bg-white/5 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleDisconnect()}
            className="flex-1 px-3 py-1.5 rounded-md border border-red-500/30 bg-red-600/20 text-[11px] text-red-300 font-semibold hover:bg-red-600/30 transition-all"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setPhase("confirm")}
        disabled={phase === "loading"}
        className="w-full px-3 py-1.5 rounded-md border border-red-500/[0.18] bg-transparent text-[11px] text-red-400/80 font-medium hover:bg-red-950/30 hover:border-red-500/30 hover:text-red-300 transition-all disabled:opacity-50"
      >
        {phase === "loading" ? "Disconnecting…" : "Disconnect Etsy Shop"}
      </button>
      {phase === "error" && (
        <p className="text-[11px] text-red-400 text-center">{errorMsg}</p>
      )}
    </div>
  );
}

export function StoreCardTabs({
  storeId, storeName, storeFolder, etsyShopId, etsyShopName,
  hasToken, hasShop, isEnabled, missingCredentials, etsyIds,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const idsConfigured = [
    etsyIds?.taxonomyId,
    etsyIds?.shippingProfileId,
    etsyIds?.readinessStateId,
    etsyIds?.returnPolicyId,
  ].filter(Boolean).length;
  const totalIds = 4;
  const allIdsReady = !!(etsyIds?.taxonomyId && etsyIds?.shippingProfileId && etsyIds?.readinessStateId);
  const fullyReady = hasToken && hasShop && allIdsReady && isEnabled;
  const readinessPct = Math.round((idsConfigured / totalIds) * 100);

  function openTab(tab: Tab) {
    setActiveTab(tab);
    setExpanded(true);
  }

  return (
    <div
      className={`rounded-xl border shadow-lg flex flex-col overflow-hidden transition-all duration-200 bg-[#1b1e27] ${
        fullyReady
          ? "border-emerald-500/[0.18] hover:border-emerald-500/[0.35] hover:shadow-emerald-950/30"
          : hasToken
          ? "border-white/[0.09] hover:border-white/[0.18]"
          : "border-white/[0.05] hover:border-white/[0.1]"
      } hover:shadow-2xl hover:-translate-y-0.5`}
    >
      {/* ── Card header ───────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[14px] font-semibold text-slate-100 leading-tight truncate">
              {storeName}
            </h3>
            <p className="text-[11px] text-slate-600 font-mono mt-0.5">{storeFolder}</p>
            {etsyShopName && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-[12px] text-emerald-400 font-semibold truncate">{etsyShopName}</p>
                {etsyShopId && (
                  <span className="text-[10px] text-slate-600 font-mono ml-0.5">#{etsyShopId}</span>
                )}
              </div>
            )}
          </div>

          {/* Status badge */}
          {hasToken && hasShop ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Online
            </span>
          ) : hasToken ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Token only
            </span>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-600 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-700" />
              Offline
            </span>
          )}
        </div>

        {/* IDs progress bar */}
        <div className="mt-4 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-600 font-semibold uppercase tracking-wider">
              Etsy IDs
            </span>
            <span className="text-[10px] text-slate-500">
              {idsConfigured}/{totalIds} configured
            </span>
          </div>
          <div className="h-[3px] bg-white/[0.07] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                idsConfigured === totalIds
                  ? "bg-emerald-500"
                  : idsConfigured > 0
                  ? "bg-amber-500/70"
                  : "bg-slate-700"
              }`}
              style={{ width: `${readinessPct}%` }}
            />
          </div>
        </div>

        {/* Readiness hint */}
        <p className="mt-2 text-[10px] leading-tight">
          {fullyReady ? (
            <span className="text-emerald-400/80 font-medium">✓ Ready to run batches</span>
          ) : !hasToken ? (
            <span className="text-slate-600">Connect Etsy to get started</span>
          ) : !hasShop ? (
            <span className="text-amber-400/70">Shop info missing — reconnect</span>
          ) : !allIdsReady ? (
            <span className="text-amber-400/70">Run Auto Setup to configure remaining IDs</span>
          ) : !isEnabled ? (
            <span className="text-slate-600">Store folder not in enabled list</span>
          ) : null}
        </p>
      </div>

      {/* ── Action strip ───────────────────────────────────────── */}
      <div className="px-5 py-3.5 border-t border-white/[0.05] flex items-center gap-2">
        {missingCredentials ? (
          <button
            disabled
            className="flex-1 px-4 py-2 rounded-lg border border-white/[0.05] bg-white/[0.02] text-[11px] text-slate-600 cursor-not-allowed"
          >
            Etsy credentials missing
          </button>
        ) : !hasToken ? (
          <a
            href={`/api/auth/etsy/start?storeId=${storeId}`}
            className="flex-1 text-center px-4 py-2 rounded-lg bg-slate-700/80 border border-slate-600/50 text-[12px] text-slate-200 font-semibold hover:bg-slate-700 hover:border-slate-500/70 transition-all"
          >
            Connect Etsy Shop
          </a>
        ) : hasToken && hasShop ? (
          <button
            onClick={() => openTab("autosetup")}
            className="flex-1 px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/30 text-[12px] text-slate-300 font-semibold hover:bg-slate-700/80 hover:border-slate-500/50 hover:text-slate-100 transition-all"
          >
            Auto Setup IDs
          </button>
        ) : (
          <a
            href={`/api/auth/etsy/start?storeId=${storeId}`}
            className="flex-1 text-center px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600/30 text-[12px] text-slate-300 font-semibold hover:bg-slate-700/80 transition-all"
          >
            Reconnect Etsy Shop
          </a>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className={`shrink-0 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all border ${
            expanded
              ? "bg-white/[0.1] border-white/[0.14] text-slate-200"
              : "bg-white/[0.04] border-white/[0.07] text-slate-500 hover:text-slate-300 hover:bg-white/[0.08]"
          }`}
        >
          {expanded ? "Close ‹" : "Details ›"}
        </button>
      </div>

      {/* ── Expandable details panel ────────────────────────────── */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          expanded ? "max-h-[900px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
        }`}
      >
        <div className="border-t border-white/[0.06]">

          {/* Pill tab nav */}
          <div className="flex gap-1 px-4 pt-3.5 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  activeTab === tab.id
                    ? "bg-white/[0.12] text-slate-100"
                    : "text-slate-500 hover:text-slate-300 hover:bg-white/[0.05]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="px-5 pt-3 pb-5 space-y-3">

            {/* ── Overview ── */}
            {activeTab === "overview" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] divide-y divide-white/[0.04] overflow-hidden">
                  <DataRow label="Status" value={
                    hasToken && hasShop
                      ? <span className="text-emerald-400 font-semibold">Connected</span>
                      : hasToken
                      ? <span className="text-amber-400 font-semibold">Token only</span>
                      : <span className="text-slate-500">Not connected</span>
                  } />
                  {etsyShopName && (
                    <DataRow label="Etsy shop" value={
                      <span className="text-emerald-400 font-semibold">{etsyShopName}</span>
                    } />
                  )}
                  {etsyShopId && (
                    <DataRow label="Shop ID" value={
                      <span className="font-mono text-slate-400 select-all">{etsyShopId}</span>
                    } />
                  )}
                  <DataRow label="IDs configured" value={
                    <span className={idsConfigured === totalIds ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                      {idsConfigured}/{totalIds}
                    </span>
                  } />
                  <DataRow label="Batch readiness" value={
                    <span className={fullyReady ? "text-emerald-400 font-semibold" : "text-amber-400"}>
                      {fullyReady ? "Ready" : "Not ready"}
                    </span>
                  } />
                  <DataRow label="Drive folder" value={
                    <span className="font-mono text-slate-500">{storeFolder}</span>
                  } />
                  {!isEnabled && (
                    <div className="px-3 py-2.5">
                      <p className="text-[11px] text-amber-400/80">
                        {storeFolder} is not in the enabled store folder list.
                      </p>
                    </div>
                  )}
                </div>

                {hasToken && (
                  <div className="rounded-lg border border-blue-500/[0.14] bg-blue-950/[0.2] px-3 py-2.5 text-[11px] text-blue-400/70 leading-relaxed">
                    <span className="font-semibold text-blue-400/90">Wrong shop connected?</span>{" "}
                    Etsy reuses whichever account is currently signed in your browser. To switch:
                    disconnect below, sign out of Etsy, then reconnect this store.
                  </div>
                )}

                {!missingCredentials && hasToken && (
                  <a
                    href={`/api/auth/etsy/start?storeId=${storeId}`}
                    className="block w-full text-center px-4 py-2 rounded-lg border border-white/[0.09] bg-white/[0.04] text-[12px] text-slate-300 font-semibold hover:bg-white/[0.09] hover:border-white/[0.16] transition-all"
                  >
                    Reconnect Etsy Shop
                  </a>
                )}

                {hasToken && (
                  <DisconnectButton
                    storeId={storeId}
                    storeName={storeName}
                    etsyShopName={etsyShopName}
                  />
                )}
              </div>
            )}

            {/* ── Etsy IDs ── */}
            {activeTab === "ids" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] divide-y divide-white/[0.04] overflow-hidden">
                  <IdRow label="Taxonomy ID"         value={etsyIds?.taxonomyId ?? null} />
                  <IdRow label="Shipping Profile ID" value={etsyIds?.shippingProfileId ?? null} />
                  <IdRow label="Readiness State ID"  value={etsyIds?.readinessStateId ?? null} />
                  <IdRow label="Return Policy ID"    value={etsyIds?.returnPolicyId ?? null} />
                </div>
                <p className="text-[11px] text-slate-600 italic">
                  {!hasToken
                    ? "Connect Etsy first — then run Auto Setup to fill these IDs."
                    : !etsyIds
                    ? "No IDs record found — run Auto Setup."
                    : "IDs are read-only here. Run Auto Setup to refresh them, or edit them in the inQueue Hub \u2192 Configure."}
                </p>
              </div>
            )}

            {/* ── Auto Setup ── */}
            {activeTab === "autosetup" && (
              hasToken && hasShop ? (
                <AutoSetupButton storeId={storeId} storeName={storeName} />
              ) : (
                <p className="text-[11px] text-slate-600 italic">
                  Connect this store to Etsy first to use Auto Setup.
                </p>
              )
            )}

            {/* ── QA ── */}
            {activeTab === "qa" && (
              hasToken && hasShop ? (
                <ListingQAPanel storeId={storeId} storeLabel={storeName} />
              ) : (
                <p className="text-[11px] text-slate-600 italic">
                  Connect this store to Etsy first to run QA checks.
                </p>
              )
            )}

            {/* ── Advanced ── */}
            {activeTab === "advanced" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] divide-y divide-white/[0.04] overflow-hidden">
                  <DataRow label="Store ID"   value={<span className="font-mono text-slate-500 select-all text-[10px]">{storeId}</span>} />
                  <DataRow label="Folder"     value={<span className="font-mono text-slate-400">{storeFolder}</span>} />
                  <DataRow label="Shop name"  value={<span className="text-slate-400">{etsyShopName ?? "Not connected"}</span>} />
                  <DataRow label="Shop ID"    value={<span className="font-mono text-slate-500">{etsyShopId ?? "—"}</span>} />
                  <DataRow label="Etsy auth"  value={<span className={hasToken ? "text-emerald-400" : "text-slate-500"}>{hasToken ? "Token present" : "No token"}</span>} />
                </div>
                {hasToken && (
                  <DisconnectButton
                    storeId={storeId}
                    storeName={storeName}
                    etsyShopName={etsyShopName}
                  />
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
