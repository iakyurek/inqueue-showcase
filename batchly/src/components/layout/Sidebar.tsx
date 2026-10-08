"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BatchlyLogo } from "@/components/layout/BatchlyLogo";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
        <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" />
        <rect x="9"   y="1.5" width="5.5" height="5.5" rx="1.5" />
        <rect x="1.5" y="9"   width="5.5" height="5.5" rx="1.5" />
        <rect x="9"   y="9"   width="5.5" height="5.5" rx="1.5" />
      </svg>
    ),
  },
  {
    label: "Batches",
    href: "/batches",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
        <rect x="2" y="3" width="12" height="2" rx="1" />
        <rect x="2" y="7" width="9"  height="2" rx="1" opacity=".75" />
        <rect x="2" y="11" width="6" height="2" rx="1" opacity=".5" />
      </svg>
    ),
  },
  {
    label: "Stores",
    href: "/stores",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
        <path d="M1 3h14v2.5L13.5 7H2.5L1 5.5V3zm1.5 5h11v6h-11V8zm2.5 1v4h2V9H5zm4 0v4h2V9H9z" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
        <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm4.9-3.1-.7-1.7.9-1.4-1-1-1.4.9-1.7-.7L8.3 2H7l-.8 1.1-1.7.7-1.4-.9-1 1 .9 1.4-.7 1.7L1 8v1l1.3.9.7 1.7-.9 1.4 1 1 1.4-.9 1.7.7.8 1h1.3l.8-1 1.7-.7 1.4.9 1-1-.9-1.4.7-1.7L15 9V8l-2.1-.1z" />
      </svg>
    ),
  },
  {
    label: "Operator Guide",
    href: "/operator-guide",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
        <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2.5h6v1H5v-1zm0 2.5h4v1H5v-1z" />
      </svg>
    ),
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="w-[230px] shrink-0 flex flex-col min-h-screen"
      style={{
        background: "var(--iq-bg-2)",
        borderRight: "1px solid var(--iq-line)",
      }}
    >
      {/* ── Logo area ── */}
      <div
        className="px-4 py-5"
        style={{ borderBottom: "1px solid var(--iq-line)" }}
      >
        <BatchlyLogo size="sm" showText variant="light" />
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 px-3 py-4" style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        {NAV.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-[13px] font-medium"
              style={
                active
                  ? {
                      background: "rgba(143,182,255,.1)",
                      border: "1px solid rgba(143,182,255,.22)",
                      color: "var(--iq-accent)",
                      fontWeight: 700,
                    }
                  : {
                      background: "transparent",
                      border: "1px solid transparent",
                      color: "var(--iq-text-3)",
                    }
              }
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = "var(--iq-text-2)";
                  (e.currentTarget as HTMLElement).style.background = "var(--iq-surface-2)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLElement).style.color = "var(--iq-text-3)";
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }
              }}
            >
              <span className="shrink-0" style={{ opacity: active ? 1 : 0.6 }}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div
        className="px-4 py-4"
        style={{ borderTop: "1px solid var(--iq-line)", display: "flex", flexDirection: "column", gap: "10px" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "var(--iq-good)", boxShadow: "0 0 6px var(--iq-good)" }}
          />
          <span style={{ fontSize: "0.69rem", color: "var(--iq-text-3)", fontWeight: 600 }}>
            Draft-only workspace
          </span>
        </div>
        <a
          href={process.env.NEXT_PUBLIC_INQUEUE_HUB_URL || "http://localhost:4000"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2"
          style={{
            fontSize: "0.69rem", fontWeight: 700, color: "var(--iq-text-3)",
            border: "1px solid var(--iq-line)", borderRadius: "8px",
            padding: "7px 10px", background: "var(--iq-bg-2)",
            textDecoration: "none", transition: "color 200ms, border-color 200ms, background 200ms",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--iq-text-2)";
            (e.currentTarget as HTMLElement).style.borderColor = "#3a4150";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--iq-text-3)";
            (e.currentTarget as HTMLElement).style.borderColor = "var(--iq-line)";
          }}
        >
          <svg viewBox="0 0 30 17" fill="none" width="18" height="10" aria-hidden="true">
            <defs>
              <linearGradient id="iq-sidebar-g" x1="0" y1="0" x2="30" y2="17" gradientUnits="userSpaceOnUse">
                <stop stopColor="#cdd4e0" />
                <stop offset="1" stopColor="#8fb6ff" />
              </linearGradient>
            </defs>
            <circle cx="3" cy="3.5" r="2" fill="url(#iq-sidebar-g)" />
            <rect x="1.5" y="7.5" width="3" height="8.5" rx="1.5" fill="url(#iq-sidebar-g)" />
            <circle cx="19" cy="9.5" r="6" stroke="url(#iq-sidebar-g)" strokeWidth="2.2" fill="none" />
            <line x1="23.5" y1="14" x2="28" y2="16.5" stroke="url(#iq-sidebar-g)" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          inQueue Hub
        </a>
      </div>
    </aside>
  );
}
