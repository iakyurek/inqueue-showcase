"use client";

import { useState } from "react";

type FieldStatus = "saved" | "already_set" | "failed" | "not_found";

interface FieldResult {
  value: string | null;
  status: FieldStatus;
  label: string;
}

interface AutoSetupResult {
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  returnPolicyId: string | null;
  fields: {
    taxonomyId: FieldResult;
    shippingProfileId: FieldResult;
    readinessStateId: FieldResult;
    returnPolicyId: FieldResult;
  };
  actions: string[];
  warnings: string[];
  taxonomyAutoSelected: boolean;
}

interface Props {
  storeId: string;
  storeName: string;
}

function fieldStatusStyle(status: FieldStatus) {
  if (status === "saved") return "text-emerald-400";
  if (status === "already_set") return "text-slate-500";
  if (status === "not_found") return "text-slate-600";
  return "text-red-400";
}

function fieldStatusIcon(status: FieldStatus) {
  if (status === "saved") return "✓ saved";
  if (status === "already_set") return "— already set";
  if (status === "not_found") return "— not found";
  return "✗ failed";
}

export function AutoSetupButton({ storeId, storeName }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AutoSetupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmRefresh, setShowConfirmRefresh] = useState(false);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    setShowConfirmRefresh(false);
    try {
      const res = await fetch("/api/etsy/auto-setup-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, force }),
      });
      const data = await res.json() as AutoSetupResult & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Setup failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Network error — check server logs.");
    } finally {
      setLoading(false);
    }
  }

  const hasResult = result !== null;

  return (
    <div className="space-y-2">
      {/* Primary buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => { void run(false); }}
          disabled={loading}
          className="flex-1 px-3 py-2 rounded-lg border border-slate-600/50 bg-slate-700/80 text-xs text-slate-100 font-semibold shadow-sm hover:bg-slate-600/80 hover:border-slate-500/60 transition-colors disabled:opacity-50"
        >
          {loading ? "Setting up…" : "Auto Setup Missing IDs"}
        </button>

        {hasResult && !showConfirmRefresh && (
          <button
            onClick={() => setShowConfirmRefresh(true)}
            disabled={loading}
            title="Refresh/Reconfigure — fetches fresh values and overwrites all saved IDs"
            className="px-3 py-2 rounded-lg border border-white/[0.1] bg-white/[0.04] text-[10px] text-slate-400 font-medium hover:bg-white/[0.08] hover:border-white/[0.18] transition-colors disabled:opacity-50"
          >
            Refresh IDs
          </button>
        )}
      </div>

      {/* Refresh confirmation */}
      {showConfirmRefresh && (
        <div className="rounded-lg border border-amber-500/[0.2] bg-amber-950/[0.25] px-3 py-2 space-y-2">
          <p className="text-[10px] text-amber-300 font-medium">
            Refresh/Reconfigure — fetches fresh values from Etsy and overwrites all saved IDs.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { void run(true); }}
              disabled={loading}
              className="px-3 py-1.5 rounded-md border border-amber-500/[0.3] bg-amber-500/[0.1] text-[10px] text-amber-300 font-semibold hover:bg-amber-500/[0.2] transition-colors disabled:opacity-50"
            >
              {loading ? "Reconfiguring…" : "Confirm Refresh"}
            </button>
            <button
              onClick={() => setShowConfirmRefresh(false)}
              className="px-3 py-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] text-[10px] text-slate-400 hover:bg-white/[0.08] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[10px] text-red-400 font-mono">{error}</p>
      )}

      {result && (
        <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 space-y-2">
          <p className="text-[10px] text-slate-300 font-semibold">{storeName} setup result</p>

          {/* Per-field status */}
          <div className="space-y-1">
            {(["taxonomyId", "shippingProfileId", "readinessStateId", "returnPolicyId"] as const).map((key) => {
              const f = result.fields[key];
              return (
                <div key={key} className="flex items-start gap-1.5">
                  <span className={`text-[9px] font-mono shrink-0 mt-px ${fieldStatusStyle(f.status)}`}>
                    {fieldStatusIcon(f.status)}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[9px] text-slate-500">{f.label}</span>
                    {f.value && (
                      <span className="ml-1 text-[9px] text-slate-600 font-mono">({f.value})</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Taxonomy auto-selection warning */}
          {result.taxonomyAutoSelected && (
            <div className="rounded-md border border-amber-500/[0.2] bg-amber-950/[0.2] px-2 py-1.5">
              <p className="text-[9px] text-amber-300 font-medium">Taxonomy was auto-selected from keyword search.</p>
              <p className="text-[9px] text-amber-400/70">Verify the taxonomy ID is correct in Etsy before running a real batch.</p>
            </div>
          )}

          {/* Additional warnings */}
          {result.warnings.filter((w) => !w.startsWith("Taxonomy auto-selected")).map((w, i) => (
            <p key={i} className="text-[9px] text-amber-400 font-mono">{w}</p>
          ))}

          <p className="text-[9px] text-slate-600 pt-0.5">Reload the page to update setup status badges.</p>
        </div>
      )}
    </div>
  );
}
