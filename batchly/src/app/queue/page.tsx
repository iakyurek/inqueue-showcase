import { TopBar } from "@/components/layout/TopBar";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { getQueueListings } from "@/lib/data";

// This page renders live database state; without this Next statically
// prerenders it at build time and serves frozen data in production.
export const dynamic = "force-dynamic";


export default async function QueuePage() {
  const listings = await getQueueListings();

  const counts = listings.reduce(
    (acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Upload Queue"
        subtitle={`${listings.length} active items · real-time processing in Phase 8`}
      />
      <div className="p-6 space-y-5">
        {/* Status summary pills */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(counts).map(([status, count]) => (
            <div key={status} className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1 text-xs">
              <span className="text-zinc-400">{status.replace("_", " ")}</span>
              <span className="text-white font-semibold">{count}</span>
            </div>
          ))}
        </div>

        {listings.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">
            No active processing batch.
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left">
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Listing</th>
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Store</th>
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Design</th>
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">SKU</th>
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-xs text-zinc-500 font-medium uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((listing, i) => (
                  <tr key={listing.id} className={`border-b border-zinc-800 ${i === listings.length - 1 ? "border-0" : ""}`}>
                    <td className="px-4 py-3 text-zinc-300 max-w-xs truncate">{listing.title}</td>
                    <td className="px-4 py-3 text-zinc-400">{listing.storeName}</td>
                    <td className="px-4 py-3 text-zinc-400 font-mono">{listing.designCode}</td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{listing.sku}</td>
                    <td className="px-4 py-3"><ListingStatusBadge status={listing.status} /></td>
                    <td className="px-4 py-3">
                      {listing.status === "ERROR" ? (
                        <button
                          disabled
                          className="px-2 py-1 rounded text-xs border border-zinc-700 text-zinc-500 cursor-not-allowed"
                          title="Not available yet"
                        >
                          Retry
                        </button>
                      ) : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
