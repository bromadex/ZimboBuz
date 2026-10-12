import { templateCsv } from "@/lib/import";
import { requireCompany } from "@/server/company";

// Template CSV for the import screen (P18): /settings/import/template?type=products|customers

export async function GET(request: Request, { params }: RouteContext<"/e/[slug]/settings/import/template">) {
  const { slug } = await params;
  const ctx = await requireCompany(slug);
  const type = new URL(request.url).searchParams.get("type") === "customers" ? "customers" : "products";
  return new Response(templateCsv(type, ctx.company.baseCurrency), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zimerp-${type}-template.csv"`,
      "cache-control": "no-store",
    },
  });
}
