import Link from "next/link";
import { redirect } from "next/navigation";
import { authMode } from "@/server/auth";
import { currentPortalUser } from "@/server/web/portal";
import { publicSite } from "@/server/web/site-data";
import { portalSignIn } from "../../actions";

export default async function PortalSignIn({ params, searchParams }: PageProps<"/s/[slug]/account/sign-in">) {
  const { slug } = await params;
  const sp = await searchParams;
  if (await currentPortalUser(slug)) redirect("/account");
  const site = await publicSite(slug);
  const error = typeof sp.error === "string" ? sp.error : null;
  const success = typeof sp.success === "string" ? sp.success : null;

  return (
    <section className="zs-section zs-hero flex-1">
      <div className="zs-hero-bg" aria-hidden />
      <div className="zs-container" style={{ maxWidth: "28rem" }}>
        <div className="zs-card p-6 sm:p-8 zs-reveal" data-reveal="fade-up">
          <p className="zs-eyebrow">Customer portal</p>
          <h1 className="zs-h2">Sign in</h1>
          <p className="zs-muted mt-2">See your quotes, invoices, payments and statement from {site?.companyName ?? "us"}.</p>
          {error ? <p className="zs-notice zs-notice-error mt-5" role="alert">{error}</p> : null}
          {success ? <p className="zs-notice zs-notice-ok mt-5" role="status">{success}</p> : null}
          <form action={portalSignIn.bind(null, slug)} className="mt-6 space-y-4">
            <label className="zs-field">
              <span>Email address</span>
              <input className="zs-input" name="email" type="email" required autoComplete="email" />
            </label>
            {authMode() === "dev" ? (
              <p className="zs-muted text-xs">Development sign-in: no password or email link is needed.</p>
            ) : (
              <label className="zs-field">
                <span>Password</span>
                <input className="zs-input" name="password" type="password" required autoComplete="current-password" />
              </label>
            )}
            <button type="submit" className="zs-btn zs-btn-block">
              Sign in
            </button>
          </form>
          <p className="zs-muted mt-5 text-sm">
            Use the email address we invited. No account yet? Ask us to invite you.
            {authMode() === "dev" ? null : (
              <>
                {" "}
                <Link href="/account/forgot-password" className="zs-link">
                  Forgot your password?
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
