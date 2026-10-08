"use client";

import { useState } from "react";

interface StoreEtsyIdsData {
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
  initial: StoreEtsyIdsData;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function StoreEtsyIdsForm({ storeId, initial }: Props) {
  const [form, setForm] = useState({
    taxonomyId: initial.taxonomyId ?? "",
    shippingProfileId: initial.shippingProfileId ?? "",
    readinessStateId: initial.readinessStateId ?? "",
    returnPolicyId: initial.returnPolicyId ?? "",
    sectionId: initial.sectionId ?? "",
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function setField(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaveState("idle");
  }

  async function save() {
    setSaveState("saving");
    setErrorMsg("");
    try {
      const res = await fetch("/api/etsy/store-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, ...form }),
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
    <div className="mt-3 border-t border-zinc-800 pt-3 space-y-3">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
        Saved Etsy IDs
      </p>
      <p className="text-[10px] text-zinc-600">
        Override IDs saved by Auto Setup. Use Auto Setup Etsy IDs to fill these automatically.
      </p>

      <div className="space-y-2">
        {(
          [
            ["taxonomyId", "taxonomy_id"],
            ["shippingProfileId", "shipping_profile_id"],
            ["readinessStateId", "readiness_state_id"],
            ["returnPolicyId", "return_policy_id (optional)"],
            ["sectionId", "section_id (optional)"],
          ] as [keyof typeof form, string][]
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono w-44 shrink-0">{label}</span>
            <input
              type="text"
              value={form[key]}
              onChange={(e) => setField(key, e.target.value)}
              placeholder="—"
              className="flex-1 min-w-0 px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-zinc-500 font-mono"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { void save(); }}
          disabled={saveState === "saving"}
          className="px-3 py-1 rounded border border-zinc-600 bg-zinc-800 text-[10px] text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveState === "saving" ? "Saving…" : "Save IDs"}
        </button>
        {saveState === "saved" && (
          <span className="text-[10px] text-emerald-400">Saved.</span>
        )}
        {saveState === "error" && (
          <span className="text-[10px] text-red-400 font-mono">{errorMsg}</span>
        )}
      </div>
    </div>
  );
}
