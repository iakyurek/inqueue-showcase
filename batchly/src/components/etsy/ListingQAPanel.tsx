"use client";

import { useState } from "react";

type QACheckStatus = "pass" | "warning" | "fail";

interface QACheck {
  key: string;
  label: string;
  status: QACheckStatus;
  message: string;
}

interface QASummary {
  state: string;
  imageCount: number;
  tagCount: number;
  inventoryProductCount: number;
  hasVariations: boolean;
  descriptionLength: number;
  price: number | null;
  materials: string[];
  itemWeight: number | null;
  itemWeightUnit: string | null;
  itemLength: number | null;
  itemWidth: number | null;
  itemHeight: number | null;
  itemDimensionsUnit: string | null;
}

interface QAResult {
  success: true;
  storeId: string;
  listingId: string;
  qaStatus: QACheckStatus;
  checks: QACheck[];
  summary: QASummary;
}

interface Props {
  storeId: string;
  storeLabel: string;
  /** Pre-fill the listing ID (e.g. from a freshly created draft). */
  initialListingId?: string;
  /** Compact mode for embedding inside result cards. */
  compact?: boolean;
}

function statusColors(status: QACheckStatus) {
  if (status === "pass") return "text-emerald-400 border-emerald-800/60 bg-emerald-900/20";
  if (status === "warning") return "text-yellow-400 border-yellow-800/50 bg-yellow-950/20";
  return "text-red-400 border-red-800/50 bg-red-950/20";
}

function statusIcon(status: QACheckStatus) {
  if (status === "pass") return "✓";
  if (status === "warning") return "⚠";
  return "✗";
}

export function ListingQAPanel({ storeId, storeLabel, initialListingId = "", compact = false }: Props) {
  const [listingId, setListingId] = useState(initialListingId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QAResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(!compact);

  async function handleRunQA() {
    const id = listingId.trim();
    if (!id) { setError("Enter a listing ID."); return; }
    if (!/^\d+$/.test(id)) { setError("Listing ID must be numeric."); return; }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(
        `/api/etsy/listing-qa?storeId=${encodeURIComponent(storeId)}&listingId=${encodeURIComponent(id)}`,
      );
      const data = (await res.json()) as QAResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "QA check failed.");
      } else {
        setResult(data);
        setExpanded(true);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  if (compact && !expanded && !result) {
    return (
      <div className="mt-1 space-y-1">
        <div className="flex items-center gap-2">
          <input
            value={listingId}
            onChange={(e) => setListingId(e.target.value)}
            placeholder="Listing ID"
            className="w-32 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-200 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleRunQA}
            disabled={loading}
            className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-[10px] text-zinc-200 transition-colors"
          >
            {loading ? "…" : "Run QA"}
          </button>
          <span className="text-[9px] text-zinc-600 italic">read-only</span>
        </div>
        {error && <p className="text-[9px] text-red-400 font-mono">{error}</p>}
      </div>
    );
  }

  return (
    <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-2"}>
      {!compact && (
        <>
          <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wide">
            Listing QA — {storeLabel}
          </p>
          <div className="rounded border border-zinc-700/50 bg-zinc-800/30 px-3 py-2 text-[10px] text-zinc-500 space-y-0.5">
            <p className="font-semibold text-zinc-400">Read-only verification</p>
            <p>Fetches the listing from Etsy and checks it. Nothing on Etsy is changed.</p>
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <input
          value={listingId}
          onChange={(e) => { setListingId(e.target.value); setResult(null); setError(null); }}
          placeholder="Etsy listing ID (numeric)"
          className={`flex-1 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono focus:outline-none focus:border-blue-500 ${compact ? "text-[10px]" : "text-sm"}`}
        />
        <button
          onClick={handleRunQA}
          disabled={loading || !listingId.trim()}
          className={`shrink-0 px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 font-medium transition-colors ${compact ? "text-[10px]" : "text-xs"}`}
        >
          {loading ? "Checking…" : "Run QA Check"}
        </button>
      </div>

      {error && (
        <p className={`text-red-400 font-mono break-all ${compact ? "text-[9px]" : "text-xs"}`}>{error}</p>
      )}

      {result && (
        <div className="space-y-2">
          {/* Overall status badge */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded border ${statusColors(result.qaStatus)}`}>
            <span className="font-bold text-base">{statusIcon(result.qaStatus)}</span>
            <div>
              <p className={`font-semibold ${compact ? "text-[10px]" : "text-sm"}`}>
                QA {result.qaStatus.toUpperCase()} — Listing {result.listingId}
              </p>
              <p className={`opacity-70 ${compact ? "text-[9px]" : "text-[10px]"}`}>
                {result.checks.filter((c) => c.status === "pass").length} passed ·{" "}
                {result.checks.filter((c) => c.status === "warning").length} warnings ·{" "}
                {result.checks.filter((c) => c.status === "fail").length} failures
              </p>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "State", value: result.summary.state },
              { label: "Images", value: `${result.summary.imageCount}/10` },
              { label: "Tags", value: `${result.summary.tagCount}` },
              { label: "Desc length", value: `${result.summary.descriptionLength} chars` },
              {
                label: "Inventory",
                value: result.summary.hasVariations
                  ? `${result.summary.inventoryProductCount} products`
                  : "none",
              },
              {
                label: "Price",
                value: result.summary.price != null
                  ? `$${result.summary.price.toFixed(2)}`
                  : "—",
              },
              {
                label: "Materials",
                value: result.summary.materials.length > 0
                  ? result.summary.materials.join(", ")
                  : "none",
              },
              {
                label: "Weight",
                value: result.summary.itemWeight != null
                  ? `${result.summary.itemWeight} ${result.summary.itemWeightUnit ?? "?"}`
                  : "—",
              },
              {
                label: "Dimensions",
                value: result.summary.itemLength != null
                  ? `${result.summary.itemLength}×${result.summary.itemWidth}×${result.summary.itemHeight} ${result.summary.itemDimensionsUnit ?? "?"}`
                  : "—",
              },
            ].map(({ label, value }) => (
              <div key={label} className="rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1.5">
                <p className="text-[9px] text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={`font-mono text-zinc-200 font-medium break-all ${compact ? "text-[9px]" : "text-[10px]"}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Check list */}
          <div className="space-y-1">
            {result.checks.map((check) => (
              <div
                key={check.key}
                className={`flex items-start gap-2 px-2 py-1.5 rounded border ${statusColors(check.status)}`}
              >
                <span className="shrink-0 font-bold text-[10px] mt-px">{statusIcon(check.status)}</span>
                <div className="min-w-0">
                  <p className={`font-medium ${compact ? "text-[9px]" : "text-[10px]"}`}>{check.label}</p>
                  <p className={`opacity-80 break-words ${compact ? "text-[9px]" : "text-[10px]"}`}>{check.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
