import Link from "next/link";
import { redirect } from "next/navigation";
import { authMode } from "@/server/auth";
import { portalForgotPassword } from "../../actions";

export default async function PortalForgotPassword({ params, searchParams }: PageProps<"/s/[slug]/account/forgot-password">) {
  const { slug } = await params;
  const sp = await searchParams;
  if (authMode() === "dev") redirect("/account/sign-in");
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <section className="zs-section zs-hero flex-1">
      <div className="zs-hero-bg" aria-hidden />
      <div className="zs-container" style={{ maxWidth: "28rem" }}>
        <div className="zs-card p-6 sm:p-8">
          <p className="zs-eyebrow">Customer portal</p>
          <h1 className="zs-h2">Forgot your password?</h1>
          <p className="zs-muted mt-2">We will email you a link to choose a new one.</p>
          {error ? <p className="zs-notice zs-notice-error mt-5" role="alert">{error}</p> : null}
          <form action={portalForgotPassword.bind(null, slug)} className="mt-6 space-y-4">
            <label className="zs-field">
              <span>Email address</span>
              <input className="zs-input" name="email" type="email" required autoComplete="email" />
            </label>
            <button type="submit" className="zs-btn zs-btn-block">
              Send the link
            </button>
          </form>
          <p className="zs-muted mt-5 text-sm">
            <Link href="/account/sign-in" className="zs-link">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
