"use client";

import { useState } from "react";

interface VariationPreset {
  id: string;
  enabled: boolean;
  variation1Name: string;
  variation1PropertyId: string | null;
  variation1Options: string;
  variation2Name: string;
  variation2PropertyId: string | null;
  variation2Options: string;
  quantityPerVariation: number;
  priceMode: string;
  skuMode: string;
}

interface TaxonomyPropRow {
  property_id: number;
  name: string;
  display_name: string;
  supports_variations: boolean;
}

interface GlobalVariationPresetFormProps {
  initial: VariationPreset;
  taxonomyId?: string | null;
}

export function GlobalVariationPresetForm({ initial, taxonomyId }: GlobalVariationPresetFormProps) {
  const [form, setForm] = useState<VariationPreset>(initial);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [variationProps, setVariationProps] = useState<TaxonomyPropRow[] | null>(null);

  const v1Count = form.variation1Options.split(",").map((s) => s.trim()).filter(Boolean).length;
  const v2Count = form.variation2Options.split(",").map((s) => s.trim()).filter(Boolean).length;
  const combinationCount = v1Count * v2Count;
  const tooManyCombinations = combinationCount > 100;

  function set(field: keyof VariationPreset, value: string | boolean | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaveMsg(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/settings/variation-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          quantityPerVariation: Number(form.quantityPerVariation),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Save failed." });
      } else {
        setSaveMsg({ ok: true, text: "Saved." });
        setForm(data as unknown as VariationPreset);
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function handleLookupProperties() {
    const taxId = taxonomyId?.trim();
    if (!taxId) {
      setLookupError("No taxonomyId configured. Set it in the Store Etsy IDs section.");
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    setVariationProps(null);
    try {
      const res = await fetch(`/api/etsy/taxonomy-properties?taxonomyId=${encodeURIComponent(taxId)}`);
      const data = (await res.json()) as {
        variationProps?: TaxonomyPropRow[];
        error?: string;
      };
      if (!res.ok) {
        setLookupError(data.error ?? "Failed to load taxonomy properties.");
      } else {
        setVariationProps(data.variationProps ?? []);
      }
    } catch {
      setLookupError("Network error.");
    } finally {
      setLookupLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Enabled toggle */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-white/[0.1] bg-white/[0.04]">
        <input
          id="variation-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 accent-emerald-500 cursor-pointer"
        />
        <div>
          <label htmlFor="variation-enabled" className="text-sm font-medium text-slate-200 cursor-pointer">
            Enable variation + inventory update
          </label>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            When enabled, each new draft listing will have its inventory updated with Size and Color
            variants. Requires both property IDs to be set. Failures are non-blocking — the draft
            is still created, but its status will show as &ldquo;partial.&rdquo;
          </p>
          {form.enabled && (!form.variation1PropertyId || !form.variation2PropertyId) && (
            <p className="text-xs text-amber-400 mt-2">
              Warning: variation is enabled but property IDs are not set. Use the taxonomy helper
              below to find the correct IDs before creating drafts.
            </p>
          )}
        </div>
      </div>

      {/* Variation 1 (Size) */}
      <div className="space-y-3">
        <h4 className="batchly-label">Variation 1 (Size)</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Name</label>
            <input
              value={form.variation1Name}
              onChange={(e) => set("variation1Name", e.target.value)}
              className="batchly-input"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Etsy Property ID</label>
            <input
              value={form.variation1PropertyId ?? ""}
              onChange={(e) => set("variation1PropertyId", e.target.value)}
              placeholder="e.g. 200"
              className="batchly-input font-mono"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Options (comma-separated)</label>
          <input
            value={form.variation1Options}
            onChange={(e) => set("variation1Options", e.target.value)}
            className="batchly-input"
          />
          <p className="text-xs text-slate-400">{v1Count} option{v1Count !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Variation 2 (Color) */}
      <div className="space-y-3">
        <h4 className="batchly-label">Variation 2 (Color)</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Name</label>
            <input
              value={form.variation2Name}
              onChange={(e) => set("variation2Name", e.target.value)}
              className="batchly-input"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Etsy Property ID</label>
            <input
              value={form.variation2PropertyId ?? ""}
              onChange={(e) => set("variation2PropertyId", e.target.value)}
              placeholder="e.g. 200"
              className="batchly-input font-mono"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Options (comma-separated)</label>
          <input
            value={form.variation2Options}
            onChange={(e) => set("variation2Options", e.target.value)}
            className="batchly-input"
          />
          <p className="text-xs text-slate-400">{v2Count} option{v2Count !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Inventory settings */}
      <div className="space-y-3">
        <h4 className="batchly-label">Inventory Settings</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Quantity per variation</label>
            <input
              type="number"
              min={1}
              max={9999}
              value={form.quantityPerVariation}
              onChange={(e) => set("quantityPerVariation", parseInt(e.target.value) || 1)}
              className="batchly-input"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">Price mode</label>
            <select
              value={form.priceMode}
              onChange={(e) => set("priceMode", e.target.value)}
              className="batchly-select"
            >
              <option value="manifest">From manifest</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-slate-500">SKU mode</label>
            <select
              value={form.skuMode}
              onChange={(e) => set("skuMode", e.target.value)}
              className="batchly-select"
            >
              <option value="base-option-combo">base-OPTION-COMBO</option>
            </select>
          </div>
        </div>

        {/* Combination count */}
        <div
          className={`text-xs px-3 py-2 rounded border ${
            tooManyCombinations
              ? "bg-red-500/[0.1] border-red-500/[0.25] text-red-400"
              : "bg-white/[0.04] border-white/[0.08] text-slate-500"
          }`}
        >
          {combinationCount} total combination{combinationCount !== 1 ? "s" : ""}
          {v1Count > 0 && v2Count > 0 && ` (${v1Count} sizes × ${v2Count} colors)`}
          {tooManyCombinations && " — exceeds max 100. Reduce options."}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || tooManyCombinations}
          className="px-4 py-2 rounded-lg border border-slate-600/50 bg-slate-700/80 hover:bg-slate-600/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-slate-100 shadow-sm transition-colors"
        >
          {saving ? "Saving…" : "Save Variation Preset"}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {saveMsg.text}
          </span>
        )}
      </div>

      {/* Taxonomy property lookup helper */}
      <div className="mt-6 space-y-3 border-t border-white/[0.07] pt-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="batchly-label">
              Taxonomy Property Lookup
            </h4>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Look up variation-supporting property IDs for the configured taxonomy node.
              Use this to find the correct IDs for Size and Color before enabling.
            </p>
          </div>
          <button
            onClick={handleLookupProperties}
            disabled={lookupLoading}
            className="shrink-0 px-3 py-2 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 text-xs font-medium text-slate-300 shadow-sm transition-colors"
          >
            {lookupLoading ? "Loading…" : "Load Properties"}
          </button>
        </div>

        {!taxonomyId && (
          <p className="text-xs text-amber-400">
            No taxonomyId is configured in Store Etsy IDs yet. Save a taxonomy ID there first.
          </p>
        )}

        {lookupError && (
          <p className="text-xs text-red-400">{lookupError}</p>
        )}

        {variationProps !== null && (
          variationProps.length === 0 ? (
            <p className="text-xs text-slate-500">
              No variation-supporting properties found for taxonomy ID {taxonomyId}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="text-slate-500 border-b border-white/[0.07]">
                    <th className="pb-1 pr-4 font-medium">Property ID</th>
                    <th className="pb-1 pr-4 font-medium">Name</th>
                    <th className="pb-1 font-medium">Display Name</th>
                  </tr>
                </thead>
                <tbody>
                  {variationProps.map((p) => (
                    <tr key={p.property_id} className="border-b border-white/[0.05] last:border-0">
                      <td className="py-1.5 pr-4 font-mono text-slate-300">{p.property_id}</td>
                      <td className="py-1.5 pr-4 text-slate-400">{p.name}</td>
                      <td className="py-1.5 text-slate-400">{p.display_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-slate-500 mt-2">
                Copy the property_id for Size into &ldquo;Variation 1 Property ID&rdquo; and for
                Color into &ldquo;Variation 2 Property ID&rdquo; above.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
