import { ListView } from "@/components/list-view";
import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { CURRENCY_OPTIONS, currencyLabel } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { addCustomer } from "../../actions";

const SORTS = [
  { value: "name", label: "Name", sql: "c.name" },
  { value: "newest", label: "Newest", sql: "c.created_at desc" },
];

type Row = { id: string; name: string; company_name: string | null; email: string | null; phone: string | null; currency: string };

export default async function CustomersPage({ params, searchParams }: PageProps<"/e/[slug]/customers">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.customers.view");
  const canCreate = ctx.permissions.has("core.customers.create");
  const lp = listParams(sp, { sorts: SORTS });
  const archived = lp.get("archived") === "yes";

  const { rows, total } = await withUser(ctx.userId, async (q) => {
    const where = `c.company_id = $1 and (c.archived_at is null) <> $3
      and ($2 = '' or c.name ilike $4 or c.company_name ilike $4 or c.email ilike $4 or c.phone_key like '%' || app.phone_key($2) || '%')`;
    const args = [ctx.company.id, lp.q, archived, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.customers c where ${where}`, args)).rows[0].n);
    const rows = (
      await q<Row>(
        `select c.id, c.name, c.company_name, c.email, c.phone, c.currency from public.customers c
         where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    return { rows, total };
  });

  return (
    <>
      <PageHeader title="Customers" description="People and businesses you sell to. The same phone number or email is never entered twice." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <ListView<Row>
          path="/customers"
          sp={sp}
          params={lp}
          total={total}
          rows={rows}
          sorts={SORTS}
          searchLabel="Search by name, phone or email"
          filters={[{ name: "archived", label: "Archived", options: [{ value: "yes", label: "Archived only" }] }]}
          href={(c) => `/customers/${c.id}`}
          empty="No customers yet."
          columns={[
            { label: "Name", cell: (c) => c.name },
            { label: "Business", cell: (c) => c.company_name ?? "—" },
            { label: "Phone", cell: (c) => c.phone ?? "—", className: "whitespace-nowrap" },
            { label: "Email", cell: (c) => c.email ?? "—" },
            { label: "Currency", cell: (c) => currencyLabel(c.currency) },
          ]}
          card={(c) => (
            <>
              <p className="font-semibold">{c.name}</p>
              {c.company_name ? <p className="text-sm text-zinc-500">{c.company_name}</p> : null}
              <p className="mt-2 text-sm">{c.phone ?? c.email ?? "No contact details"}</p>
            </>
          )}
        />

        {canCreate ? (
          <Card title="Add a customer" className="self-start">
            <form action={addCustomer.bind(null, slug)} className="space-y-4">
              <Field label="Name" name="name" required placeholder="Tendai Moyo" />
              <Field label="Business name" name="company_name" hint="If they buy for a business." />
              <Field label="Phone" name="phone" type="tel" placeholder="077 123 4567" />
              <Field label="WhatsApp" name="whatsapp" type="tel" hint="Leave empty if it is the same as the phone." />
              <Field label="Email" name="email" type="email" />
              <SelectField label="Usually pays in" name="currency" defaultValue={ctx.company.baseCurrency} options={CURRENCY_OPTIONS} />
              <Button type="submit" className="w-full">
                Add customer
              </Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
