import { notFound, redirect } from "next/navigation";
import { money } from "@/lib/format";
import { canPayOnline, loadLink, refreshLink } from "@/server/invoice-payments";
import { currentPortalUser, portalQuery } from "@/server/web/portal";
import { DocumentView, type PortalDocument } from "../../document";
import { payInvoice } from "./actions";

// An invoice in the customer portal, with "Pay now" through the business's
// own Paynow account when it takes online payments (P19).
export default async function PortalInvoice({ params, searchParams }: PageProps<"/s/[slug]/account/invoices/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const me = await currentPortalUser(slug);
  if (!me) redirect("/account/sign-in");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Coming back from Paynow: check the payment before showing the balance.
  let status: string | null = null;
  let linkId: string | null = null;
  if (typeof sp.payment === "string") {
    const link = await loadLink(sp.payment, id);
    if (link) {
      linkId = link.id;
      status = await refreshLink(link);
    }
  }

  const [row] = await portalQuery<{ d: PortalDocument | null }>(me.userId, "select public.portal_document($1, 'invoice', $2) as d", [slug, id]);
  if (!row?.d) notFound();
  const doc = row.d;
  const owed = Number(doc.balance_cents ?? 0);
  const online = owed > 0 && (await canPayOnline(slug, doc.currency));

  const notice =
    status === "paid" || status === "needs_attention" ? (
      <p className="zs-notice zs-notice-ok mt-4" role="status">
        Thank you. Your payment is confirmed.
      </p>
    ) : status === "pending" ? (
      <div className="zs-notice mt-4" role="status">
        <p>We are waiting for Paynow to confirm your payment. This page will update.</p>
        <meta httpEquiv="refresh" content="5" />
        {sp.test && linkId ? (
          <form action="/api/portal/pay/simulate" method="post" className="mt-2">
            <input type="hidden" name="link" value={linkId} />
            <button type="submit" className="zs-btn zs-btn-small">
              Pay (test mode)
            </button>
          </form>
        ) : null}
      </div>
    ) : status === "failed" || status === "cancelled" ? (
      <p className="zs-notice zs-notice-error mt-4" role="alert">
        The payment did not go through. Nothing was charged.
      </p>
    ) : typeof sp.error === "string" ? (
      <p className="zs-notice zs-notice-error mt-4" role="alert">
        {sp.error}
      </p>
    ) : null;

  return (
    <DocumentView doc={doc} companyName={me.companyName} notice={notice}>
      {online && status !== "pending" ? (
        <form action={payInvoice.bind(null, slug, id)} className="mt-6">
          <button type="submit" className="zs-btn">
            Pay {money(owed, doc.currency)} now
          </button>
          <p className="zs-muted mt-2 text-xs">EcoCash, OneMoney or card, through Paynow.</p>
        </form>
      ) : null}
    </DocumentView>
  );
}
