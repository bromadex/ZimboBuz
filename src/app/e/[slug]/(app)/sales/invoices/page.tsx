import { requirePermission } from "@/server/company";
import { DocList } from "../doc-list";

export default async function InvoicesPage({ params, searchParams }: PageProps<"/e/[slug]/sales/invoices">) {
  const { slug } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  return <DocList ctx={ctx} kind="invoice" sp={await searchParams} />;
}
