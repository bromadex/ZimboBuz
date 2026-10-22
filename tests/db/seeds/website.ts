import type { Db } from "../harness";

// Website, uploaded files and customer portal rows for the isolation suite.
export async function seed(db: Db, company: string, _branch: string, user: string): Promise<void> {
  const q = async (sql: string, params: unknown[]) => (await db.admin.query(sql, params)).rows[0];
  // Website pages are visible to roles with website.view, so the module must be on.
  await q(
    `insert into public.company_modules (company_id, module_code, enabled) values ($1, 'website', true)
     on conflict (company_id, module_code) do update set enabled = true`,
    [company],
  );
  await q("insert into public.site_settings (company_id, tagline) values ($1, 'Seeded')", [company]);
  await q(
    `insert into public.site_pages (company_id, slug, title, blocks)
     values ($1, 'home', 'Home', '[{"id":"b1","type":"text","heading":"Hi","body":"Hello"}]')`,
    [company],
  );
  await q(
    `insert into public.site_assets (company_id, storage_key, kind, content_type, size_bytes, created_by)
     values ($1, $2, 'image', 'image/png', 10, $3)`,
    [company, `${company}/site/seed.png`, user],
  );
  const customer = (await q("select id from public.customers where company_id = $1 order by created_at limit 1", [company])).id;
  const portalUser = await db.createUser();
  const link = (
    await q(
      "insert into public.portal_users (company_id, customer_id, user_id, status) values ($1, $2, $3, 'active') returning id",
      [company, customer, portalUser],
    )
  ).id;
  const quote = (await q("select id from public.quotes where company_id = $1 limit 1", [company])).id;
  await q(
    "insert into public.portal_quote_acceptances (company_id, quote_id, portal_user_id) values ($1, $2, $3)",
    [company, quote, link],
  );
}
