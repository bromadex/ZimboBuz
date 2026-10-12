import { ListView } from "@/components/list-view";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { platformDomain } from "@/server/urls";
import { addDomain, archiveDomain, checkDomain, makePrimary } from "./actions";

// Custom domains (§10.2, §12.6): connect your own domain to your website or ERP.

type Row = { id: string; hostname: string; kind: string; is_primary: boolean; verified_at: Date | null; ssl_status: string; created_at: Date };

const SORTS = [
  { value: "name", label: "Name", sql: "d.kind, d.hostname" },
  { value: "newest", label: "Newest", sql: "d.created_at desc" },
];

const small = "text-xs font-semibold underline";

/** Where customers point their DNS (set per deployment). */
function dnsTarget() {
  return {
    cname: process.env.ZIMERP_CNAME_TARGET ?? `sites.${platformDomain()}`,
    apexIp: process.env.ZIMERP_APEX_IP ?? null,
  };
}

function recordFor(hostname: string): { type: string; name: string; value: string } {
  const { cname, apexIp } = dnsTarget();
  const labels = hostname.split(".");
  // Apex names (mybusiness.co.zw, mybusiness.com) cannot use CNAME records.
  const apex = labels.length === 2 || (labels.length === 3 && ["co", "org", "ac", "gov"].includes(labels[1]) && labels[2].length === 2);
  if (apex) return { type: "A", name: "@", value: apexIp ?? "Ask ZimERP support for the address" };
  const zoneLabels = labels.length >= 4 && ["co", "org", "ac"].includes(labels[labels.length - 2]) ? 3 : 2;
  return { type: "CNAME", name: labels.slice(0, labels.length - zoneLabels).join("."), value: cname };
}

export default async function DomainsPage({ params, searchParams }: PageProps<"/e/[slug]/settings/domains">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.domains.manage");
  const lp = listParams(sp, { sorts: SORTS });

  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = "d.company_id = $1 and d.archived_at is null and ($2 = '' or d.hostname ilike $3)";
    const args = [ctx.company.id, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.company_domains d where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select d.id, d.hostname, d.kind, d.is_primary, d.verified_at, d.ssl_status, d.created_at
         from public.company_domains d where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });
  const pending = rows.filter((r) => !r.verified_at);
  const platform = (h: string) => h.endsWith(".zimerp.co.zw");

  const actions = (d: Row) => (
    <div className="flex flex-wrap gap-3">
      {!platform(d.hostname) ? (
        <form action={checkDomain.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={small}>Check now</button>
        </form>
      ) : null}
      {d.verified_at && !d.is_primary ? (
        <form action={makePrimary.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={small}>Make main address</button>
        </form>
      ) : null}
      {!platform(d.hostname) ? (
        <form action={archiveDomain.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={`${small} text-red-700 dark:text-red-400`}>Remove</button>
        </form>
      ) : null}
    </div>
  );
  const status = (d: Row) =>
    d.verified_at ? (
      <span className="flex flex-wrap gap-1">
        <Badge tone="ok">Connected</Badge>
        {d.ssl_status === "issued" ? <Badge tone="ok">Secure (SSL)</Badge> : <Badge tone="draft">SSL pending</Badge>}
      </span>
    ) : (
      <Badge tone="draft">Waiting for DNS</Badge>
    );

  return (
    <>
      <PageHeader title="Domains" description="Use your own domain for your website and store, or for your ERP. Secure connections (SSL) are set up for you." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6" id="domains">
          <ListView<Row>
            path="/settings/domains"
            sp={sp}
            params={lp}
            total={total}
            rows={rows}
            sorts={SORTS}
            searchLabel="Search domains"
            empty="No domains yet."
            columns={[
              {
                label: "Domain",
                cell: (d) => (
                  <span className="font-medium break-words">
                    {d.hostname} {d.is_primary ? <Badge tone="info">Main</Badge> : null}
                  </span>
                ),
              },
              { label: "For", cell: (d) => (d.kind === "erp" ? "ERP" : "Website and store") },
              { label: "Status", cell: status },
              { label: "Added", cell: (d) => formatDateTime(d.created_at), className: "whitespace-nowrap" },
              { label: "", cell: actions },
            ]}
            card={(d) => (
              <div className="space-y-2">
                <p className="font-semibold break-words">
                  {d.hostname} {d.is_primary ? <Badge tone="info">Main</Badge> : null}
                </p>
                <p className="text-sm text-zinc-500">{d.kind === "erp" ? "ERP" : "Website and store"}</p>
                {status(d)}
                {actions(d)}
              </div>
            )}
          />

          {pending.length ? (
            <Card title="DNS records to add">
              <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
                Sign in where you bought your domain (for example name.co.zw) and add these records. Then press “Check now”. Changes can take from a few minutes to a day.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="py-2 pr-4">Domain</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {pending.map((d) => {
                      const r = recordFor(d.hostname);
                      return (
                        <tr key={d.id}>
                          <td className="py-2 pr-4 break-all">{d.hostname}</td>
                          <td className="py-2 pr-4 font-mono">{r.type}</td>
                          <td className="py-2 pr-4 font-mono">{r.name}</td>
                          <td className="py-2 font-mono break-all">{r.value}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </div>

        <Card title="Connect a domain" className="self-start">
          <form action={addDomain.bind(null, slug)} className="space-y-4">
            <Field label="Domain" name="hostname" required placeholder="www.mybusiness.co.zw" autoCapitalize="none" spellCheck={false} />
            <SelectField
              label="Use it for"
              name="kind"
              options={[
                { value: "website", label: "Website and store" },
                { value: "erp", label: "ERP (address starting with erp.)" },
              ]}
            />
            <Button type="submit" className="w-full">
              Add domain
            </Button>
            <p className="text-xs text-zinc-500">
              No domain yet? ZimERP can register a .co.zw or .com domain in your name. Contact support.
            </p>
          </form>
        </Card>
      </div>
    </>
  );
}
