"use client";

import { useState } from "react";
import Link from "next/link";

const ITEMS = [
  "All listings are created as Etsy drafts only.",
  "No listings are published or activated by Batchly.",
  "Review every draft inside Etsy before publishing.",
  "Confirm each shop owner authorized Batchly through Etsy OAuth.",
  "Confirm taxonomy, shipping profile, and readiness IDs are saved for each store.",
  "Review IP/trademark warnings before creating drafts.",
  "Keep selected rows small. Current cap: 3 rows per request.",
  "Delete test drafts when finished testing.",
];

export function OperatorSafetyChecklist() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/60">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-3 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className="font-semibold uppercase tracking-wide text-[10px]">
            Operator Safety Checklist
          </span>
          <span className="text-zinc-600 text-[10px]">{expanded ? "▲ hide" : "▼ show"}</span>
        </button>
        <Link
          href="/operator-guide"
          className="text-[10px] text-zinc-500 hover:text-zinc-200 underline underline-offset-2 transition-colors"
        >
          Operator Guide →
        </Link>
      </div>

      {expanded && (
        <ul className="px-4 pb-3 space-y-1.5 border-t border-zinc-800">
          {ITEMS.map((item) => (
            <li key={item} className="flex items-start gap-2 pt-1.5">
              <span className="text-emerald-500 text-[10px] mt-0.5 shrink-0">✓</span>
              <span className="text-[10px] text-zinc-400">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
