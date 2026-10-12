import { Badge } from "@/components/ui";

/** Status of a stock take: counting, waiting for approval, submitted, cancelled or put away. */
export function TakeStatus({ docstatus, sent, archived }: { docstatus: number; sent: boolean; archived: boolean }) {
  if (archived) return <Badge>Put away</Badge>;
  if (docstatus === 1) return <Badge tone="ok">Submitted</Badge>;
  if (docstatus === 2) return <Badge>Cancelled</Badge>;
  return sent ? <Badge tone="info">Waiting for approval</Badge> : <Badge tone="draft">Counting</Badge>;
}
