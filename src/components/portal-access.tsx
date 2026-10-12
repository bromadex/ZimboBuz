import type { CompanyContext } from "@/server/company";

// Customer portal access for a customer (P19). Filled in with the portal.
export async function PortalAccess(props: { ctx: CompanyContext; slug: string; customerId: string }) {
  void props;
  return null;
}
