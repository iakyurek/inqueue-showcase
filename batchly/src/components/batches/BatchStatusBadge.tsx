import { Badge } from "@/components/ui/badge";
import type { BatchStatus } from "@/types";

const CONFIG: Record<BatchStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING:    { label: "Pending",    variant: "outline" },
  VALIDATING: { label: "Validating", variant: "secondary" },
  READY:      { label: "Ready",      variant: "secondary" },
  PROCESSING: { label: "Processing", variant: "default" },
  DONE:       { label: "Done",       variant: "default" },
  ERROR:      { label: "Error",      variant: "destructive" },
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const { label, variant } = CONFIG[status];
  return <Badge variant={variant}>{label}</Badge>;
}
