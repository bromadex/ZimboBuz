import type { Metadata } from "next";
import { Button, Card, Field, Notice, SelectField } from "@/components/ui";
import { authMode } from "@/server/auth";
import { platformDomain } from "@/server/urls";
import { signUp } from "./actions";

export const metadata: Metadata = { title: "Start your business on ZimERP" };

const MODULES = [
  { code: "pos", name: "Point of sale", hint: "Sell at the counter in USD, ZiG and rand" },
  { code: "sales", name: "Quotes and invoicing", hint: "Quotes, invoices, payments and customer accounts" },
  { code: "inventory", name: "Inventory", hint: "Stock levels, receiving and stock takes" },
  { code: "website", name: "Website and store", hint: "Your own website and online shop" },
];

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const value = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const domain = platformDomain();
  const devAuth = authMode() === "dev";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Start with Zim<span className="text-emerald-700 dark:text-emerald-400">ERP</span>
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Set up your company in a minute. You can add modules, staff and your own domain later.
      </p>

      <div className="mt-8">
        <Notice error={sp.error} />
        <Card>
          <form action={signUp} className="space-y-5">
            <Field label="Your email address" name="email" type="email" required autoComplete="email" defaultValue={value("email")} />
            {devAuth ? (
              <p className="-mt-3 text-xs text-amber-700 dark:text-amber-400">
                Development sign-in: no password is needed. This is switched off in production.
              </p>
            ) : null}
            <Field label="Company name" name="company" required defaultValue={value("company")} placeholder="Mhofu Hardware" />
            <Field
              label="Web address"
              name="slug"
              required
              pattern="[a-z0-9]([a-z0-9\-]{0,40}[a-z0-9])?"
              defaultValue={value("slug")}
              placeholder="mhofu"
              hint={`Your website will be at <name>.${domain} and your ERP at erp.<name>.${domain}. Lower-case letters, numbers and hyphens.`}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <SelectField
                label="Plan"
                name="plan"
                defaultValue={value("plan") ?? "starter"}
                options={[
                  { value: "starter", label: "Starter (free, 1 user, 1 module)" },
                  { value: "business", label: "Business (USD 29 a month)" },
                  { value: "growth", label: "Growth (USD 79 a month)" },
                  { value: "pro", label: "Pro (USD 199 a month)" },
                ]}
              />
              <SelectField
                label="Main currency"
                name="currency"
                defaultValue={value("currency") ?? "USD"}
                hint="Your books are kept in this currency."
                options={[
                  { value: "USD", label: "US dollar (USD)" },
                  { value: "ZWG", label: "Zimbabwe Gold (ZiG)" },
                  { value: "ZAR", label: "South African rand (ZAR)" },
                ]}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">What do you need?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULES.map((m) => (
                  <label
                    key={m.code}
                    className="flex gap-3 rounded-lg border border-zinc-200 p-3 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 dark:border-zinc-800 dark:has-[:checked]:bg-emerald-950"
                  >
                    <input type="checkbox" name="modules" value={m.code} defaultChecked={m.code === "pos"} className="mt-1" />
                    <span>
                      <span className="block font-medium">{m.name}</span>
                      <span className="block text-xs text-zinc-500">{m.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">The Starter plan includes one module; the website does not count.</p>
            </fieldset>
            <Button type="submit" className="w-full">
              Create my company
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
