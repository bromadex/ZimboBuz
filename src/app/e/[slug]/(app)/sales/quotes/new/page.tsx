import { requirePermission } from "@/server/company";
import { NewDocument } from "../../new-document";

export default async function NewQuotePage({ params, searchParams }: PageProps<"/e/[slug]/sales/quotes/new">) {
  const { slug } = await params;
  const ctx = await requirePermission(slug, "sales.quote.create");
  return <NewDocument ctx={ctx} slug={slug} kind="quote" sp={await searchParams} />;
}
