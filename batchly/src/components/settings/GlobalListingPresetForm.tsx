"use client";

import { useState } from "react";

interface Preset {
  id: string;
  whoMade: string;
  whenMade: string;
  listingType: string;
  renewalOption: string;
  isPersonalizable: boolean;
  defaultQuantity: number;
  defaultPrice: string;
  descriptionTemplate: string | null;
  materials: string;
  itemWeight: number;
  itemWeightUnit: string;
  itemLength: number;
  itemWidth: number;
  itemHeight: number;
  itemDimensionsUnit: string;
}

interface Props {
  initial: Preset;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const WHO_MADE_OPTIONS = ["i_did", "someone_else", "collective"];
const WHEN_MADE_OPTIONS = [
  "made_to_order", "2020_2024", "2010_2019", "2004_2009",
  "before_2004", "2000_2003", "1990s", "1980s", "1970s",
  "1960s", "1950s", "before_1950",
];
const LISTING_TYPE_OPTIONS = ["physical", "digital", "download"];
const RENEWAL_OPTIONS = ["automatic", "manual"];
const inputClass = "batchly-input text-xs";
const monoInputClass = "batchly-input text-xs font-mono";

export function GlobalListingPresetForm({ initial }: Props) {
  const [form, setForm] = useState<Preset>({
    ...initial,
    descriptionTemplate: initial.descriptionTemplate ?? "",
    materials: initial.materials ?? "Cotton,bella canvas,gildan",
    itemWeightUnit: initial.itemWeightUnit ?? "oz",
    itemDimensionsUnit: initial.itemDimensionsUnit ?? "in",
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function set<K extends keyof Preset>(key: K, value: Preset[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveState("idle");
  }

  async function save() {
    setSaveState("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/settings/listing-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setErrorMsg(data.error ?? "UNKNOWN_ERROR");
        setSaveState("error");
        return;
      }
      setSaveState("saved");
    } catch {
      setErrorMsg("Network error — check server logs.");
      setSaveState("error");
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <Field label="who_made">
          <Select
            value={form.whoMade}
            options={WHO_MADE_OPTIONS}
            onChange={(v) => set("whoMade", v)}
          />
        </Field>

        <Field label="when_made">
          <Select
            value={form.whenMade}
            options={WHEN_MADE_OPTIONS}
            onChange={(v) => set("whenMade", v)}
          />
        </Field>

        <Field label="listing_type">
          <Select
            value={form.listingType}
            options={LISTING_TYPE_OPTIONS}
            onChange={(v) => set("listingType", v)}
          />
        </Field>

        <Field label="renewal_option">
          <Select
            value={form.renewalOption}
            options={RENEWAL_OPTIONS}
            onChange={(v) => set("renewalOption", v)}
          />
        </Field>

        <Field label="default_quantity">
          <input
            type="number"
            min={1}
            value={form.defaultQuantity}
            onChange={(e) => set("defaultQuantity", Number(e.target.value))}
            className={inputClass}
          />
        </Field>

        <Field label="default_price">
          <input
            type="text"
            value={form.defaultPrice}
            onChange={(e) => set("defaultPrice", e.target.value)}
            placeholder="9.99"
            className={inputClass}
          />
        </Field>

        <Field label="is_personalizable">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPersonalizable}
              onChange={(e) => set("isPersonalizable", e.target.checked)}
              className="accent-emerald-500"
            />
            <span className="text-xs text-slate-400">{form.isPersonalizable ? "Yes" : "No"}</span>
          </label>
        </Field>
      </div>

      {/* Materials */}
      <div className="space-y-1">
        <label className="batchly-label">
          Materials (comma-separated)
        </label>
        <p className="batchly-helper">Sent with every Etsy draft listing. Max 13 values.</p>
        <input
          type="text"
          value={form.materials}
          onChange={(e) => set("materials", e.target.value)}
          placeholder="Cotton,bella canvas,gildan"
          className={monoInputClass}
        />
      </div>

      {/* Weight + Dimensions */}
      <div className="space-y-3">
        <label className="batchly-label block">
          Item Weight &amp; Packed Dimensions
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Weight</label>
            <input type="number" min={0} step={0.1} value={form.itemWeight}
              onChange={(e) => set("itemWeight", parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Weight unit</label>
            <Select value={form.itemWeightUnit} options={["oz", "lb", "g", "kg"]} onChange={(v) => set("itemWeightUnit", v)} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Dim. unit</label>
            <Select value={form.itemDimensionsUnit} options={["in", "cm", "mm", "ft"]} onChange={(v) => set("itemDimensionsUnit", v)} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Length ({form.itemDimensionsUnit})</label>
            <input type="number" min={0} step={0.1} value={form.itemLength}
              onChange={(e) => set("itemLength", parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Width ({form.itemDimensionsUnit})</label>
            <input type="number" min={0} step={0.1} value={form.itemWidth}
              onChange={(e) => set("itemWidth", parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">Height ({form.itemDimensionsUnit})</label>
            <input type="number" min={0} step={0.1} value={form.itemHeight}
              onChange={(e) => set("itemHeight", parseFloat(e.target.value) || 0)}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1 col-span-2">
        <label className="batchly-label">
          Listing Description Template
        </label>
        <p className="batchly-helper">
          The listing title is automatically inserted as the first line. Do not include the title line here.
        </p>
        <textarea
          value={form.descriptionTemplate ?? ""}
          onChange={(e) => set("descriptionTemplate", e.target.value)}
          rows={14}
          className="batchly-input text-xs font-mono leading-relaxed resize-y"
          placeholder="ORDERING:&#10;&#10;1. Review all photos&#10;..."
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { void save(); }}
          disabled={saveState === "saving"}
          className="px-4 py-2 rounded-lg border border-slate-600/50 bg-slate-700/80 text-xs text-slate-100 font-semibold shadow-sm hover:bg-slate-600/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveState === "saving" ? "Saving…" : "Save preset"}
        </button>
        {saveState === "saved" && (
          <span className="text-xs text-emerald-400">Saved.</span>
        )}
        {saveState === "error" && (
          <span className="text-xs text-red-400 font-mono">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="batchly-label">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="batchly-select text-xs"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
