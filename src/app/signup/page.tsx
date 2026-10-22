import type { Metadata } from "next";
import { Button, Card, Field, Notice, SelectField } from "@/components/ui";
import { MIN_PASSWORD } from "@/server/adapters/supabase-auth";
import { authMode } from "@/server/auth";
import { listIndustries, listModules, listPlans } from "@/server/industries";
import { platformDomain } from "@/server/urls";
import { signUp } from "./actions";
import { IndustryPicker } from "./industry-picker";

export const metadata: Metadata = { title: "Start your business on ZimERP" };

const HINTS: Record<string, string> = Object.fromEntries([
  ["pos", "Sell at the counter in USD, ZiG and rand"],
  ["sales", "Quotes, invoices, payments and customer accounts"],
  ["inventory", "Stock levels, receiving and stock takes"],
  ["website", "Your own website, online shop or donations page"],
  ["portal", "Customers see their invoices and statements, and pay online"],
]);

export default async function SignUpPage({ searchParams }: PageProps<"/signup">) {
  const sp = await searchParams;
  const value = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const domain = platformDomain();
  const devAuth = authMode() === "dev";
  const [industries, plans, moduleRows] = await Promise.all([listIndustries(), listPlans(), listModules()]);
  const modules = moduleRows.map((m) => ({ ...m, hint: HINTS[m.code] }));
  const chosenModules = typeof sp.modules === "string" ? sp.modules.split(",").filter(Boolean) : null;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Start with Zim<span className="text-emerald-700 dark:text-emerald-400">ERP</span>
      </h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Set up your company in a minute. Tell us what kind of organisation you are and we will suggest what you need. You can add modules, staff and your own domain later.
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
            ) : (
              <Field
                label="Password"
                name="password"
                type="password"
                required
                minLength={MIN_PASSWORD}
                maxLength={72}
                autoComplete="new-password"
                hint={`At least ${MIN_PASSWORD} characters. Already have a ZimERP account? Use the same email and password.`}
              />
            )}
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
            <Field
              label="Your own domain (optional)"
              name="own_domain"
              defaultValue={value("own_domain")}
              placeholder="www.mhofu.co.zw"
              autoCapitalize="none"
              spellCheck={false}
              hint="Already have a domain? We connect it once you add one DNS record. No domain yet? You can register one in Settings > Domains later."
            />
            <div className="grid gap-5 sm:grid-cols-2">
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
            <IndustryPicker
              industries={industries}
              modules={modules}
              plans={plans}
              initialPlan={value("plan") ?? "business"}
              initialIndustry={value("industry") ?? "retail"}
              initialModules={chosenModules}
            />
            <Button type="submit" className="w-full">
              Create my company
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
