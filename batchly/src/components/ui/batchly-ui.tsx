/**
 * Batchly UI — Inkly-aligned dark primitives.
 * Keep this file small. Only add a component when at least two pages need it.
 */

import { type ReactNode } from "react";
import Link from "next/link";

// ─── Card ────────────────────────────────────────────────────────────────────

export function SoftCard({
  children,
  className = "",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={`iq-metric-card ${padding ? "p-5" : "overflow-hidden"} ${className}`}
      style={{
        background: "var(--iq-surface)",
        border: "1px solid var(--iq-line)",
        borderRadius: "var(--iq-radius)",
        boxShadow: "0 8px 32px rgba(0,0,0,.22)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Page section heading ────────────────────────────────────────────────────

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "0.69rem",
        fontWeight: 700,
        color: "var(--iq-text-3)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
      }}
    >
      {children}
    </h2>
  );
}

// ─── Metric card ─────────────────────────────────────────────────────────────

type Accent = "default" | "success" | "warning" | "info" | "danger";

const accentMap: Record<Accent, { value: string; border: string; dot: string }> = {
  default: { value: "var(--iq-text)",    border: "var(--iq-line)",               dot: "var(--iq-text-3)"  },
  success: { value: "var(--iq-good)",    border: "rgba(125,215,166,.22)",        dot: "var(--iq-good)"    },
  warning: { value: "var(--iq-warn)",    border: "rgba(244,201,122,.22)",        dot: "var(--iq-warn)"    },
  info:    { value: "var(--iq-accent)",  border: "rgba(143,182,255,.22)",        dot: "var(--iq-accent)"  },
  danger:  { value: "var(--iq-bad)",     border: "rgba(240,138,138,.22)",        dot: "var(--iq-bad)"     },
};

export function MetricCard({
  label,
  value,
  sub,
  accent = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: Accent;
}) {
  const a = accentMap[accent];
  return (
    <div
      className="iq-metric-card px-5 py-4"
      style={{
        background: "var(--iq-surface)",
        border: `1px solid ${a.border}`,
        borderRadius: "var(--iq-radius-sm)",
        boxShadow: "0 4px 16px rgba(0,0,0,.2)",
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.dot }} />
        <p style={{ fontSize: "0.69rem", fontWeight: 700, color: "var(--iq-text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {label}
        </p>
      </div>
      <p className="text-[30px] font-bold leading-none" style={{ color: a.value }}>{value}</p>
      {sub && (
        <p style={{ fontSize: "0.72rem", color: "var(--iq-text-3)", marginTop: "6px", lineHeight: "1.4" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const statusMap: Record<string, { bg: string; color: string; border: string }> = {
  completed:  { bg: "rgba(125,215,166,.1)",  color: "var(--iq-good)",   border: "rgba(125,215,166,.28)" },
  ready:      { bg: "rgba(125,215,166,.1)",  color: "var(--iq-good)",   border: "rgba(125,215,166,.28)" },
  ok:         { bg: "rgba(125,215,166,.1)",  color: "var(--iq-good)",   border: "rgba(125,215,166,.28)" },
  created:    { bg: "rgba(125,215,166,.1)",  color: "var(--iq-good)",   border: "rgba(125,215,166,.28)" },
  online:     { bg: "rgba(125,215,166,.1)",  color: "var(--iq-good)",   border: "rgba(125,215,166,.28)" },
  running:    { bg: "rgba(143,182,255,.1)",  color: "var(--iq-accent)", border: "rgba(143,182,255,.28)" },
  partial:    { bg: "rgba(244,201,122,.1)",  color: "var(--iq-warn)",   border: "rgba(244,201,122,.28)" },
  warnings:   { bg: "rgba(244,201,122,.1)",  color: "var(--iq-warn)",   border: "rgba(244,201,122,.28)" },
  queued:     { bg: "rgba(255,255,255,.05)", color: "var(--iq-text-2)", border: "rgba(255,255,255,.1)"  },
  skipped:    { bg: "rgba(255,255,255,.04)", color: "var(--iq-text-3)", border: "rgba(255,255,255,.08)" },
  duplicate:  { bg: "rgba(255,255,255,.04)", color: "var(--iq-text-3)", border: "rgba(255,255,255,.08)" },
  offline:    { bg: "rgba(255,255,255,.04)", color: "var(--iq-text-3)", border: "rgba(255,255,255,.08)" },
  failed:     { bg: "rgba(240,138,138,.1)",  color: "var(--iq-bad)",    border: "rgba(240,138,138,.28)" },
  error:      { bg: "rgba(240,138,138,.1)",  color: "var(--iq-bad)",    border: "rgba(240,138,138,.28)" },
};

export function StatusBadge({ status, size = "sm" }: { status: string; size?: "xs" | "sm" }) {
  const s = status.toLowerCase();
  const cfg = statusMap[s] ?? { bg: "rgba(255,255,255,.04)", color: "var(--iq-text-3)", border: "rgba(255,255,255,.08)" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        borderRadius: "999px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        fontSize: size === "xs" ? "0.6rem" : "0.67rem",
        padding: size === "xs" ? "2px 7px" : "3px 8px",
      }}
    >
      {status}
    </span>
  );
}

// ─── Step pill ────────────────────────────────────────────────────────────────

export function StepPill({ number, active = false }: { number: number; active?: boolean }) {
  return (
    <div
      style={{
        flexShrink: 0,
        width: "24px",
        height: "24px",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.65rem",
        fontWeight: 800,
        background: active ? "rgba(143,182,255,.12)" : "rgba(255,255,255,.05)",
        color: active ? "var(--iq-accent)" : "var(--iq-text-3)",
        border: active ? "1px solid rgba(143,182,255,.28)" : "1px solid rgba(255,255,255,.1)",
      }}
    >
      {number}
    </div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────────────

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`iq-btn-primary ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`iq-btn-secondary ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`iq-btn-ghost ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Quick action link card ───────────────────────────────────────────────────

export function ActionCard({
  href,
  title,
  desc,
  primary = false,
}: {
  href: string;
  title: string;
  desc: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 px-4 py-3.5 rounded-[12px]"
      style={{
        border: primary
          ? "1px solid rgba(125,215,166,.22)"
          : "1px solid var(--iq-line)",
        background: primary
          ? "rgba(125,215,166,.05)"
          : "var(--iq-surface-2)",
        transition: "all 200ms var(--iq-ease)",
        textDecoration: "none",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = primary
          ? "rgba(125,215,166,.4)"
          : "#3a4150";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = primary
          ? "rgba(125,215,166,.22)"
          : "var(--iq-line)";
        (e.currentTarget as HTMLElement).style.transform = "none";
      }}
    >
      <div>
        <p
          style={{
            fontSize: "0.8125rem",
            fontWeight: 600,
            color: primary ? "var(--iq-good)" : "var(--iq-text)",
            margin: 0,
          }}
        >
          {title}
        </p>
        <p style={{ fontSize: "0.69rem", color: "var(--iq-text-3)", marginTop: "2px", lineHeight: "1.4" }}>
          {desc}
        </p>
      </div>
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="w-3.5 h-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
        style={{ color: primary ? "var(--iq-good)" : "var(--iq-text-3)" }}
      >
        <path d="M9.3 3.3 14 8l-4.7 4.7-.7-.7L12.6 8 8.6 4l.7-.7zm-5 0L9 8l-4.7 4.7-.7-.7L7.6 8 3.6 4l.7-.7z" />
      </svg>
    </Link>
  );
}

// ─── Inline notice ────────────────────────────────────────────────────────────

export function Notice({
  children,
  variant = "info",
  className = "",
}: {
  children: ReactNode;
  variant?: "info" | "success" | "warning" | "error";
  className?: string;
}) {
  const cfg = {
    info:    { border: "rgba(143,182,255,.22)", bg: "rgba(143,182,255,.06)", color: "var(--iq-accent)" },
    success: { border: "rgba(125,215,166,.22)", bg: "rgba(125,215,166,.06)", color: "var(--iq-good)"   },
    warning: { border: "rgba(244,201,122,.22)", bg: "rgba(244,201,122,.06)", color: "var(--iq-warn)"   },
    error:   { border: "rgba(240,138,138,.22)", bg: "rgba(240,138,138,.06)", color: "var(--iq-bad)"    },
  }[variant];

  return (
    <div
      className={`rounded-[10px] px-4 py-3 text-sm leading-relaxed ${className}`}
      style={{ border: `1px solid ${cfg.border}`, background: cfg.bg, color: cfg.color }}
    >
      {children}
    </div>
  );
}
