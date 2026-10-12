import { notFound, redirect } from "next/navigation";
import { formatDateTime } from "@/lib/format";
import { currentPortalUser, portalQuery } from "@/server/web/portal";
import { acceptQuote } from "../../../actions";
import { DocumentView, type PortalDocument } from "../../document";

export default async function PortalQuote({ params, searchParams }: PageProps<"/s/[slug]/account/quotes/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const me = await currentPortalUser(slug);
  if (!me) redirect("/account/sign-in");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row] = await portalQuery<{ d: PortalDocument | null }>(me.userId, "select public.portal_document($1, 'quote', $2) as d", [slug, id]);
  const doc = row?.d;
  if (!doc) notFound();
  const error = typeof sp.error === "string" ? sp.error : null;
  const success = typeof sp.success === "string" ? sp.success : null;

  return (
    <DocumentView
      doc={doc}
      companyName={me.companyName}
      notice={
        error || success ? (
          <p className={`zs-notice mt-4 ${error ? "zs-notice-error" : "zs-notice-ok"}`} role={error ? "alert" : "status"}>
            {error ?? success}
          </p>
        ) : null
      }
    >
      <div className="zs-card mt-4 p-5 sm:p-8">
        {doc.accepted_at ? (
          <p>
            <span className="zs-badge zs-badge-ok">Accepted</span> You accepted this quote on {formatDateTime(doc.accepted_at)}. We will be in touch to arrange everything.
          </p>
        ) : doc.expired ? (
          <p>This quote has expired. Please ask us for a new one.</p>
        ) : !me.canAccept ? (
          <p>Please contact us to accept this quote.</p>
        ) : (
          <form action={acceptQuote.bind(null, slug, id)} className="space-y-4">
            <h2 className="zs-h3">Happy with this quote?</h2>
            <p className="zs-muted text-sm">Accept it and we will prepare your order and invoice.</p>
            <label className="zs-field">
              <span>Note for us (optional)</span>
              <textarea name="note" rows={3} maxLength={1000} className="zs-input" placeholder="For example, a delivery date" />
            </label>
            <button type="submit" className="zs-btn">
              Accept this quote
            </button>
          </form>
        )}
      </div>
    </DocumentView>
  );
}
