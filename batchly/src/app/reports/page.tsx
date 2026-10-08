import { TopBar } from "@/components/layout/TopBar";
import { BatchStatusBadge } from "@/components/batches/BatchStatusBadge";
import { getReportData } from "@/lib/data";

// This page renders live database state; without this Next statically
// prerenders it at build time and serves frozen data in production.
export const dynamic = "force-dynamic";


export default async function ReportsPage() {
  const { doneBatches, totalDrafts, totalErrors, storeCount, perStoreCounts } = await getReportData();

  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Final Report"
        subtitle="Summary across completed batches"
        actions={
          <button
            disabled
            className="px-3 py-1.5 rounded-md border border-zinc-700 text-xs text-zinc-500 cursor-not-allowed"
            title="Not available yet"
          >
            Export CSV
          </button>
        }
      />
      <div className="p-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Completed Batches", value: doneBatches.length },
            { label: "Total Drafts Created", value: totalDrafts },
            { label: "Total Errors", value: totalErrors, highlight: totalErrors > 0 },
            { label: "Stores Processed", value: storeCount },
          ].map((c) => (
            <div key={c.label} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-4">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{c.label}</p>
              <p className={`text-3xl font-bold mt-1 ${c.highlight ? "text-red-400" : "text-white"}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Per-batch breakdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-200">Completed Batches</h2>
          </div>
          {doneBatches.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-600">No completed batches yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Batch</th>
                  <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Drafts Created</th>
                  <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Errors</th>
                  <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Date</th>
                </tr>
              </thead>
              <tbody>
                {doneBatches.map((b, i) => (
                  <tr key={b.id} className={`border-b border-zinc-800 ${i === doneBatches.length - 1 ? "border-0" : ""}`}>
                    <td className="px-4 py-2 text-zinc-200">{b.name}</td>
                    <td className="px-4 py-2"><BatchStatusBadge status={b.status} /></td>
                    <td className="px-4 py-2 text-zinc-300">{b.completedListings}</td>
                    <td className="px-4 py-2">
                      {b.errorListings > 0
                        ? <span className="text-red-400">{b.errorListings}</span>
                        : <span className="text-zinc-600">0</span>}
                    </td>
                    <td className="px-4 py-2 text-zinc-500 text-xs">{b.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Per-store breakdown */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-200">Drafts per Store</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left">
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Store</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Drive Folder</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">SKU Prefix</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium uppercase tracking-wide">Drafts Created</th>
              </tr>
            </thead>
            <tbody>
              {perStoreCounts.map(({ store, count }, i) => (
                <tr key={store.id} className={`border-b border-zinc-800 ${i === perStoreCounts.length - 1 ? "border-0" : ""}`}>
                  <td className="px-4 py-2 text-zinc-200">{store.name}</td>
                  <td className="px-4 py-2 text-zinc-500 font-mono text-xs">{store.driveFolderName}</td>
                  <td className="px-4 py-2 text-zinc-500 font-mono text-xs">{store.skuPrefix}</td>
                  <td className="px-4 py-2 text-zinc-300">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-zinc-600">CSV export isn&apos;t available yet.</p>
      </div>
    </div>
  );
}
