import Link from "next/link";
import { Button, Card, Field, Notice, PageHeader, SelectField, TextArea } from "@/components/ui";
import { CURRENCY_OPTIONS } from "@/lib/format";
import type { CompanyContext } from "@/server/company";
import { createDocument } from "./actions";
import { loadPickers } from "./data";

export async function NewDocument({
  ctx,
  slug,
  kind,
  sp,
}: {
  ctx: CompanyContext;
  slug: string;
  kind: "quote" | "invoice";
  sp: Record<string, string | string[] | undefined>;
}) {
  const { customers, branches } = await loadPickers(ctx);
  const preset = typeof sp.customer === "string" ? customers.find((c) => c.id === sp.customer) : undefined;
  const lead = typeof sp.lead === "string" && /^[0-9a-f-]{36}$/i.test(sp.lead) ? sp.lead : undefined;
  const quote = kind === "quote";

  return (
    <>
      <PageHeader title={quote ? "New quote" : "New invoice"} description="Choose the customer and currency, then add the items." />
      <Notice error={sp.error} />
      {customers.length === 0 ? (
        <Card>
          <p className="text-sm">
            Add a customer first.{" "}
            <Link className="underline" href="/customers">
              Go to customers
            </Link>
          </p>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <form action={createDocument.bind(null, slug, kind)} className="grid gap-4 sm:grid-cols-2">
            {lead ? <input type="hidden" name="lead_id" value={lead} /> : null}
            <div className="sm:col-span-2">
              <SelectField label="Customer" name="customer_id" defaultValue={preset?.id ?? ""} required options={[{ value: "", label: "Choose a customer" }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
            </div>
            <SelectField label="Currency" name="currency" defaultValue={preset?.currency.trim() ?? ctx.company.baseCurrency} options={CURRENCY_OPTIONS} />
            {branches.length > 1 ? <SelectField label="Branch" name="branch_id" options={branches.map((b) => ({ value: b.id, label: b.name }))} /> : null}
            {quote ? (
              <Field label="Valid until" name="valid_until" type="date" />
            ) : (
              <>
                <Field label="Invoice date" name="invoice_date" type="date" />
                <Field label="Due date" name="due_date" type="date" hint="Leave empty if payable now." />
              </>
            )}
            <div className="sm:col-span-2">
              <TextArea label="Notes for the customer" name="notes" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Continue</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
