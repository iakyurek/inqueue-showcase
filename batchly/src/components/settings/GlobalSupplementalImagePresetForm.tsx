"use client";

import { useState } from "react";

interface SupplementalPreset {
  id: string;
  enabled: boolean;
  includeSizeCharts: boolean;
  sizeChartRequiredCount: number;
  includePromoImages: boolean;
  sizeChartFolder: string;
  promoFolder: string;
  maxSupplementalImages: number;
}

interface PreviewData {
  totalFiles: number;
  sizeChartFiles: string[];
  promoFiles: string[];
  allFiles: { basename: string; category: string }[];
  warnings: string[];
  errors: string[];
}

interface GlobalSupplementalImagePresetFormProps {
  initial: SupplementalPreset;
}

export function GlobalSupplementalImagePresetForm({ initial }: GlobalSupplementalImagePresetFormProps) {
  const [form, setForm] = useState<SupplementalPreset>(initial);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  function set<K extends keyof SupplementalPreset>(field: K, value: SupplementalPreset[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setSaveMsg(null);
    setSaveWarnings([]);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    setSaveWarnings([]);
    try {
      const res = await fetch("/api/settings/supplemental-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          maxSupplementalImages: Number(form.maxSupplementalImages),
          sizeChartRequiredCount: Number(form.sizeChartRequiredCount),
        }),
      });
      const data = (await res.json()) as SupplementalPreset & { warnings?: string[]; errors?: string[]; error?: string };
      if (!res.ok) {
        setSaveMsg({ ok: false, text: data.error ?? "Save failed." });
      } else {
        setSaveMsg({ ok: true, text: "Saved." });
        setForm(data);
        if (data.warnings && data.warnings.length > 0) setSaveWarnings(data.warnings);
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error." });
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    try {
      const res = await fetch("/api/settings/supplemental-images/preview");
      const data = (await res.json()) as PreviewData & { error?: string };
      if (!res.ok) {
        setPreviewError(data.error ?? "Preview failed.");
      } else {
        setPreviewData(data);
      }
    } catch {
      setPreviewError("Network error.");
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-xs text-slate-500 space-y-1 leading-relaxed">
        <p>Place shared size chart and promo images in <span className="font-mono text-slate-600">workspace/supplemental-images/</span>.</p>
        <p>Supplemental images are uploaded after design/mockup images.</p>
        <p>Total Etsy listing images are capped at 10.</p>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-white/[0.1] bg-white/[0.04]">
        <input
          id="supp-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-600 accent-emerald-500 cursor-pointer"
        />
        <div>
          <label htmlFor="supp-enabled" className="text-sm font-medium text-slate-200 cursor-pointer">
            Enable supplemental image upload
          </label>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            When enabled, size chart and/or promo images will be uploaded to each new draft listing
            after the design/mockup images. Failures are non-blocking.
          </p>
        </div>
      </div>

      {/* Include toggles */}
      <div className="space-y-2">
        <h4 className="batchly-label">Include</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <input
              id="supp-size-charts"
              type="checkbox"
              checked={form.includeSizeCharts}
              onChange={(e) => set("includeSizeCharts", e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 accent-emerald-500 cursor-pointer"
            />
            <label htmlFor="supp-size-charts" className="text-sm text-slate-300 cursor-pointer">
              Include size chart images
            </label>
          </div>
          {form.includeSizeCharts && (
            <div className="ml-7 flex items-center gap-3">
              <label className="text-xs text-slate-500 shrink-0">Required size charts:</label>
              <input
                type="number"
                min={1}
                max={10}
                value={form.sizeChartRequiredCount}
                onChange={(e) => set("sizeChartRequiredCount", Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                className="batchly-input w-20 text-xs"
              />
              <span className="text-xs text-slate-400">Validation warns if fewer are found</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <input
            id="supp-promo"
            type="checkbox"
            checked={form.includePromoImages}
            onChange={(e) => set("includePromoImages", e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 cursor-pointer"
          />
          <label htmlFor="supp-promo" className="text-sm text-slate-300 cursor-pointer">
            Include promo / limited offer images
          </label>
        </div>
      </div>

      {/* Folders */}
      <div className="space-y-3">
        <h4 className="batchly-label">Folders</h4>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Size chart folder</label>
          <input
            value={form.sizeChartFolder}
            onChange={(e) => set("sizeChartFolder", e.target.value)}
            className="batchly-input font-mono"
          />
          <p className="text-xs text-slate-400">Must be under workspace/supplemental-images/</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Promo folder</label>
          <input
            value={form.promoFolder}
            onChange={(e) => set("promoFolder", e.target.value)}
            className="batchly-input font-mono"
          />
          <p className="text-xs text-slate-400">Must be under workspace/supplemental-images/</p>
        </div>
      </div>

      {/* Max supplemental images */}
      <div className="space-y-1">
        <label className="text-xs text-slate-500">Max supplemental images per listing</label>
        <input
          type="number"
          min={0}
          max={10}
          value={form.maxSupplementalImages}
          onChange={(e) => set("maxSupplementalImages", Math.min(10, Math.max(0, parseInt(e.target.value) || 0)))}
          className="batchly-input w-32"
        />
        <p className="text-xs text-slate-400">0–10. Combined with design images, total cannot exceed 10.</p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg border border-slate-600/50 bg-slate-700/80 hover:bg-slate-600/80 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-slate-100 shadow-sm transition-colors"
        >
          {saving ? "Saving…" : "Save Supplemental Image Preset"}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
            {saveMsg.text}
          </span>
        )}
      </div>

      {saveWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/[0.2] bg-amber-950/[0.25] px-3 py-2 space-y-1">
          {saveWarnings.map((w) => (
            <p key={w} className="text-xs text-amber-300">{w}</p>
          ))}
        </div>
      )}

      {/* Preview helper */}
      <div className="border-t border-white/[0.07] pt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="batchly-label">Preview Supplemental Images</h4>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Lists which files are currently found in the configured folders.
            </p>
          </div>
          <button
            onClick={handlePreview}
            disabled={previewLoading}
            className="shrink-0 px-3 py-2 rounded-lg border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-50 text-xs font-medium text-slate-300 shadow-sm transition-colors"
          >
            {previewLoading ? "Loading…" : "Preview Files"}
          </button>
        </div>

        {previewError && <p className="text-xs text-red-400">{previewError}</p>}

        {previewData && (
          <div className="space-y-2">
            {previewData.totalFiles === 0 ? (
              <p className="text-xs text-slate-500">No supplemental images found in configured folders.</p>
            ) : (
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 space-y-2">
                <p className="text-xs text-slate-300 font-medium">{previewData.totalFiles} file{previewData.totalFiles !== 1 ? "s" : ""} found</p>
                {previewData.sizeChartFiles.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Size charts ({previewData.sizeChartFiles.length})</p>
                    {previewData.sizeChartFiles.map((f) => (
                      <p key={f} className="text-xs font-mono text-slate-500">{f}</p>
                    ))}
                  </div>
                )}
                {previewData.promoFiles.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Promo images ({previewData.promoFiles.length})</p>
                    {previewData.promoFiles.map((f) => (
                      <p key={f} className="text-xs font-mono text-slate-500">{f}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {previewData.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-400">{w}</p>
            ))}
            {previewData.errors.map((e) => (
              <p key={e} className="text-xs text-red-400">{e}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
