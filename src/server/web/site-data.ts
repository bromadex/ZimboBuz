import "server-only";
import { cache } from "react";
import { cleanBlocks, type Block } from "@/lib/site/blocks";
import { assetUrl, isTemplate, type SiteBranding, type Template } from "@/lib/site/theme";
import type { CompanyContext } from "../company";
import { withUser } from "../data";
import { withAnon } from "./anon";

// What the website renderer needs, from two sources: the public functions
// (anonymous visitors, published content only) and, for the ERP preview, the
// signed-in member's own view of the drafts.

export interface SiteSettings {
  template: Template;
  tagline: string | null;
  about: string | null;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  address: string | null;
  openingHours: string | null;
  socialLinks: Record<string, string>;
  seoDescription: string | null;
}

export interface SiteView {
  slug: string;
  companyId?: string;
  companyName: string;
  baseCurrency: string;
  pricesIncludeTax: boolean;
  vatRegistered: boolean;
  live: boolean;
  branding: SiteBranding;
  settings: SiteSettings;
  menu: Array<{ slug: string; title: string }>;
  /** hasProducts: at least one product is shown online (the shop has something in it). */
  features: { addToQuote: boolean; buy: boolean; portal: boolean; hasProducts: boolean };
}

export interface SitePage {
  slug: string;
  title: string;
  description: string | null;
  blocks: Block[];
}

export interface SiteProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  priceCents: string | null;
  currency: string;
  imageKey: string | null;
}

export interface ProductQuery {
  search?: string | null;
  limit: number;
  offset?: number;
  ids?: string[] | null;
}

export interface ProductSource {
  list(q: ProductQuery): Promise<{ rows: SiteProduct[]; total: number }>;
}

type Json = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toSettings(raw: Json | undefined): SiteSettings {
  const r = raw ?? {};
  return {
    template: isTemplate(r.template) ? r.template : "classic",
    tagline: s(r.tagline),
    about: s(r.about),
    contactPhone: s(r.contact_phone),
    contactWhatsapp: s(r.contact_whatsapp),
    contactEmail: s(r.contact_email),
    address: s(r.address),
    openingHours: s(r.opening_hours),
    socialLinks: r.social_links && typeof r.social_links === "object" ? (r.social_links as Record<string, string>) : {},
    seoDescription: s(r.seo_description),
  };
}

function toBranding(b: Json): SiteBranding {
  return {
    primaryColor: String(b.primary_color ?? "#0b6e4f"),
    secondaryColor: String(b.secondary_color ?? "#c98f00"),
    accentColor: String(b.accent_color ?? "#b42318"),
    fontPair: (b.font_pair ?? "modern") as SiteBranding["fontPair"],
    themeMode: (b.theme_mode ?? "system") as SiteBranding["themeMode"],
    motionLevel: (b.motion_level ?? "subtle") as SiteBranding["motionLevel"],
    cornerStyle: (b.corner_style ?? "rounded") as SiteBranding["cornerStyle"],
    logoUrl: assetUrl(s(b.logo_path)),
  };
}

type ProductRow = { id: string; name: string; description: string | null; unit: string; price_cents: string | null; currency: string; total?: string; image_key?: string | null };
const toProduct = (r: ProductRow): SiteProduct => ({
  id: r.id,
  name: r.name,
  description: r.description,
  unit: r.unit,
  priceCents: r.price_cents === null ? null : String(r.price_cents),
  currency: String(r.currency).trim(),
  imageKey: r.image_key ?? null,
});

// --- Public (anonymous) -------------------------------------------------------

/** The site for a company slug, or null for unknown or inactive companies. Cached per request. */
export const publicSite = cache(async (slug: string): Promise<SiteView | null> => {
  const found = await withAnon(async (q) => {
    const bundle = (await q<{ b: Json | null }>("select public.site_bundle($1) as b", [slug])).rows[0]?.b;
    if (!bundle) return null;
    const any = (await q<{ n: string }>("select count(*) as n from public.site_products($1, null, 1)", [slug])).rows[0];
    return { bundle, hasProducts: Number(any?.n ?? 0) > 0 };
  });
  if (!found) return null;
  const b = found.bundle;
  const company = b.company as Json;
  const features = (b.features ?? {}) as Json;
  return {
    slug: String(company.slug),
    companyName: String(company.name),
    baseCurrency: String(company.base_currency).trim(),
    pricesIncludeTax: company.prices_include_tax !== false,
    vatRegistered: company.vat_registered === true,
    live: b.live === true,
    branding: toBranding((b.branding ?? {}) as Json),
    settings: toSettings(b.settings as Json),
    menu: ((b.menu as Array<{ slug: string; title: string }>) ?? []).map((m) => ({ slug: m.slug, title: m.title })),
    features: {
      addToQuote: features.add_to_quote === true,
      buy: features.buy === true,
      portal: features.portal === true,
      hasProducts: found.hasProducts,
    },
  };
});

export const publicPage = cache(async (slug: string, page: string): Promise<SitePage | null> => {
  const p = await withAnon(async (q) => (await q<{ p: Json | null }>("select public.site_page($1, $2) as p", [slug, page])).rows[0]?.p);
  if (!p) return null;
  return { slug: String(p.slug), title: String(p.title ?? ""), description: s(p.description), blocks: cleanBlocks(p.blocks) };
});

export function publicProducts(slug: string): ProductSource {
  return {
    async list({ search = null, limit, offset = 0, ids = null }) {
      const rows = await withAnon(
        async (q) => (await q<ProductRow>("select * from public.site_products($1, $2, $3, $4, $5)", [slug, search, limit, offset, ids])).rows,
      );
      return { rows: rows.map(toProduct), total: Number(rows[0]?.total ?? 0) };
    },
  };
}

export const publicProduct = cache(async (slug: string, id: string): Promise<SiteProduct | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const p = await withAnon(async (q) => (await q<{ p: ProductRow | null }>("select public.site_product($1, $2) as p", [slug, id])).rows[0]?.p);
  return p ? toProduct(p) : null;
});

// --- Preview (signed-in staff, drafts) ------------------------------------------

/** The site as it would look with every draft published, read as the member. */
export async function previewSite(ctx: CompanyContext): Promise<SiteView> {
  return withUser(ctx.userId, async (q) => {
    const settings = (await q<Json>("select * from public.site_settings where company_id = $1", [ctx.company.id])).rows[0];
    const branding = (await q<Json>("select * from public.company_branding where company_id = $1", [ctx.company.id])).rows[0] ?? {};
    const menu = (
      await q<{ slug: string; title: string }>(
        `select slug, title from public.site_pages where company_id = $1 and archived_at is null and show_in_menu
         order by nav_order, created_at`,
        [ctx.company.id],
      )
    ).rows;
    const flags = (
      await q<{ add_to_quote: boolean; buy: boolean; portal: boolean; has_products: boolean }>(
        `select app.feature_on($1, 'website.add_to_quote') as add_to_quote, app.feature_on($1, 'website.buy') as buy,
                app.module_on($1, 'portal') as portal,
                exists (select 1 from public.products p where p.company_id = $1 and p.show_online and p.archived_at is null) as has_products`,
        [ctx.company.id],
      )
    ).rows[0];
    return {
      slug: ctx.company.slug,
      companyId: ctx.company.id,
      companyName: ctx.company.name,
      baseCurrency: ctx.company.baseCurrency,
      pricesIncludeTax: ctx.company.pricesIncludeTax,
      vatRegistered: ctx.company.vatRegistered,
      live: true,
      branding: toBranding(branding),
      settings: toSettings(settings ?? {}),
      menu,
      features: { addToQuote: flags.add_to_quote, buy: flags.buy, portal: flags.portal, hasProducts: flags.has_products },
    };
  });
}

export async function previewPage(ctx: CompanyContext, pageId: string): Promise<SitePage | null> {
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) return null;
  const row = await withUser(ctx.userId, async (q) =>
    (
      await q<{ slug: string; title: string; description: string | null; blocks: unknown }>(
        "select slug, title, description, blocks from public.site_pages where company_id = $1 and id = $2",
        [ctx.company.id, pageId],
      )
    ).rows[0],
  );
  return row ? { slug: row.slug, title: row.title, description: row.description, blocks: cleanBlocks(row.blocks, ctx.company.id) } : null;
}

export function previewProducts(ctx: CompanyContext): ProductSource {
  return {
    async list({ search = null, limit, offset = 0, ids = null }) {
      const rows = await withUser(ctx.userId, async (q) =>
        (
          await q<ProductRow>(
            `select p.id, p.name, p.description, p.unit, app.price_cents(p.company_id, p.id, c.base_currency) as price_cents,
                    c.base_currency as currency, count(*) over () as total, p.image_key
             from public.products p join public.companies c on c.id = p.company_id
             where p.company_id = $1 and p.show_online and p.archived_at is null
               and ($2::text is null or strpos(lower(p.name), lower($2)) > 0)
               and ($5::uuid[] is null or p.id = any($5))
             order by case when $5::uuid[] is not null then array_position($5, p.id) end, p.name, p.id
             limit $3 offset $4`,
            [ctx.company.id, search, limit, offset, ids],
          )
        ).rows,
      );
      return { rows: rows.map(toProduct), total: Number(rows[0]?.total ?? 0) };
    },
  };
}
