import Link from "next/link";
import { headers } from "next/headers";
import { ListView } from "@/components/list-view";
import { Badge, Button, Card, Field, Notice, PageHeader, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { likePattern, listParams } from "@/lib/list-params";
import { SOCIAL_NETWORKS } from "@/lib/site/theme";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { platformDomain, requestProtocol, siteOrigin } from "@/server/urls";
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
  template: "classic" | "bold"; published: boolean; published_at: Date | null; tagline: string | null; about: string | null;
  contact_phone: string | null; contact_whatsapp: string | null; contact_email: string | null; address: string | null;
  opening_hours: string | null; social_links: Record<string, string>; seo_description: string | null;
};

function TemplatePicture({ kind }: { kind: "classic" | "bold" }) {
  const bold = kind === "bold";
  return (
    <div aria-hidden className="overflow-hidden rounded-[var(--radius)] border border-zinc-200 bg-white dark:border-zinc-700">
      <div className={`flex items-center gap-1.5 px-2 py-1.5 ${bold ? "bg-[var(--brand)]" : "border-b border-zinc-200"}`}>
        <span className={`size-2.5 rounded-sm ${bold ? "bg-white" : "bg-[var(--brand)]"}`} />
        <span className={`h-1.5 w-8 rounded ${bold ? "bg-white/70" : "bg-zinc-300"}`} />
        <span className="ml-auto flex gap-1">
          {[0, 1, 2].map((i) => <span key={i} className={`h-1 w-4 rounded ${bold ? "bg-white/60" : "bg-zinc-300"}`} />)}
        </span>
      </div>
      <div className={`grid gap-2 p-3 ${bold ? "bg-[var(--brand)]" : "grid-cols-[1.2fr_1fr] bg-gradient-to-b from-zinc-100 to-white"}`}>
        <div className="space-y-1.5">
          <span className={`block h-3 rounded ${bold ? "w-4/5 bg-white" : "w-11/12 bg-zinc-800"}`} />
          <span className={`block h-3 rounded ${bold ? "w-3/5 bg-white" : "w-3/4 bg-zinc-800"}`} />
          <span className={`block h-1.5 w-2/3 rounded ${bold ? "bg-white/60" : "bg-zinc-400"}`} />
          <span className={`mt-2 block h-3 w-12 ${bold ? "rounded-sm bg-[var(--brand-accent)]" : "rounded bg-[var(--brand)]"}`} />
        </div>
        {bold ? null : <span className="block rounded bg-[var(--brand)] opacity-80" />}
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`block h-8 rounded ${bold ? "bg-zinc-200 shadow" : "border border-zinc-200 bg-zinc-50"}`} />
        ))}
      </div>
    </div>
  );
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
    return { settings, pages, total, domain };
  });

  const h = await headers();
  const origin = siteOrigin(slug, platformDomain(), h.get("host"), requestProtocol(h.get("x-forwarded-proto")));
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
                  <div className="grid grid-cols-2 gap-3">
                    {(["classic", "bold"] as const).map((t) => (
                      <label key={t} className="block cursor-pointer text-sm">
                        <input type="radio" name="template" value={t} defaultChecked={s.template === t} className="peer sr-only" disabled={!canEdit} />
                        <span className="block rounded-[var(--radius)] p-1 ring-2 ring-transparent peer-checked:ring-[var(--brand)] peer-focus-visible:ring-zinc-400">
                          <TemplatePicture kind={t} />
                        </span>
                        <span className="mt-1.5 block font-semibold">{t === "classic" ? "Classic" : "Bold"}</span>
                        <span className="block text-xs text-zinc-500">{t === "classic" ? "Light, calm and refined." : "Big type and strong colour."}</span>
                      </label>
                    ))}
                  </div>
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
