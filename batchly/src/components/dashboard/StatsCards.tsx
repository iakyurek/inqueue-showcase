import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@/types";

interface Props {
  stats: DashboardStats;
}

export function StatsCards({ stats }: Props) {
  const cards = [
    { title: "Active Batches",    value: stats.activeBatches,        sub: "in progress" },
    { title: "Listings Today",    value: stats.listingsCreatedToday,  sub: "drafts created" },
    { title: "Errors",            value: stats.errorCount,            sub: "need attention", highlight: stats.errorCount > 0 },
    { title: "Stores",            value: stats.storeCount,            sub: "configured stores" },
    { title: "All-time Drafts",   value: stats.totalDraftsAllTime,    sub: "total created" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {cards.map((c) => (
        <Card key={c.title} className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="text-xs text-zinc-400 font-medium uppercase tracking-wider leading-none">
              {c.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <p className={`text-4xl font-bold leading-none ${c.highlight ? "text-red-400" : "text-white"}`}>
              {c.value}
            </p>
            <p className="text-xs text-zinc-500 mt-2">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
