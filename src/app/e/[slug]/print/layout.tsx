import type { CSSProperties } from "react";
import { requireCompany } from "@/server/company";

// Printable documents: plain A4 pages without the ERP menu, in the company's colours.
export default async function PrintLayout({ children, params }: LayoutProps<"/e/[slug]/print">) {
  const { slug } = await params;
  const ctx = await requireCompany(slug);
  return (
    <div style={{ "--brand": ctx.branding.primaryColor } as CSSProperties} className="min-h-screen bg-zinc-100 py-8 text-zinc-900 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { html, body { background: white; } }`}</style>
      <div className="mx-auto w-full max-w-[210mm] bg-white p-8 shadow print:max-w-none print:p-0 print:shadow-none">{children}</div>
    </div>
  );
}
