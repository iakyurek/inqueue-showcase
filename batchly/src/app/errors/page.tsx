import { TopBar } from "@/components/layout/TopBar";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { getErrorListings } from "@/lib/data";
import Link from "next/link";

// This page renders live database state; without this Next statically
// prerenders it at build time and serves frozen data in production.
export const dynamic = "force-dynamic";


export default async function ErrorsPage() {
  const listings = await getErrorListings();

  return (
    <div className="flex flex-col flex-1">
      <TopBar
        title="Errors / Needs Review"
        subtitle={`${listings.length} items need attention`}
      />
      <div className="p-6">
        {listings.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">
            No errors.
          </div>
        ) : (
          <div className="space-y-3">
            {listings.map((listing) => (
              <div key={listing.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ListingStatusBadge status={listing.status} />
                      <span className="text-zinc-300 font-medium text-sm truncate">{listing.title}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-zinc-500">
                      <span>{listing.storeName}</span>
                      <span>·</span>
                      <span className="font-mono">{listing.designCode}</span>
                      <span>·</span>
                      <span className="font-mono">{listing.sku}</span>
                      <span>·</span>
                      <Link href={`/batches/${listing.batchId}`} className="hover:text-zinc-300 transition-colors">
                        {listing.batchName}
                      </Link>
                    </div>
                    {listing.errorMessage && (
                      <p className="text-xs text-red-400 mt-1.5 bg-red-950/30 border border-red-900/40 rounded px-2 py-1">
                        {listing.errorMessage}
                      </p>
                    )}
                  </div>
                  <button
                    disabled
                    className="shrink-0 px-3 py-1.5 rounded-md border border-zinc-700 text-xs text-zinc-500 cursor-not-allowed whitespace-nowrap"
                    title="Not available yet"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
