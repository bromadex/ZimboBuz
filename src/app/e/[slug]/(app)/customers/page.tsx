import { Button, Card, Field, Notice, PageHeader, SelectField, Table, Td } from "@/components/ui";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { addCustomer, archiveCustomer } from "../../actions";

export default async function CustomersPage({ params, searchParams }: PageProps<"/e/[slug]/customers">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "core.customers.view");
  const canCreate = ctx.permissions.has("core.customers.create");
  const canEdit = ctx.permissions.has("core.customers.edit");

  const customers = await withUser(ctx.userId, async (q) =>
    (
      await q<{ id: string; name: string; company_name: string | null; email: string | null; phone: string | null; currency: string }>(
        `select id, name, company_name, email, phone, currency from public.customers
         where company_id = $1 and archived_at is null order by name`,
        [ctx.company.id],
      )
    ).rows,
  );

  return (
    <>
      <PageHeader title="Customers" description="People and businesses you sell to. The same phone number or email is never entered twice." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Table head={["Name", "Phone", "Email", "Currency", ""]} empty="No customers yet.">
          {customers.map((c) => (
            <tr key={c.id}>
              <Td>
                {c.name}
                {c.company_name ? <span className="block text-xs text-zinc-500">{c.company_name}</span> : null}
              </Td>
              <Td className="whitespace-nowrap">{c.phone ?? "—"}</Td>
              <Td>{c.email ?? "—"}</Td>
              <Td>{c.currency === "ZWG" ? "ZiG" : c.currency}</Td>
              <Td className="text-right">
                {canEdit ? (
                  <form action={archiveCustomer.bind(null, slug)}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="text-xs font-semibold text-zinc-500 hover:text-red-700">
                      Archive
                    </button>
                  </form>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>

        {canCreate ? (
          <Card title="Add a customer">
            <form action={addCustomer.bind(null, slug)} className="space-y-4">
              <Field label="Name" name="name" required placeholder="Tendai Moyo" />
              <Field label="Business name" name="company_name" hint="If they buy for a business." />
              <Field label="Phone" name="phone" type="tel" placeholder="077 123 4567" />
              <Field label="WhatsApp" name="whatsapp" type="tel" hint="Leave empty if it is the same as the phone." />
              <Field label="Email" name="email" type="email" />
              <SelectField
                label="Usually pays in"
                name="currency"
                defaultValue={ctx.company.baseCurrency}
                options={[
                  { value: "USD", label: "US dollar (USD)" },
                  { value: "ZWG", label: "Zimbabwe Gold (ZiG)" },
                  { value: "ZAR", label: "South African rand (ZAR)" },
                ]}
              />
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
