import { requirePermission } from "@/server/company";
import { NewDocument } from "../../new-document";

export default async function NewInvoicePage({ params, searchParams }: PageProps<"/e/[slug]/sales/invoices/new">) {
  const { slug } = await params;
  const ctx = await requirePermission(slug, "sales.invoice.create");
  return <NewDocument ctx={ctx} slug={slug} kind="invoice" sp={await searchParams} />;
}
