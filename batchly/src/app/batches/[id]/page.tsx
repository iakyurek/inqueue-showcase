import { notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { BatchStatusBadge } from "@/components/batches/BatchStatusBadge";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { ValidationPanel } from "@/components/batches/ValidationPanel";
import { Progress } from "@/components/ui/progress";
import { getBatchById, getBatchLogs } from "@/lib/data";
import type { ListingStatus } from "@/types";

interface Props {
  params: { id: string };
}

export default async function BatchDetailPage({ params }: Props) {
  const [batch, logs] = await Promise.all([
    getBatchById(params.id),
    getBatchLogs(params.id),
  ]);

  if (!batch) notFound();

  const pct = batch.totalListings > 0
    ? Math.round((batch.completedListings / batch.totalListings) * 100)
    : 0;

  const designCodes = batch.designs.map((d) => d.designCode);

  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title={batch.name}
        subtitle={`${batch.totalListings} total listings · ${batch.completedListings} completed · ${batch.errorListings} errors`}
        actions={<BatchStatusBadge status={batch.status} />}
      />
      <div className="p-6 space-y-6">
        {/* Summary bar */}
        <div className="flex items-center gap-4 bg-zinc-900 border border-zinc-800 rounded-lg px-5 py-4">
          <div className="flex-1">
            <Progress value={pct} className="h-2" />
          </div>
          <span className="text-sm text-zinc-400 whitespace-nowrap">{pct}% complete</span>
          <span className="text-xs text-zinc-600">{batch.storeCount} stores · {batch.designCount} designs</span>
        </div>

        {/* Store × Design grid */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-x-auto">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-200">Listing Status Grid</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Store × Design — each cell shows listing status</p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-3 py-2 text-left text-zinc-500 font-medium sticky left-0 bg-zinc-900">Store</th>
                {designCodes.map((code) => (
                  <th key={code} className="px-3 py-2 text-zinc-500 font-medium whitespace-nowrap">{code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batch.stores.map((store) => {
                const storeListings = batch.listings.filter((l) => l.storeId === store.id);
                return (
                  <tr key={store.id} className="border-b border-zinc-800 last:border-0">
                    <td className="px-3 py-2 text-zinc-300 font-medium sticky left-0 bg-zinc-900 whitespace-nowrap">
                      {store.name}
                    </td>
                    {designCodes.map((code) => {
                      const listing = storeListings.find((l) => l.designCode === code);
                      return (
                        <td key={code} className="px-3 py-2 text-center">
                          {listing
                            ? <ListingStatusBadge status={listing.status as ListingStatus} />
                            : <span className="text-zinc-700">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Logs */}
        {logs.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-zinc-200 mb-3">Batch Logs</h2>
            <div className="space-y-1.5 font-mono">
              {logs.map((log) => (
                <div key={log.id} className="flex gap-3 text-xs">
                  <span className="text-zinc-600 whitespace-nowrap">
                    {log.createdAt.replace("T", " ").replace("Z", "").slice(0, 19)}
                  </span>
                  <span
                    className={`shrink-0 w-10 ${
                      log.level === "ERROR" ? "text-red-400" : log.level === "WARN" ? "text-yellow-400" : "text-zinc-500"
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-zinc-400">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase 3 — Folder Validation */}
        <ValidationPanel batch={batch} />
      </div>
    </div>
  );
}
