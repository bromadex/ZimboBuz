import { EmailLink } from "@/components/email-link";
import { MIN_PASSWORD } from "@/server/adapters/supabase-auth";
import { portalCompleteLink } from "../../actions";

// Where links in portal emails land: an invitation (choose a password), a
// password reset, or an address confirmation.
export default async function PortalEmailLink({ params }: PageProps<"/s/[slug]/account/auth">) {
  const { slug } = await params;
  return (
    <section className="zs-section zs-hero flex-1">
      <div className="zs-hero-bg" aria-hidden />
      <div className="zs-container" style={{ maxWidth: "28rem" }}>
        <div className="zs-card p-6 sm:p-8">
          <p className="zs-eyebrow">Customer portal</p>
          <h1 className="zs-h2">Your account</h1>
          <div className="mt-6">
            <EmailLink
              action={portalCompleteLink.bind(null, slug)}
              minPassword={MIN_PASSWORD}
              classes={{
                form: "space-y-4",
                field: "zs-field",
                label: "",
                input: "zs-input",
                button: "zs-btn zs-btn-block",
                error: "zs-notice zs-notice-error",
                muted: "zs-muted",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
