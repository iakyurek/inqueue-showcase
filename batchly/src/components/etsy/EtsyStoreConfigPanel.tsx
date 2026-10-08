"use client";

import { useState } from "react";
import type {
  EtsyShippingProfile,
  EtsyShopSection,
  EtsyReturnPolicy,
  EtsyStoreConfig,
  EtsyReadinessProfile,
  EtsyTaxonomyResult,
} from "@/lib/services/etsy";

interface StoreEtsyIdsData {
  taxonomyId: string | null;
  shippingProfileId: string | null;
  readinessStateId: string | null;
  returnPolicyId: string | null;
  sectionId: string | null;
}

interface Props {
  storeId: string;
  storeName?: string;
  storeFolder?: string;
}

type LoadState = "idle" | "loading" | "loaded" | "error";
type ProfileState = "idle" | "loading" | "done" | "error";
type TaxonomyState = "idle" | "loading" | "done" | "error";

function CopyValue({ value }: { value: string | number }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className="font-mono text-zinc-200 hover:text-white underline decoration-dotted cursor-copy"
      title="Click to copy"
    >
      {copied ? "✓ copied" : value}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">{title}</p>
      {children}
    </div>
  );
}

export function EtsyStoreConfigPanel({ storeId, storeName, storeFolder }: Props) {
  const storeLabel = storeName ?? storeFolder ?? "this store";
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [config, setConfig] = useState<EtsyStoreConfig | null>(null);
  const [configError, setConfigError] = useState("");

  const [profileState, setProfileState] = useState<ProfileState>("idle");
  const [profile, setProfile] = useState<EtsyReadinessProfile | null>(null);
  const [profileFound, setProfileFound] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [saveReadinessState, setSaveReadinessState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveReadinessError, setSaveReadinessError] = useState("");

  const [taxonomyQuery, setTaxonomyQuery] = useState("shirt");
  const [taxonomyState, setTaxonomyState] = useState<TaxonomyState>("idle");
  const [taxonomyResults, setTaxonomyResults] = useState<EtsyTaxonomyResult[]>([]);
  const [taxonomyError, setTaxonomyError] = useState("");

  async function load() {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/etsy/store-config?storeId=${storeId}`);
      const data = await res.json() as EtsyStoreConfig & { error?: string };
      if (!res.ok) {
        setConfigError(data.error ?? "UNKNOWN_ERROR");
        setLoadState("error");
        return;
      }
      setConfig(data);
      setLoadState("loaded");
    } catch {
      setConfigError("Network error — check server logs.");
      setLoadState("error");
    }
  }

  async function searchTaxonomy() {
    const q = taxonomyQuery.trim();
    if (!q) return;
    setTaxonomyState("loading");
    setTaxonomyError("");
    try {
      const res = await fetch(`/api/etsy/taxonomy-search?q=${encodeURIComponent(q)}`);
      const data = await res.json() as { results?: EtsyTaxonomyResult[]; error?: string };
      if (!res.ok) {
        setTaxonomyError(data.error ?? "UNKNOWN_ERROR");
        setTaxonomyState("error");
        return;
      }
      setTaxonomyResults(data.results ?? []);
      setTaxonomyState("done");
    } catch {
      setTaxonomyError("Network error — check server logs.");
      setTaxonomyState("error");
    }
  }

  async function findOrCreateReadinessProfile() {
    const confirmed = window.confirm(
      `Find or create the made-to-order processing profile for ${storeLabel}?\n\n` +
      "If one already exists on Etsy it will be returned. If not, a new one will be created.\n\n" +
      "This does NOT create a listing or publish anything.",
    );
    if (!confirmed) return;

    setProfileState("loading");
    setProfileError("");
    setSaveReadinessState("idle");
    setSaveReadinessError("");

    try {
      const res = await fetch("/api/etsy/store-readiness-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });

      const data = await res.json() as {
        success?: boolean;
        found?: boolean;
        profile?: EtsyReadinessProfile;
        message?: string;
        error?: string;
        etsyError?: string;
      };

      if (!res.ok || !data.success) {
        const msg = data.etsyError
          ? `${data.error ?? "ETSY_ERROR"} — ${data.etsyError}`
          : (data.error ?? "UNKNOWN_ERROR");
        setProfileError(msg);
        setProfileState("error");
        return;
      }

      setProfile(data.profile ?? null);
      setProfileFound(data.found ?? false);
      setProfileMessage(data.message ?? "");
      setProfileState("done");
    } catch {
      setProfileError("Network error — check server logs.");
      setProfileState("error");
    }
  }

  async function saveReadinessStateId(readinessStateId: number) {
    setSaveReadinessState("saving");
    setSaveReadinessError("");
    try {
      // Fetch existing IDs so we preserve taxonomyId, shippingProfileId, etc.
      const getRes = await fetch(`/api/etsy/store-ids?storeId=${storeId}`);
      const existing: StoreEtsyIdsData | null = getRes.ok
        ? (await getRes.json() as StoreEtsyIdsData)
        : null;

      const res = await fetch("/api/etsy/store-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          taxonomyId: existing?.taxonomyId ?? "",
          shippingProfileId: existing?.shippingProfileId ?? "",
          readinessStateId: String(readinessStateId),
          returnPolicyId: existing?.returnPolicyId ?? "",
          sectionId: existing?.sectionId ?? "",
        }),
      });
      if (!res.ok) {
        const errData = await res.json() as { error?: string };
        throw new Error(errData.error ?? "SAVE_FAILED");
      }
      setSaveReadinessState("saved");
    } catch (e) {
      setSaveReadinessError(e instanceof Error ? e.message : "SAVE_FAILED");
      setSaveReadinessState("error");
    }
  }

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Etsy IDs</p>
        <button
          onClick={() => { void load(); }}
          disabled={loadState === "loading"}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors"
        >
          {loadState === "loading" ? "Loading…" : loadState === "loaded" ? "Refresh" : "Load"}
        </button>
      </div>

      {loadState === "idle" && (
        <p className="text-[10px] text-zinc-600">Click Load to fetch Etsy IDs for this shop.</p>
      )}

      {loadState === "error" && (
        <p className="text-[10px] text-red-400 font-mono">Error: {configError}</p>
      )}

      {loadState === "loaded" && config && (
        <div className="space-y-3">

          {/* Shipping Profiles */}
          <Section title="Shipping Profiles">
            {config.shippingProfiles.length === 0 ? (
              <p className="text-[10px] text-zinc-600">No shipping profiles found.</p>
            ) : (
              config.shippingProfiles.map((p: EtsyShippingProfile) => (
                <div key={p.shipping_profile_id} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400 truncate">{p.title}</span>
                  <CopyValue value={p.shipping_profile_id} />
                </div>
              ))
            )}
          </Section>

          {/* Shop Sections */}
          <Section title="Shop Sections">
            {config.sections.length === 0 ? (
              <p className="text-[10px] text-zinc-600">No sections — section_id not needed.</p>
            ) : (
              config.sections.map((s: EtsyShopSection) => (
                <div key={s.shop_section_id} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400 truncate">{s.title}</span>
                  <CopyValue value={s.shop_section_id} />
                </div>
              ))
            )}
          </Section>

          {/* Return Policies */}
          <Section title="Return Policies">
            {config.returnPoliciesNote ? (
              <p className="text-[10px] text-zinc-600">{config.returnPoliciesNote}</p>
            ) : config.returnPolicies && config.returnPolicies.length > 0 ? (
              config.returnPolicies.map((r: EtsyReturnPolicy) => (
                <div key={r.return_policy_id} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">
                    {r.accepts_returns ? "Returns accepted" : "No returns"}
                  </span>
                  <CopyValue value={r.return_policy_id} />
                </div>
              ))
            ) : (
              <p className="text-[10px] text-zinc-600">No return policies found.</p>
            )}
          </Section>

          {/* Readiness / Processing Profile */}
          <Section title="Readiness / Processing Profile">
            {profileState === "done" && profile ? (
              <div className="space-y-1">
                <p className="text-[10px] text-emerald-400">
                  {profileFound ? "Existing made-to-order processing profile found." : "Made-to-order processing profile created."}
                  {profileMessage && profileMessage !== (profileFound ? "Existing made-to-order processing profile found." : "Made-to-order processing profile created.") ? ` ${profileMessage}` : ""}
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">readiness_state_id</span>
                  <CopyValue value={profile.readiness_state_id} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">readiness_state</span>
                  <span className="text-[10px] font-mono text-zinc-300">{profile.readiness_state}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400">processing</span>
                  <span className="text-[10px] font-mono text-zinc-300">
                    {profile.min_processing_time}–{profile.max_processing_time} {profile.processing_time_unit}
                  </span>
                </div>
                <div className="pt-1 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => { void saveReadinessStateId(profile.readiness_state_id); }}
                    disabled={saveReadinessState === "saving" || saveReadinessState === "saved"}
                    className="px-2 py-1 rounded border border-emerald-700 bg-emerald-900/30 text-[10px] text-emerald-300 hover:bg-emerald-800/40 hover:text-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saveReadinessState === "saving" ? "Saving…" : saveReadinessState === "saved" ? "Saved to Store Etsy IDs ✓" : "Save to Store Etsy IDs"}
                  </button>
                  {saveReadinessState === "error" && (
                    <span className="text-[10px] text-red-400 font-mono">{saveReadinessError}</span>
                  )}
                </div>
                {saveReadinessState !== "saved" && (
                  <p className="text-[10px] text-zinc-600">
                    Or copy the ID and paste it into <span className="font-mono">readiness_state_id</span> in the Saved Etsy IDs form below.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <button
                  onClick={() => { void findOrCreateReadinessProfile(); }}
                  disabled={profileState === "loading"}
                  className="w-full px-2 py-1 rounded border border-zinc-700 text-[10px] text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {profileState === "loading"
                    ? "Looking up…"
                    : "Find or Create Made-to-Order Processing Profile"}
                </button>
                <p className="text-[10px] text-zinc-600 text-center">
                  Finds or creates one Etsy made-to-order processing profile for {storeLabel}. Does not create a listing or publish.
                </p>
                {profileState === "error" && (
                  <p className="text-[10px] text-red-400 font-mono break-all">{profileError}</p>
                )}
              </div>
            )}
          </Section>

        </div>
      )}

      {/* Taxonomy Search — always visible, no Load required */}
      <div className="border-t border-zinc-800 pt-3 space-y-2">
        <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Taxonomy Search</p>
        <div className="flex gap-1">
          <input
            type="text"
            value={taxonomyQuery}
            onChange={(e) => setTaxonomyQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void searchTaxonomy(); }}
            placeholder="e.g. shirt, mug, print"
            className="flex-1 min-w-0 px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={() => { void searchTaxonomy(); }}
            disabled={taxonomyState === "loading" || !taxonomyQuery.trim()}
            className="px-2 py-1 rounded border border-zinc-600 bg-zinc-800 text-[10px] text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {taxonomyState === "loading" ? "Searching…" : "Search Taxonomy"}
          </button>
        </div>

        {taxonomyState === "error" && (
          <p className="text-[10px] text-red-400 font-mono">{taxonomyError}</p>
        )}

        {taxonomyState === "done" && (
          taxonomyResults.length === 0 ? (
            <p className="text-[10px] text-zinc-600">No matches for &quot;{taxonomyQuery}&quot;.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {taxonomyResults.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-2">
                  <span className="text-[10px] text-zinc-500 leading-tight break-words min-w-0">{r.path}</span>
                  <CopyValue value={r.id} />
                </div>
              ))}
              <p className="text-[10px] text-zinc-600 pt-1">
                Copy an ID → set <span className="font-mono">ETSY_TEST_TAXONOMY_ID=</span> in .env.local
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
