import type { ReactNode } from "react";
import type { CompanyContext } from "@/server/company";
import { withUser } from "@/server/data";
import { PrintButton } from "@/components/print-button";

export async function Letterhead({ ctx, title, number, children }: { ctx: CompanyContext; title: string; number: string | null; children?: ReactNode }) {
  const vatNumber = ctx.company.vatRegistered
    ? await withUser(ctx.userId, async (q) => (await q<{ vat_number: string | null }>("select vat_number from public.companies where id = $1", [ctx.company.id])).rows[0]?.vat_number)
    : null;
  return (
    <>
      <div className="mb-6 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <header className="mb-8 flex items-start justify-between gap-6 border-b-4 border-[var(--brand)] pb-4">
        <div>
          <p className="text-2xl font-bold">{ctx.company.name}</p>
          {vatNumber ? <p className="text-sm text-zinc-600">VAT number {vatNumber}</p> : null}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold uppercase tracking-wide text-[var(--brand)]">{title}</p>
          {number ? <p className="font-mono text-sm">{number}</p> : null}
        </div>
      </header>
      {children}
    </>
  );
}
