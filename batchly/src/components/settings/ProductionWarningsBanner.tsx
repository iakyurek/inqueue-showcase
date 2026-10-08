import type { ProductionWarning } from "@/lib/productionGuardrails";

export function ProductionWarningsBanner({ warnings }: { warnings: ProductionWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-5 py-4 space-y-2">
      <p className="text-[13px] font-semibold text-amber-300">
        Production configuration incomplete
      </p>
      <ul className="space-y-1.5">
        {warnings.map((w) => (
          <li key={w.code} className="text-[12px] leading-relaxed">
            <span className={w.level === "error" ? "text-red-400 font-semibold" : "text-amber-400 font-semibold"}>
              {w.level === "error" ? "Error" : "Warning"}
            </span>
            <span className="text-slate-300"> — {w.message}</span>
            <span className="text-slate-500"> {w.fix}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
