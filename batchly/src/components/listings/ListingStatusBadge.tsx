import { Badge } from "@/components/ui/badge";
import type { ListingStatus } from "@/types";

const CONFIG: Record<ListingStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING:       { label: "Pending",        variant: "outline" },
  DOWNLOADING:   { label: "Downloading",    variant: "secondary" },
  READY:         { label: "Ready",          variant: "secondary" },
  UPLOADING:     { label: "Uploading",      variant: "secondary" },
  DRAFT_CREATED: { label: "Draft Created",  variant: "default" },
  ERROR:         { label: "Error",          variant: "destructive" },
  NEEDS_REVIEW:  { label: "Needs Review",   variant: "outline" },
};

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  const { label, variant } = CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
}
