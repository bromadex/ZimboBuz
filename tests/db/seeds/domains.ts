import type { Db } from "../harness";

// Domain orders and prices (20261014170000_domains_primary).
export const catalogue = ["domain_prices"];

export async function seed(db: Db, company: string) {
  await db.admin.query("insert into public.domain_orders (company_id, hostname, price_cents) values ($1, $2, 2500)", [
    company,
    `seed-${company.slice(0, 8)}.co.zw`,
  ]);
}
