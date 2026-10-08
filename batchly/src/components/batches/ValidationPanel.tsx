"use client";

import { useState } from "react";
import type { BatchDetail, ValidationResult } from "@/types";

interface Props {
  batch: BatchDetail;
}

export function ValidationPanel({ batch }: Props) {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runValidation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchName: batch.name, batchId: batch.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Folder Validation</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Validates <span className="font-mono text-zinc-400">workspace/sample-batches/{batch.name}/</span>
          </p>
        </div>
        <button
          onClick={runValidation}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Validating…" : "Validate Folder"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Status pill + counts */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                result.valid
                  ? "bg-green-950/50 border border-green-800 text-green-400"
                  : "bg-red-950/50 border border-red-800 text-red-400"
              }`}
            >
              <span>{result.valid ? "✓" : "✗"}</span>
              {result.valid ? "Valid" : "Invalid"}
            </span>
            <span className="text-xs text-zinc-500">
              {result.manifestRowCount} manifest rows
              {" · "}{result.totalStoresFound}/8 stores
              {" · "}{result.totalDesignFoldersFound} design folders
              {" · "}{result.totalImagesFound} images
            </span>
            <span className="text-xs text-zinc-700">
              Checked {new Date(result.checkedAt).toLocaleTimeString()}
            </span>
          </div>

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">
                Errors ({result.errors.length})
              </p>
              <ul className="space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="flex gap-2 text-xs text-red-300 bg-red-950/20 border border-red-900/30 rounded px-2 py-1">
                    <span className="shrink-0 text-red-600 font-mono">[{e.code}]</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-yellow-400 uppercase tracking-wide">
                Warnings ({result.warnings.length})
              </p>
              <ul className="space-y-1">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 text-xs text-yellow-300 bg-yellow-950/20 border border-yellow-900/30 rounded px-2 py-1">
                    <span className="shrink-0 text-yellow-600 font-mono">[{w.code}]</span>
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing folders */}
          {result.missingFolders.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                Missing Folders ({result.missingFolders.length})
              </p>
              <ul className="space-y-0.5">
                {result.missingFolders.map((f, i) => (
                  <li key={i} className="text-xs text-zinc-500 font-mono pl-2">{f}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing images */}
          {result.missingImages.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                Missing Images ({result.missingImages.length})
              </p>
              <ul className="space-y-0.5">
                {result.missingImages.map((m, i) => (
                  <li key={i} className="text-xs text-zinc-500 font-mono pl-2">{m}</li>
                ))}
              </ul>
            </div>
          )}

          {result.valid && result.errors.length === 0 && (
            <p className="text-xs text-green-400">
              All stores, design folders, and images are present. Batch is ready to process.
            </p>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <p className="text-xs text-zinc-600">
          Click &quot;Validate Folder&quot; to check the local workspace structure for this batch.
        </p>
      )}
    </div>
  );
}
