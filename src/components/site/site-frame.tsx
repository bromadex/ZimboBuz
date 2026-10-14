import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { SOCIAL_NETWORKS, siteStyle, whatsAppLink } from "@/lib/site/theme";
import type { SiteView } from "@/server/web/site-data";
import { CartLink } from "./quote-cart";

// The outside of every company website page: brand kit tokens, header with
// menu and quote cart, footer with contact details, WhatsApp button.

export function pageHref(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "•";
}

/** The themed root element (brand colours, fonts, corners, light/dark, motion). */
export function SiteRoot({ site, children, preview = false }: { site: SiteView; children: ReactNode; preview?: boolean }) {
  return (
    <div
      className="zs"
      data-template={site.settings.template}
      data-mode={site.branding.themeMode}
      data-motion={site.branding.motionLevel}
      data-preview={preview ? "" : undefined}
      style={siteStyle(site.branding) as CSSProperties}
    >
      {children}
    </div>
  );
}

export function Brand({ site }: { site: SiteView }) {
  return (
    <Link href="/" className="zs-brand">
      {site.branding.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- company uploads, served as is
        <img src={site.branding.logoUrl} alt={site.companyName} />
      ) : (
        <>
          <span className="zs-mark" aria-hidden>
            {initials(site.companyName)}
          </span>
          <span>{site.companyName}</span>
        </>
      )}
    </Link>
  );
}

export function SiteHeader({ site, current }: { site: SiteView; current?: string }) {
  const links = [
    ...site.menu.map((m) => ({ href: pageHref(m.slug), label: m.title })),
    { href: "/shop", label: "Shop" },
    ...(site.features.portal ? [{ href: "/account", label: "My account" }] : []),
  ];
  // Keep "Contact" last, after the shop, when there is one.
  const contact = links.findIndex((l) => l.href === "/contact");
  if (contact >= 0) links.push(links.splice(contact, 1)[0]);

  return (
    <header className="zs-header">
      <div className="zs-container zs-header-row">
        <Brand site={site} />
        <nav className="zs-nav" aria-label="Main">
          {links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="zs-header-actions">
          {site.features.addToQuote ? <CartLink slug={site.slug} /> : null}
          <details className="zs-menu-toggle">
            <summary>Menu</summary>
            <nav className="zs-menu-panel" aria-label="Main (small screens)">
              {links.map((l) => (
                <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined}>
                  {l.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

const WHATSAPP_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
  </svg>
);

export function SiteFooter({ site }: { site: SiteView }) {
  const s = site.settings;
  const socials = SOCIAL_NETWORKS.filter((n) => s.socialLinks[n.key]);
  const wa = whatsAppLink(s.contactWhatsapp);
  return (
    <footer className="zs-footer">
      <div className="zs-container">
        <div className="zs-footer-grid">
          <div>
            <Brand site={site} />
            {s.tagline || s.about ? <p className="zs-muted mt-3 max-w-sm">{s.tagline ?? s.about?.slice(0, 220)}</p> : null}
            {socials.length ? (
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                {socials.map((n) => (
                  <li key={n.key}>
                    <a href={s.socialLinks[n.key]} rel="noopener noreferrer me" target="_blank">
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <h3>Contact</h3>
            <ul className="space-y-1.5">
              {s.contactPhone ? <li><a href={`tel:${s.contactPhone.replace(/[^\d+]/g, "")}`}>{s.contactPhone}</a></li> : null}
              {wa ? <li><a href={wa} rel="noopener noreferrer" target="_blank">WhatsApp {s.contactWhatsapp}</a></li> : null}
              {s.contactEmail ? <li><a href={`mailto:${s.contactEmail}`}>{s.contactEmail}</a></li> : null}
              {s.address ? <li className="zs-muted whitespace-pre-line">{s.address}</li> : null}
              {!s.contactPhone && !wa && !s.contactEmail && !s.address ? (
                <li><Link href="/contact">Send us a message</Link></li>
              ) : null}
            </ul>
          </div>
          <div>
            <h3>{s.openingHours ? "Opening hours" : "Explore"}</h3>
            {s.openingHours ? (
              <p className="whitespace-pre-line">{s.openingHours}</p>
            ) : (
              <ul className="space-y-1.5">
                <li><Link href="/shop">Shop</Link></li>
                {site.menu.slice(0, 5).map((m) => (
                  <li key={m.slug}><Link href={pageHref(m.slug)}>{m.title}</Link></li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="zs-footer-bottom">
          <span>
            © {new Date().getFullYear()} {site.companyName}
          </span>
          {site.platformBadge ? (
            <span>
              Website by <a href="https://zimerp.co.zw" rel="noopener">ZimERP</a>
            </span>
          ) : null}
        </div>
      </div>
      {wa ? (
        <a className="zs-whatsapp" href={wa} rel="noopener noreferrer" target="_blank" aria-label={`Chat with ${site.companyName} on WhatsApp`}>
          {WHATSAPP_ICON}
          <span className="hidden sm:inline">WhatsApp us</span>
        </a>
      ) : null}
    </footer>
  );
}

/** Shown while a company's website is not published. */
export function ComingSoon({ site }: { site: SiteView }) {
  return (
    <div className="zs-coming-soon zs-hero">
      <div className="zs-hero-bg" aria-hidden />
      <div className="zs-reveal" data-reveal="fade-up">
        <div className="mb-6 flex justify-center">
          <Brand site={site} />
        </div>
        <p className="zs-eyebrow">Coming soon</p>
        <h1 className="zs-h2">{site.companyName} is getting a new website</h1>
        <p className="zs-lead mx-auto mt-4">We are putting the finishing touches to it. Please visit again soon.</p>
      </div>
    </div>
  );
}
