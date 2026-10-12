import { requirePermission } from "@/server/company";
import { DocList } from "../doc-list";

export default async function QuotesPage({ params, searchParams }: PageProps<"/e/[slug]/sales/quotes">) {
  const { slug } = await params;
  const ctx = await requirePermission(slug, "sales.view");
  return <DocList ctx={ctx} kind="quote" sp={await searchParams} />;
}
