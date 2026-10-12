import { notFound, redirect } from "next/navigation";
import { currentPortalUser, portalQuery } from "@/server/web/portal";
import { DocumentView, type PortalDocument } from "../../document";

// TODO(sales): "Pay now" (Paynow payment link) goes here once online payments exist.
export default async function PortalInvoice({ params }: PageProps<"/s/[slug]/account/invoices/[id]">) {
  const { slug, id } = await params;
  const me = await currentPortalUser(slug);
  if (!me) redirect("/account/sign-in");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await portalQuery<{ d: PortalDocument | null }>(me.userId, "select public.portal_document($1, 'invoice', $2) as d", [slug, id]);
  if (!row?.d) notFound();
  return <DocumentView doc={row.d} companyName={me.companyName} />;
}
