import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isConnected as isDriveConnected } from "@/lib/services/drive";
import { BatchlyLogo } from "@/components/layout/BatchlyLogo";
import path from "path";
import fs from "fs";

// This page renders live database state; without this Next statically
// prerenders it at build time and serves frozen data in production.
export const dynamic = "force-dynamic";


const DOWNLOADS_DIR = path.join(process.cwd(), "workspace", "downloads");

// ─── Metric card ─────────────────────────────────────────────────────────────

type Accent = "default" | "success" | "warning" | "danger" | "info";

const accentStyles: Record<Accent, { dot: string; value: string; border: string }> = {
  default: { dot: "var(--iq-text-3)", value: "var(--iq-text)",    border: "var(--iq-line)"              },
  success: { dot: "var(--iq-good)",   value: "var(--iq-good)",    border: "rgba(125,215,166,.22)"       },
  warning: { dot: "var(--iq-warn)",   value: "var(--iq-warn)",    border: "rgba(244,201,122,.22)"       },
  danger:  { dot: "var(--iq-bad)",    value: "var(--iq-bad)",     border: "rgba(240,138,138,.22)"       },
  info:    { dot: "var(--iq-accent)", value: "var(--iq-accent)",  border: "rgba(143,182,255,.22)"       },
};

function DarkMetricCard({
  label, value, sub, accent = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: Accent;
}) {
  const a = accentStyles[accent];
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
        <p style={{ fontSize: "0.67rem", fontWeight: 700, color: "var(--iq-text-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
          {label}
        </p>
      </div>
      <p className="text-[30px] font-bold leading-none" style={{ color: a.value }}>{value}</p>
      {sub && <p style={{ fontSize: "0.7rem", color: "var(--iq-text-3)", marginTop: "6px", lineHeight: "1.4" }}>{sub}</p>}
    </div>
  );
}

// ─── Store readiness row ─────────────────────────────────────────────────────

function StoreReadinessRow({
  name, folder, isConnected, idsConfigured, totalIds, fullyReady,
}: {
  name: string;
  folder: string;
  isConnected: boolean;
  idsConfigured: number;
  totalIds: number;
  fullyReady: boolean;
}) {
  const pct = Math.round((idsConfigured / totalIds) * 100);
  return (
    <div className="flex items-center gap-3 py-2.5 last:border-0" style={{ borderBottom: "1px solid var(--iq-line)" }}>
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full"
        style={{ background: fullyReady ? "var(--iq-good)" : isConnected ? "var(--iq-warn)" : "var(--iq-text-3)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium truncate" style={{ color: "var(--iq-text-2)" }}>{name}</p>
        <p className="text-[10px] font-mono" style={{ color: "var(--iq-text-3)" }}>{folder}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <div className="w-16 h-[3px] rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,.07)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: idsConfigured === totalIds ? "var(--iq-good)" : idsConfigured > 0 ? "var(--iq-warn)" : "var(--iq-text-3)",
            }}
          />
        </div>
        <span className="text-[10px] w-8 text-right" style={{ color: "var(--iq-text-3)" }}>{idsConfigured}/{totalIds}</span>
      </div>
      {fullyReady ? (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ color: "var(--iq-good)", background: "rgba(125,215,166,.1)", border: "1px solid rgba(125,215,166,.22)" }}>
          Ready
        </span>
      ) : isConnected ? (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ color: "var(--iq-warn)", background: "rgba(244,201,122,.1)", border: "1px solid rgba(244,201,122,.22)" }}>
          Setup
        </span>
      ) : (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{ color: "var(--iq-text-3)", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
          Offline
        </span>
      )}
    </div>
  );
}

// ─── Quick action card ───────────────────────────────────────────────────────

function DarkActionCard({
  href, title, desc, primary = false,
}: {
  href: string; title: string; desc: string; primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 px-4 py-3.5 rounded-[10px]"
      style={{
        border: primary ? "1px solid rgba(125,215,166,.22)" : "1px solid var(--iq-line)",
        background: primary ? "rgba(125,215,166,.05)" : "var(--iq-surface-2)",
        transition: "all 180ms var(--iq-ease)",
        textDecoration: "none",
      }}
    >
      <div>
        <p style={{ fontSize: "0.8125rem", fontWeight: 600, color: primary ? "var(--iq-good)" : "var(--iq-text)", margin: 0 }}>
          {title}
        </p>
        <p style={{ fontSize: "0.7rem", color: "var(--iq-text-3)", marginTop: "2px", lineHeight: "1.4" }}>{desc}</p>
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

// ─── Status badge (dark) ─────────────────────────────────────────────────────

function DarkStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cfg =
    s === "completed" ? { color: "var(--iq-good)",   bg: "rgba(125,215,166,.1)", border: "rgba(125,215,166,.25)" }
    : s === "failed"  ? { color: "var(--iq-bad)",    bg: "rgba(240,138,138,.1)", border: "rgba(240,138,138,.25)" }
    : s === "partial" ? { color: "var(--iq-warn)",   bg: "rgba(244,201,122,.1)", border: "rgba(244,201,122,.25)" }
    : s === "running" ? { color: "var(--iq-accent)",  bg: "rgba(143,182,255,.1)", border: "rgba(143,182,255,.25)" }
    : { color: "var(--iq-text-3)", bg: "rgba(255,255,255,.04)", border: "rgba(255,255,255,.1)" };
  return (
    <span
      className="inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide px-2 py-0.5"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {status}
    </span>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

async function getDashboardData() {
  const driveConnected = await isDriveConnected().catch(() => false);

  const [stores, storeEtsyIdsList, latestRun, allTimeTotals] = await Promise.all([
    prisma.store.findMany({
      select: {
        id: true, name: true, driveFolderName: true,
        etsyShopId: true, refreshToken: true, etsyShopName: true,
      },
    }),
    prisma.storeEtsyIds.findMany(),
    prisma.batchRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        id: true, status: true, batchFolder: true,
        created: true, failed: true, partial: true, skipped: true,
        totalRows: true, startedAt: true, completedAt: true,
      },
    }),
    prisma.batchRun.aggregate({
      _sum: { created: true, failed: true, skipped: true },
    }),
  ]);

  let localBatchCount = 0;
  try {
    if (fs.existsSync(DOWNLOADS_DIR)) {
      localBatchCount = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
    }
  } catch { /* ignore */ }

  const etsyIdsMap = new Map(storeEtsyIdsList.map((e) => [e.storeId, e]));

  const storeReadiness = stores.map((s) => {
    const isConnected = !!(s.etsyShopId && s.refreshToken);
    const hasShop     = !!s.etsyShopName;
    const ids         = etsyIdsMap.get(s.id);
    const idsConfigured = [
      ids?.taxonomyId, ids?.shippingProfileId,
      ids?.readinessStateId, ids?.returnPolicyId,
    ].filter(Boolean).length;
    const allIdsReady = !!(ids?.taxonomyId && ids?.shippingProfileId && ids?.readinessStateId);
    return {
      id: s.id,
      name: s.name,
      folder: s.driveFolderName,
      isConnected,
      hasShop,
      shopName: s.etsyShopName,
      idsConfigured,
      totalIds: 4,
      fullyReady: isConnected && hasShop && allIdsReady,
    };
  });

  const connectedStores  = storeReadiness.filter((s) => s.isConnected).length;
  const offlineStores    = storeReadiness.filter((s) => !s.isConnected).length;
  const readyStores      = storeReadiness.filter((s) => s.fullyReady).length;
  const storesMissingIds = storeReadiness.filter((s) => s.isConnected && !s.fullyReady).length;

  return {
    driveConnected, storeReadiness,
    connectedStores, offlineStores, readyStores, storesMissingIds,
    totalStores: stores.length,
    localBatchCount, latestRun,
    allTimeDraftsCreated: allTimeTotals._sum.created ?? 0,
    allTimeFailedRows:    allTimeTotals._sum.failed  ?? 0,
    allTimeSkipped:       allTimeTotals._sum.skipped ?? 0,
  };
}

export default async function DashboardPage() {
  const {
    driveConnected, storeReadiness,
    connectedStores, offlineStores, readyStores, storesMissingIds,
    totalStores, localBatchCount, latestRun,
    allTimeDraftsCreated, allTimeFailedRows, allTimeSkipped,
  } = await getDashboardData();

  const latestRunStatus = latestRun?.status ?? null;

  return (
    <div className="flex flex-col flex-1 min-h-0" style={{ background: "var(--iq-bg)" }}>

      {/* ── Hero ── */}
      <div
        className="px-6 py-7"
        style={{
          background: "var(--iq-bg-2)",
          borderBottom: "1px solid var(--iq-line)",
        }}
      >
        <div className="flex items-center gap-4 max-w-6xl">
          <BatchlyLogo size="lg" showText={false} variant="light" />
          <div>
            <h1
              className="text-[24px] font-bold leading-tight"
              style={{
                background: "linear-gradient(135deg, var(--iq-silver-bright) 0%, var(--iq-accent) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                letterSpacing: "-0.02em",
              }}
            >
              batchly
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full"
              style={{
                color: driveConnected ? "var(--iq-good)" : "var(--iq-text-3)",
                background: driveConnected ? "rgba(125,215,166,.08)" : "rgba(255,255,255,.04)",
                border: driveConnected ? "1px solid rgba(125,215,166,.22)" : "1px solid var(--iq-line)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: driveConnected ? "var(--iq-good)" : "var(--iq-text-3)" }}
              />
              Drive {driveConnected ? "connected" : "offline"}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-6xl">

        {/* ── Metrics: Store health ── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <DarkMetricCard
            label="Ready Stores"
            value={readyStores}
            sub={`of ${totalStores} total stores`}
            accent={readyStores > 0 ? "success" : "warning"}
          />
          <DarkMetricCard
            label="Connected"
            value={connectedStores}
            sub={`${offlineStores} offline`}
            accent={connectedStores > 0 ? "info" : "warning"}
          />
          <DarkMetricCard
            label="Missing IDs"
            value={storesMissingIds}
            sub="Connected but incomplete"
            accent={storesMissingIds > 0 ? "warning" : "success"}
          />
          <DarkMetricCard
            label="Local Batches"
            value={localBatchCount}
            sub="In workspace/downloads"
            accent={localBatchCount > 0 ? "info" : "default"}
          />
        </div>

        {/* ── Metrics: All-time run totals ── */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <DarkMetricCard
            label="All-time Drafts"
            value={allTimeDraftsCreated}
            sub="Total created across all runs"
            accent={allTimeDraftsCreated > 0 ? "success" : "default"}
          />
          <DarkMetricCard
            label="All-time Failed"
            value={allTimeFailedRows}
            sub="Rows that errored"
            accent={allTimeFailedRows > 0 ? "danger" : "success"}
          />
          <DarkMetricCard
            label="All-time Skipped"
            value={allTimeSkipped}
            sub="Duplicates detected"
            accent="default"
          />
          <DarkMetricCard
            label="Latest Status"
            value={latestRun?.status ?? "None"}
            sub={latestRun?.batchFolder ?? "No runs yet"}
            accent={
              latestRunStatus === "completed" ? "success"
              : latestRunStatus === "failed"  ? "danger"
              : latestRunStatus               ? "warning"
              : "default"
            }
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

          {/* ── Store readiness overview ── */}
          <div
            className="rounded-[16px] overflow-hidden"
            style={{
              background: "var(--iq-surface)",
              border: "1px solid var(--iq-line)",
              boxShadow: "0 8px 32px rgba(0,0,0,.22)",
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: "1px solid var(--iq-line)" }}
            >
              <div>
                <h2 className="text-[13px] font-semibold" style={{ color: "var(--iq-text-2)" }}>Store Readiness</h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--iq-text-3)" }}>
                  {readyStores} ready · {connectedStores} connected · {offlineStores} offline
                </p>
              </div>
              <Link
                href="/stores"
                className="text-[11px] font-medium transition-colors"
                style={{ color: "var(--iq-text-3)" }}
              >
                Manage →
              </Link>
            </div>
            <div className="px-5 py-2">
              {storeReadiness.length === 0 ? (
                <p className="text-[12px] py-4 text-center" style={{ color: "var(--iq-text-3)" }}>No stores configured.</p>
              ) : (
                storeReadiness.map((s) => (
                  <StoreReadinessRow key={s.id} {...s} />
                ))
              )}
            </div>
          </div>

          {/* ── Right col ── */}
          <div className="space-y-4">

            {/* Latest run */}
            {latestRun ? (
              <div
                className="rounded-[16px] overflow-hidden"
                style={{
                  background: "var(--iq-surface)",
                  border: "1px solid var(--iq-line)",
                  boxShadow: "0 8px 32px rgba(0,0,0,.22)",
                }}
              >
                <div
                  className="flex items-center justify-between px-5 py-3.5"
                  style={{ borderBottom: "1px solid var(--iq-line)" }}
                >
                  <h2 className="text-[13px] font-semibold" style={{ color: "var(--iq-text-2)" }}>Latest Batch Run</h2>
                  <Link
                    href="/batches"
                    className="text-[11px] font-medium transition-colors"
                    style={{ color: "var(--iq-text-3)" }}
                  >
                    View all →
                  </Link>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] font-medium" style={{ color: "var(--iq-text-2)" }}>
                      {latestRun.batchFolder}
                    </span>
                    {latestRunStatus && <DarkStatusBadge status={latestRunStatus} />}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Created", value: latestRun.created,      iqColor: "var(--iq-good)"   },
                      { label: "Failed",  value: latestRun.failed,       iqColor: latestRun.failed  > 0 ? "var(--iq-bad)"  : "var(--iq-text-3)" },
                      { label: "Partial", value: latestRun.partial,      iqColor: latestRun.partial > 0 ? "var(--iq-warn)" : "var(--iq-text-3)" },
                      { label: "Skipped", value: latestRun.skipped ?? 0, iqColor: "var(--iq-text-3)" },
                    ].map((m) => (
                      <div
                        key={m.label}
                        className="rounded-[10px] px-3 py-2.5 text-center"
                        style={{ background: "var(--iq-surface-2)", border: "1px solid var(--iq-line)" }}
                      >
                        <p className="text-[18px] font-bold" style={{ color: m.iqColor }}>{m.value}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: "var(--iq-text-3)" }}>{m.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px]" style={{ color: "var(--iq-text-3)" }}>
                    {new Date(latestRun.startedAt).toLocaleString()} · {latestRun.totalRows} rows total
                  </p>
                </div>
              </div>
            ) : (
              <div
                className="rounded-[16px] px-5 py-8 text-center"
                style={{
                  background: "var(--iq-surface)",
                  border: "1px solid var(--iq-line)",
                  boxShadow: "0 8px 32px rgba(0,0,0,.22)",
                }}
              >
                <p className="text-[13px]" style={{ color: "var(--iq-text-3)" }}>No batch runs yet</p>
                <p className="text-[11px] mt-1" style={{ color: "var(--iq-text-3)" }}>
                  Run your first batch from the Batches page.
                </p>
              </div>
            )}

            {/* Quick actions */}
            <div
              className="rounded-[16px] overflow-hidden"
              style={{
                background: "var(--iq-surface)",
                border: "1px solid var(--iq-line)",
                boxShadow: "0 8px 32px rgba(0,0,0,.22)",
              }}
            >
              <div className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--iq-line)" }}>
                <h2 className="text-[13px] font-semibold" style={{ color: "var(--iq-text-2)" }}>Quick Actions</h2>
              </div>
              <div className="p-4 space-y-2">
                <DarkActionCard
                  href="/batches"
                  title="Run a Batch"
                  desc="Download, validate, select stores, create Etsy draft listings"
                  primary
                />
                <DarkActionCard
                  href="/stores"
                  title="Manage Stores"
                  desc="Connect Etsy accounts, configure IDs, run QA checks"
                />
                <DarkActionCard
                  href="/settings"
                  title="Edit Presets"
                  desc="Listing preset, variations, supplemental images"
                />
                <DarkActionCard
                  href="/operator-guide"
                  title="Operator Guide"
                  desc="Step-by-step instructions for running a batch"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── How it works ── */}
        <div
          className="rounded-[16px] overflow-hidden"
          style={{
            background: "var(--iq-surface)",
            border: "1px solid var(--iq-line)",
            boxShadow: "0 8px 32px rgba(0,0,0,.22)",
          }}
        >
          <div className="px-5 py-3.5" style={{ borderBottom: "1px solid var(--iq-line)" }}>
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--iq-text-2)" }}>How batchly Works</h2>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4" style={{ borderTop: "none" }}>
            {[
              { n: 1, title: "Detect Batch",    desc: "Download from Drive or place a folder in workspace/downloads/." },
              { n: 2, title: "Validate Stores", desc: "Check store readiness: Etsy connection, IDs, and supplemental images." },
              { n: 3, title: "Run Drafts",      desc: "Select stores and run. Listings are created as Etsy drafts only." },
              { n: 4, title: "Review in Etsy",  desc: "Open Etsy › Drafts, verify each listing, then publish manually." },
            ].map((step, i) => (
              <div
                key={step.n}
                className="px-5 py-4"
                style={i > 0 ? { borderLeft: "1px solid var(--iq-line)" } : {}}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mb-2.5"
                  style={{
                    background: "rgba(143,182,255,.08)",
                    border: "1px solid rgba(143,182,255,.2)",
                    color: "var(--iq-accent)",
                  }}
                >
                  {step.n}
                </div>
                <p className="text-[12px] font-semibold" style={{ color: "var(--iq-text-2)" }}>{step.title}</p>
                <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--iq-text-3)" }}>{step.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Safety strip ── */}
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] rounded-[10px] px-5 py-3"
          style={{
            color: "var(--iq-text-3)",
            background: "rgba(255,255,255,.02)",
            border: "1px solid var(--iq-line)",
          }}
        >
          <span className="font-semibold flex items-center gap-1.5" style={{ color: "var(--iq-good)" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--iq-good)" }} />
            Draft-only operation
          </span>
          <span style={{ color: "rgba(255,255,255,.08)" }}>|</span>
          <span>Never publishes or activates listings</span>
          <span style={{ color: "rgba(255,255,255,.08)" }}>|</span>
          <span>Never deletes data</span>
          <span style={{ color: "rgba(255,255,255,.08)" }}>|</span>
          <span>Never logs secrets or tokens</span>
        </div>

      </div>
    </div>
  );
}
