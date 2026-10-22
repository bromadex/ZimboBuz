import { ListView } from "@/components/list-view";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { formatDateTime, money } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { platformDomain } from "@/server/urls";
import { dnsRecordFor, domainLabel } from "@/lib/tenancy/domains";
import { adapters } from "@/server/web/services";
import { addDomain, archiveDomain, cancelDomainOrder, checkDomain, makePrimary, orderDomain } from "./actions";

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

function recordFor(hostname: string) {
  return dnsRecordFor(hostname, dnsTarget());
}

type Order = {
  id: string;
  hostname: string;
  years: number;
  price_cents: number;
  status: string;
  problem: string | null;
  created_at: Date;
};
type Price = { tld: string; price_usd_cents_year: number; note: string | null };

const ORDER_STATUS: Record<string, { label: string; tone: "ok" | "draft" | "info" | "warn" }> = {
  requested: { label: "Being registered", tone: "info" },
  registered: { label: "Registered", tone: "ok" },
  failed: { label: "Could not register", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "draft" },
};

/** Availability of a name across the endings ZimERP sells, checked in parallel (at most a few seconds). */
async function searchNames(label: string, prices: Price[]) {
  const registrar = adapters().registrar;
  const timeout = new Promise<"unknown">((resolve) => setTimeout(() => resolve("unknown"), 4000));
  return Promise.all(
    prices.map(async (p) => {
      const host = `${label}.${p.tld}`;
      const availability = await Promise.race([registrar.checkAvailability(host).catch(() => "unknown" as const), timeout]);
      return { host, price: p, availability };
    }),
  );
}

export default async function DomainsPage({ params, searchParams }: PageProps<"/e/[slug]/settings/domains">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.domains.manage");
  const lp = listParams(sp, { sorts: SORTS });

  const { rows, total, orders, prices } = await withUser(ctx.userId, async (q) => {
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
    const orders = (
      await q<Order>(
        "select id, hostname, years, price_cents, status, problem, created_at from public.domain_orders where company_id = $1 order by created_at desc limit 10",
        [ctx.company.id],
      )
    ).rows;
    const prices = (await q<Price>("select tld, price_usd_cents_year, note from public.domain_prices order by sort_order")).rows;
    return { rows, total, orders, prices };
  });
  const find = domainLabel(typeof sp.find === "string" ? sp.find.split(".")[0] : "");
  const results = find ? await searchNames(find, prices) : [];
  const pending = rows.filter((r) => !r.verified_at);
  const platform = (h: string) => h.endsWith(".zimerp.co.zw");

  const actions = (d: Row) => (
    <div className="flex flex-wrap gap-3">
      {!platform(d.hostname) ? (
        <form action={checkDomain.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={small}>
            Check now
          </button>
        </form>
      ) : null}
      {d.verified_at && !d.is_primary ? (
        <form action={makePrimary.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={small}>
            Make main address
          </button>
        </form>
      ) : null}
      {!platform(d.hostname) ? (
        <form action={archiveDomain.bind(null, slug)}>
          <input type="hidden" name="id" value={d.id} />
          <button type="submit" className={`${small} text-red-700 dark:text-red-400`}>
            Remove
          </button>
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
              {
                label: "For",
                cell: (d) => (d.kind === "erp" ? "ERP" : "Website and store"),
              },
              { label: "Status", cell: status },
              {
                label: "Added",
                cell: (d) => formatDateTime(d.created_at),
                className: "whitespace-nowrap",
              },
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
                Sign in where you bought your domain (for example name.co.zw) and add these records. Then press “Check now”. Changes can take from a few minutes
                to a day.
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

        <div className="space-y-6">
          <Card title="Connect a domain you own">
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
                Adding mybusiness.co.zw also adds www.mybusiness.co.zw (and the other way round), so visitors reach you either way.
              </p>
            </form>
          </Card>
          <div id="buy">
            <Card title="Get a new domain">
              <form method="get" action="#buy" className="flex gap-2">
                <div className="flex-1">
                  <Field label="Name you want" name="find" defaultValue={find || domainLabel(ctx.company.name)} autoCapitalize="none" spellCheck={false} />
                </div>
                <Button type="submit" variant="secondary" className="self-end">
                  Search
                </Button>
              </form>
              {results.length ? (
                <ul className="mt-4 divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  {results.map((r) => (
                    <li key={r.host} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <span className="font-medium break-all">{r.host}</span>
                        <span className="block text-xs text-zinc-500">
                          {money(r.price.price_usd_cents_year, "USD")} a year
                          {r.price.note ? ` · ${r.price.note}` : ""}
                        </span>
                      </span>
                      {r.availability === "taken" ? (
                        <Badge tone="draft">Taken</Badge>
                      ) : (
                        <form action={orderDomain.bind(null, slug)}>
                          <input type="hidden" name="hostname" value={r.host} />
                          <input type="hidden" name="years" value="1" />
                          <button type="submit" className={small}>
                            {r.availability === "available" ? "Register it" : "Try to register"}
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">
                  ZimERP registers the domain in your company&apos;s name, connects it to your website and adds the yearly fee to your subscription.
                </p>
              )}
            </Card>
          </div>
          {orders.length ? (
            <Card title="Domain orders">
              <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium break-all">{o.hostname}</span>
                      <span className="block text-xs text-zinc-500">
                        {o.years} year{o.years === 1 ? "" : "s"} · {money(Number(o.price_cents), "USD")} · {formatDateTime(o.created_at)}
                        {o.problem ? ` · ${o.problem}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <Badge tone={ORDER_STATUS[o.status]?.tone ?? "draft"}>{ORDER_STATUS[o.status]?.label ?? o.status}</Badge>
                      {o.status === "requested" ? (
                        <form action={cancelDomainOrder.bind(null, slug)}>
                          <input type="hidden" name="id" value={o.id} />
                          <button type="submit" className={`${small} text-red-700 dark:text-red-400`}>
                            Cancel
                          </button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
