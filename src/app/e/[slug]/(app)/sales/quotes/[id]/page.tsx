import { notFound } from "next/navigation";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { loadDocument, loadPickers } from "../../data";
import { DocumentView } from "../../document-view";

export default async function QuotePage({ params, searchParams }: PageProps<"/e/[slug]/sales/quotes/[id]">) {
  const { slug, id } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const doc = await withUser(ctx.userId, (q) => loadDocument(q, ctx, "quote", id));
  if (!doc) notFound();
  const pickers = doc.header.docstatus === 0 ? await loadPickers(ctx) : { customers: [], products: [] };
  return <DocumentView ctx={ctx} slug={slug} kind="quote" header={doc.header} lines={doc.lines} customers={pickers.customers} products={pickers.products} sp={await searchParams} />;
}
