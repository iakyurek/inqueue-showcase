export { GET } from "@/app/api/readiness/route";

// Re-exported handlers do not inherit the source route's segment config —
// declare force-dynamic here too so this alias is never statically
// prerendered (see /api/readiness/route.ts).
export const dynamic = "force-dynamic";
