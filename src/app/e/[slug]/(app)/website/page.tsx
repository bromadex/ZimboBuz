import Link from "next/link";
import { ListView } from "@/components/list-view";
import { Badge, Button, Card, Field, Notice, PageHeader, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { isTemplate, SOCIAL_NETWORKS, TEMPLATES, type Template } from "@/lib/site/theme";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { companyOrigins } from "@/server/domains";
import { platformDomain } from "@/server/urls";
import { addPage, saveSiteSettings, setSitePublished, setTemplate } from "./actions";

// Website and store (P9): pages, template, site details and going live.

const SORTS = [
  { value: "menu", label: "Menu order", sql: "p.nav_order, p.created_at" },
  { value: "title", label: "Title", sql: "p.title" },
  { value: "changed", label: "Last changed", sql: "p.updated_at desc" },
];

type PageRow = {
  id: string; title: string; slug: string; show_in_menu: boolean; published_at: Date | null; updated_at: Date; changed: boolean;
};

type Settings = {
  template: Template; published: boolean; published_at: Date | null; tagline: string | null; about: string | null;
  contact_phone: string | null; contact_whatsapp: string | null; contact_email: string | null; address: string | null;
  opening_hours: string | null; social_links: Record<string, string>; seo_description: string | null;
};

// A small drawing of each template, in the company's colours.
function MiniHeader({ dark = false, border = "border-b border-zinc-200", mark = "rounded-sm", centre = false }: { dark?: boolean; border?: string; mark?: string; centre?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1.5 ${dark ? "bg-[var(--brand)]" : border} ${centre ? "justify-center" : ""}`}>
      <span className={`size-2.5 ${mark} ${dark ? "bg-white" : "bg-[var(--brand)]"}`} />
      <span className={`h-1.5 w-8 rounded ${dark ? "bg-white/70" : "bg-zinc-300"}`} />
      {centre ? null : (
        <span className="ml-auto flex gap-1">
          {[0, 1, 2].map((i) => <span key={i} className={`h-1 w-4 rounded ${dark ? "bg-white/60" : "bg-zinc-300"}`} />)}
        </span>
      )}
    </div>
  );
}

function Lines({ light = false, widths = ["w-11/12", "w-3/4"], centre = false }: { light?: boolean; widths?: string[]; centre?: boolean }) {
  return (
    <div className={`space-y-1.5 ${centre ? "flex flex-col items-center" : ""}`}>
      {widths.map((w, i) => <span key={i} className={`block h-3 rounded ${w} ${light ? "bg-white" : "bg-zinc-800"}`} />)}
      <span className={`block h-1.5 w-2/3 rounded ${light ? "bg-white/60" : "bg-zinc-400"}`} />
    </div>
  );
}

function Cards({ count = 3, className = "h-8 rounded border border-zinc-200 bg-zinc-50" }: { count?: number; className?: string }) {
  return (
    <div className={`grid gap-1.5 p-3 ${count === 2 ? "grid-cols-2" : count === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {Array.from({ length: count }, (_, i) => <span key={i} className={`block ${className}`} />)}
    </div>
  );
}

function TemplatePicture({ kind }: { kind: Template }) {
  const frame = "overflow-hidden rounded-[var(--radius)] border border-zinc-200 bg-white dark:border-zinc-700";
  switch (kind) {
    case "bold":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader dark />
          <div className="bg-[var(--brand)] p-3">
            <Lines light widths={["w-4/5", "w-3/5"]} />
            <span className="mt-2 block h-3 w-12 rounded-sm bg-[var(--brand-accent)]" />
          </div>
          <Cards className="h-8 rounded bg-zinc-200 shadow" />
        </div>
      );
    case "showcase":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader border="border-b-2 border-[var(--brand)]" />
          <div className="grid grid-cols-[1fr_1.6fr] gap-2 bg-zinc-100 p-3">
            <div className="space-y-1.5 self-center">
              <span className="block h-2.5 w-full rounded bg-zinc-800" />
              <span className="block h-1.5 w-3/4 rounded bg-zinc-400" />
              <span className="mt-2 block h-2.5 w-10 rounded bg-[var(--brand)]" />
            </div>
            <span className="block h-16 rounded bg-gradient-to-br from-[var(--brand)] to-[var(--brand-2)]" />
          </div>
          <Cards count={2} className="h-10 rounded border border-zinc-200 bg-zinc-100" />
        </div>
      );
    case "menu":
      return (
        <div aria-hidden className={`${frame} bg-[#fbf3e6]`}>
          <MiniHeader border="border-b border-[#eadfce]" />
          <div className="flex flex-col items-center gap-1.5 p-3">
            <span className="block h-1.5 w-10 rounded bg-[var(--brand-2)]" />
            <span className="block h-3 w-3/4 rounded-full bg-zinc-700" />
          </div>
          <div className="space-y-1.5 px-4 pb-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-end gap-1">
                <span className="block h-1.5 w-10 rounded bg-zinc-700" />
                <span className="block flex-1 border-b-2 border-dotted border-zinc-400" />
                <span className="block h-1.5 w-5 rounded bg-[var(--brand)]" />
              </div>
            ))}
          </div>
        </div>
      );
    case "boutique":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader border="" mark="rounded-none" centre />
          <div className="flex flex-col items-center gap-1.5 px-3 py-4">
            <span className="block h-2.5 w-2/3 bg-zinc-700" />
            <span className="block h-1 w-1/3 bg-zinc-300" />
          </div>
          <Cards count={4} className="aspect-square bg-zinc-100" />
        </div>
      );
    case "ministry":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader />
          <div className="bg-gradient-to-b from-[color-mix(in_oklab,var(--brand)_22%,white)] to-white px-3 py-4">
            <Lines centre widths={["w-2/3"]} />
            <span className="mx-auto mt-2 block h-3 w-12 rounded-full bg-[var(--brand)]" />
          </div>
          <Cards className="h-7 rounded-full bg-[color-mix(in_oklab,var(--brand)_12%,white)]" />
        </div>
      );
    case "cause":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader border="border-b-2 border-[var(--brand-accent)]" />
          <div className="border-b-4 border-[var(--brand-accent)] bg-[var(--brand)] p-3">
            <Lines light widths={["w-4/5", "w-1/2"]} />
          </div>
          <div className="grid grid-cols-3 gap-1.5 bg-[var(--brand-accent)] p-3">
            {[0, 1, 2].map((i) => <span key={i} className="mx-auto block h-4 w-8 rounded-sm bg-white/90" />)}
          </div>
        </div>
      );
    case "academy":
      return (
        <div aria-hidden className={frame}>
          <div className="border-t-2 border-[var(--brand-2)]">
            <MiniHeader mark="rounded-b-full" />
          </div>
          <div className="grid grid-cols-[1.2fr_1fr] gap-2 bg-[var(--brand)] p-3">
            <Lines light widths={["w-11/12", "w-2/3"]} />
            <span className="block rounded-sm border-2 border-[var(--brand-2)] bg-white/20" />
          </div>
          <div className="space-y-1 p-3">
            {[0, 1].map((i) => <span key={i} className="block h-3 border-l-4 border-[var(--brand)] bg-zinc-100" />)}
          </div>
        </div>
      );
    case "consult":
      return (
        <div aria-hidden className={frame}>
          <MiniHeader />
          <div className="grid grid-cols-2">
            <div className="bg-zinc-100 p-3">
              <span className="mb-1.5 block h-0.5 w-4 bg-[var(--brand)]" />
              <Lines widths={["w-full", "w-3/4"]} />
            </div>
            <div className="p-3">
              <span className="block h-full min-h-10 rounded-sm bg-gradient-to-br from-[var(--brand)] to-zinc-800" />
            </div>
          </div>
          <Cards className="h-8 rounded-sm border border-zinc-300" />
        </div>
      );
    default:
      return (
        <div aria-hidden className={frame}>
          <MiniHeader />
          <div className="grid grid-cols-[1.2fr_1fr] gap-2 bg-gradient-to-b from-zinc-100 to-white p-3">
            <div>
              <Lines />
              <span className="mt-2 block h-3 w-12 rounded bg-[var(--brand)]" />
            </div>
            <span className="block rounded bg-[var(--brand)] opacity-80" />
          </div>
          <Cards />
        </div>
      );
  }
}

export default async function WebsitePage({ params, searchParams }: PageProps<"/e/[slug]/website">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "website.view");
  const canEdit = ctx.permissions.has("website.edit");
  const canPublish = ctx.permissions.has("website.publish");
  const lp = listParams(sp, { sorts: SORTS });

  const data = await withUser(ctx.userId, async (q) => {
    if (canEdit) await q("select public.ensure_site($1)", [ctx.company.id]);
    const settings = (await q<Settings>("select * from public.site_settings where company_id = $1", [ctx.company.id])).rows[0] ?? null;
    const where = "p.company_id = $1 and p.archived_at is null and ($2 = '' or p.title ilike $3 or p.slug ilike $3)";
    const args = [ctx.company.id, lp.q, likePattern(lp.q)];
    const total = Number((await q<{ n: string }>(`select count(*) as n from public.site_pages p where ${where}`, args)).rows[0].n);
    const pages = (
      await q<PageRow>(
        `select p.id, p.title, p.slug, p.show_in_menu, p.published_at, p.updated_at,
                (p.published_at is not null and (p.blocks is distinct from p.published_blocks or p.title is distinct from p.published_title)) as changed
         from public.site_pages p where ${where} order by ${lp.sort.sql} limit ${lp.pageSize} offset ${lp.offset}`,
        args,
      )
    ).rows;
    const domain = (
      await q<{ hostname: string }>(
        `select hostname from public.company_domains where company_id = $1 and kind <> 'erp' and archived_at is null and verified_at is not null
         order by is_primary desc, created_at limit 1`,
        [ctx.company.id],
      )
    ).rows[0];
    // The template that suits the company's industry, if it chose one.
    const industry = (
      await q<{ template: string | null; name: string | null }>(
        `select i.website_template as template, i.name from public.companies c
         left join public.industries i on i.code = c.industry_code where c.id = $1`,
        [ctx.company.id],
      )
    ).rows[0];
    return { settings, pages, total, domain, industry };
  });
  const suggested = isTemplate(data.industry?.template) ? data.industry.template : null;

  const origin = (await companyOrigins(slug)).site;
  const s = data.settings;
  const live = s?.published ?? false;

  return (
    <>
      <PageHeader
        title="Website and store"
        description="Your public website and online shop, in your brand. Edit pages, choose a look and publish when you are ready."
        actions={
          <a href={origin} target="_blank" rel="noopener" className="rounded-[var(--radius)] border border-zinc-300 px-4 py-2 text-sm font-semibold dark:border-zinc-700">
            Open your website ↗
          </a>
        }
      />
      <Notice error={sp.error} success={sp.success} />

      {!s ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Your website has not been set up yet. Someone who can edit the website needs to open this page first.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-base font-semibold">
                  {live ? <Badge tone="ok">Live</Badge> : <Badge tone="draft">Not published</Badge>}
                  <span className="truncate">{data.domain?.hostname ?? `${slug}.${platformDomain()}`}</span>
                </p>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {live
                    ? `Visitors can see your published pages and shop${s.published_at ? ` (live since ${formatDateTime(s.published_at)})` : ""}.`
                    : "Visitors see a “coming soon” page until you put your website live."}{" "}
                  {ctx.permissions.has("admin.domains.manage") ? (
                    <Link href="/settings/domains" className="font-semibold underline">
                      Use your own domain
                    </Link>
                  ) : null}
                </p>
              </div>
              {canPublish ? (
                <form action={setSitePublished.bind(null, slug)}>
                  <input type="hidden" name="published" value={live ? "false" : "true"} />
                  <Button type="submit" variant={live ? "secondary" : "primary"}>
                    {live ? "Take the website offline" : "Put the website live"}
                  </Button>
                </form>
              ) : null}
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section className="min-w-0 space-y-3">
              <h2 className="text-base font-semibold">Pages</h2>
              <ListView<PageRow>
                path="/website"
                sp={sp}
                params={lp}
                total={data.total}
                rows={data.pages}
                sorts={SORTS}
                searchLabel="Search pages"
                href={(p) => `/website/pages/${p.id}`}
                empty="No pages yet."
                columns={[
                  { label: "Page", cell: (p) => p.title },
                  { label: "Address", cell: (p) => <code className="text-xs">{p.slug === "home" ? "/" : `/${p.slug}`}</code> },
                  { label: "In menu", cell: (p) => (p.show_in_menu ? "Yes" : "No") },
                  {
                    label: "Status",
                    cell: (p) =>
                      !p.published_at ? <Badge tone="draft">Never published</Badge> : p.changed ? <Badge tone="info">Changes not published</Badge> : <Badge tone="ok">Published</Badge>,
                  },
                  { label: "Last changed", cell: (p) => formatDateTime(p.updated_at), className: "whitespace-nowrap" },
                ]}
                card={(p) => (
                  <>
                    <p className="font-semibold">{p.title}</p>
                    <p className="text-xs text-zinc-500">{p.slug === "home" ? "/" : `/${p.slug}`}</p>
                    <p className="mt-2">{!p.published_at ? <Badge tone="draft">Never published</Badge> : p.changed ? <Badge tone="info">Changes not published</Badge> : <Badge tone="ok">Published</Badge>}</p>
                  </>
                )}
              />
              <p className="text-xs text-zinc-500">
                Your shop is always at <code>/shop</code> and the visitor’s quote at <code>/quote</code>; they use your products shown online.
              </p>
            </section>

            <div className="space-y-6">
              {canEdit ? (
                <Card title="Add a page">
                  <form action={addPage.bind(null, slug)} className="space-y-4">
                    <Field label="Title" name="title" required placeholder="About us" maxLength={120} />
                    <Field label="Address" name="page_slug" placeholder="about-us" hint="Optional. Made from the title if left empty." />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="show_in_menu" defaultChecked /> Show in the menu
                    </label>
                    <Button type="submit" className="w-full">
                      Add page
                    </Button>
                  </form>
                </Card>
              ) : null}

              <Card title="Look">
                <form action={setTemplate.bind(null, slug)} className="space-y-4">
                  <fieldset>
                    <legend className="sr-only">Template</legend>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
                      {TEMPLATES.map((t) => (
                        <label key={t.code} className="block cursor-pointer text-sm">
                          <input type="radio" name="template" value={t.code} defaultChecked={s.template === t.code} className="peer sr-only" disabled={!canEdit} />
                          <span className="block rounded-[var(--radius)] p-1 ring-2 ring-transparent peer-checked:ring-[var(--brand)] peer-focus-visible:ring-zinc-400">
                            <TemplatePicture kind={t.code} />
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 font-semibold">
                            {t.label}
                            {s.template === t.code ? <Badge tone="ok">In use</Badge> : null}
                            {suggested === t.code ? <Badge tone="info">Suggested</Badge> : null}
                          </span>
                          <span className="block text-xs text-zinc-500">{t.description}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {suggested && data.industry?.name ? (
                    <p className="text-xs text-zinc-500">
                      “Suggested” is the look made for your kind of organisation ({data.industry.name}). Changing the look keeps all your pages and words.
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-500">Changing the look keeps all your pages and words.</p>
                  )}
                  {canEdit ? (
                    <Button type="submit" variant="secondary" className="w-full">
                      Use this look
                    </Button>
                  ) : null}
                  <p className="text-xs text-zinc-500">
                    Colours, fonts, corners, light or dark and animation come from your{" "}
                    {ctx.permissions.has("admin.branding.edit") ? <Link href="/settings/branding" className="underline">brand kit</Link> : "brand kit"}.
                  </p>
                </form>
              </Card>
            </div>
          </div>

          <Card title="Site details">
            <form action={saveSiteSettings.bind(null, slug)} className="grid gap-4 md:grid-cols-2">
              <fieldset disabled={!canEdit} className="contents">
                <div className="md:col-span-2">
                  <Field label="Tagline" name="tagline" defaultValue={s.tagline ?? ""} maxLength={200} placeholder="Building materials at fair prices since 1998" />
                </div>
                <div className="md:col-span-2">
                  <TextArea label="About your business" name="about" defaultValue={s.about ?? ""} maxLength={5000} hint="Shown in the footer when there is no tagline." />
                </div>
                <Field label="Phone" name="contact_phone" type="tel" defaultValue={s.contact_phone ?? ""} placeholder="024 2700 000" />
                <Field label="WhatsApp" name="contact_whatsapp" type="tel" defaultValue={s.contact_whatsapp ?? ""} placeholder="077 123 4567" hint="Adds a WhatsApp button to every page." />
                <Field label="Email" name="contact_email" type="email" defaultValue={s.contact_email ?? ""} />
                <div />
                <TextArea label="Address" name="address" defaultValue={s.address ?? ""} maxLength={500} />
                <TextArea label="Opening hours" name="opening_hours" defaultValue={s.opening_hours ?? ""} maxLength={1000} placeholder={"Mon–Fri 8:00–17:00\nSat 8:00–13:00"} />
                {SOCIAL_NETWORKS.map((n) => (
                  <Field key={n.key} label={n.label} name={`social_${n.key}`} defaultValue={s.social_links?.[n.key] ?? ""} placeholder={`https://${n.key === "x" ? "x" : n.key}.com/yourpage`} />
                ))}
                <div className="md:col-span-2">
                  <TextArea label="Description for search engines" name="seo_description" defaultValue={s.seo_description ?? ""} maxLength={300} hint="One or two sentences shown by Google under your name." />
                </div>
                {canEdit ? (
                  <div className="md:col-span-2">
                    <Button type="submit">Save site details</Button>
                  </div>
                ) : null}
              </fieldset>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
