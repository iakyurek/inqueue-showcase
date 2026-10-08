"use client";

import type { WizardStep } from "./shared";

// The linear indicator. "inQueue" is a transitional milestone between the
// validate step (main area) and the upload/report step (driven from the
// sidebar), so it has no dedicated `key`.
const STEPS: { key: WizardStep | "inqueue"; label: string }[] = [
  { key: "start", label: "Start Batch" },
  { key: "select", label: "Select Batch" },
  { key: "validate", label: "Validate" },
  { key: "inqueue", label: "inQueue" },
  { key: "report", label: "Upload & Report" },
];

// Where each concrete wizard step sits on the indicator.
const STEP_INDEX: Record<WizardStep, number> = {
  start: 0,
  select: 1,
  validate: 2,
  report: 4,
};

export function WizardStepper({ current }: { current: WizardStep }) {
  const currentIdx = STEP_INDEX[current];

  return (
    <div data-testid="wizard-stepper" className="rounded-xl border border-white/[0.07] bg-[#1b1e27] shadow-sm px-5 py-3.5">
      <ol className="flex items-center gap-1">
        {STEPS.map((step, idx) => {
          const state = idx < currentIdx ? "done" : idx === currentIdx ? "current" : "upcoming";
          return (
            <li key={step.key} data-testid={`wizard-step-${step.key}`} data-state={state} className="flex items-center flex-1 last:flex-none min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                    state === "done"
                      ? "border-emerald-500/[0.4] bg-emerald-500/[0.15] text-emerald-300"
                      : state === "current"
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-white/[0.12] bg-white/[0.04] text-slate-500"
                  }`}
                >
                  {state === "done" ? "✓" : idx + 1}
                </span>
                <span
                  className={`text-[11px] font-semibold truncate ${
                    state === "current" ? "text-slate-100" : state === "done" ? "text-emerald-300/80" : "text-slate-500"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <span className={`flex-1 h-px mx-3 ${idx < currentIdx ? "bg-emerald-500/[0.35]" : "bg-white/[0.08]"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
