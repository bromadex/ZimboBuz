import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Notice, PageHeader, SelectField, TextArea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { BLOCK_INFO, BLOCK_TYPES, cleanBlocks } from "@/lib/site/blocks";
import { assetUrl } from "@/lib/site/theme";
import { requirePermission } from "@/server/company";
import { withUser } from "@/server/data";
import { platformDomain, requestProtocol, siteOrigin } from "@/server/urls";
import {
  addBlock,
  archivePage,
  archiveSiteImage,
  moveBlockAction,
  publishPage,
  removeBlock,
  saveBlock,
  savePageDetails,
  uploadSiteImage,
} from "../../actions";
import { BlockFields, blockSummary, type OnlineProduct, type Picture } from "./block-fields";

// Page editor (P9): edit the draft's blocks with forms, see the draft in a
// live preview beside them, then publish.

const linkButton =
  "inline-flex items-center justify-center rounded-[var(--radius)] border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export default async function PageEditor({ params, searchParams }: PageProps<"/e/[slug]/website/pages/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "website.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canEdit = ctx.permissions.has("website.edit");
  const canPublish = ctx.permissions.has("website.publish");
  const view = sp.view === "phone" ? "phone" : "desktop";
  const open = typeof sp.open === "string" ? sp.open : null;

  const data = await withUser(ctx.userId, async (q) => {
    const page = (
      await q<{
        id: string; slug: string; title: string; description: string | null; nav_order: number; show_in_menu: boolean; blocks: unknown;
        published_at: Date | null; updated_at: Date; archived_at: Date | null; changed: boolean;
      }>(
        `select id, slug, title, description, nav_order, show_in_menu, blocks, published_at, updated_at, archived_at,
                (published_at is null or blocks is distinct from published_blocks or title is distinct from published_title) as changed
         from public.site_pages where company_id = $1 and id = $2`,
        [ctx.company.id, id],
      )
    ).rows[0];
    const pictures = (
      await q<{ id: string; key: string; name: string | null }>(
        `select id, storage_key as key, file_name as name from public.site_assets
         where company_id = $1 and kind = 'image' and archived_at is null order by created_at desc limit 60`,
        [ctx.company.id],
      )
    ).rows;
    const products = (
      await q<OnlineProduct>(
        "select id, name from public.products where company_id = $1 and show_online and archived_at is null order by name limit 200",
        [ctx.company.id],
      )
    ).rows;
    const live = (await q<{ published: boolean }>("select published from public.site_settings where company_id = $1", [ctx.company.id])).rows[0]?.published ?? false;
    return { page, pictures, products, live };
  });
  if (!data.page) notFound();
  const page = data.page;
  const blocks = cleanBlocks(page.blocks, ctx.company.id);
  const back = `/website/pages/${id}`;
  const h = await headers();
  const liveUrl = `${siteOrigin(slug, platformDomain(), h.get("host"), requestProtocol(h.get("x-forwarded-proto")))}${page.slug === "home" ? "/" : `/${page.slug}`}`;
  const previewSrc = `/site-preview/${id}?v=${new Date(page.updated_at).getTime()}`;
  const pictures: Picture[] = data.pictures.map((p) => ({ key: p.key, name: p.name }));

  return (
    <>
      <PageHeader
        title={page.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-xs">{page.slug === "home" ? "/" : `/${page.slug}`}</code>
            {page.archived_at ? (
              <Badge tone="muted">Archived</Badge>
            ) : !page.published_at ? (
              <Badge tone="draft">Never published</Badge>
            ) : page.changed ? (
              <Badge tone="info">Changes not published</Badge>
            ) : (
              <Badge tone="ok">Published {formatDateTime(page.published_at)}</Badge>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/website" className={linkButton}>
              All pages
            </Link>
            {page.published_at && data.live ? (
              <a href={liveUrl} target="_blank" rel="noopener" className={linkButton}>
                View live page ↗
              </a>
            ) : null}
            {canPublish && !page.archived_at ? (
              <form action={publishPage.bind(null, slug, id)}>
                <Button type="submit" disabled={!page.changed}>
                  {page.changed ? "Publish" : "Published"}
                </Button>
              </form>
            ) : null}
          </div>
        }
      />
      <Notice error={sp.error} success={sp.success} />
      {!data.live ? (
        <p className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your website is not live yet, so visitors see a “coming soon” page. Put it live on the <Link href="/website" className="font-semibold underline">website screen</Link>.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <h2 className="text-base font-semibold">Blocks</h2>
          {blocks.length === 0 ? <p className="text-sm text-zinc-500">This page is empty. Add a block below.</p> : null}
          <ol className="space-y-3">
            {blocks.map((b, i) => (
              <li key={b.id} id={`block-${b.id}`} className="scroll-mt-4">
                <details open={open === b.id} className="group rounded-[var(--radius)] border border-zinc-200 bg-white shadow-sm open:shadow-md dark:border-zinc-800 dark:bg-zinc-900">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{BLOCK_INFO[b.type].label}</span>
                      <span className="block truncate text-xs text-zinc-500">{blockSummary(b) || BLOCK_INFO[b.type].description}</span>
                    </span>
                    <span aria-hidden className="text-zinc-400 transition group-open:rotate-90">›</span>
                  </summary>
                  <form action={saveBlock.bind(null, slug, id, b.id)} className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
                    <fieldset disabled={!canEdit} className="space-y-4">
                      <BlockFields block={b} pictures={pictures} products={data.products} />
                      {canEdit ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                          <Button type="submit">Save block</Button>
                          <Button type="submit" variant="secondary" formAction={moveBlockAction.bind(null, slug, id, b.id, "up")} disabled={i === 0} aria-label={`Move block ${i + 1} up`}>
                            ↑ Up
                          </Button>
                          <Button type="submit" variant="secondary" formAction={moveBlockAction.bind(null, slug, id, b.id, "down")} disabled={i === blocks.length - 1} aria-label={`Move block ${i + 1} down`}>
                            ↓ Down
                          </Button>
                          <button type="submit" formAction={removeBlock.bind(null, slug, id, b.id)} className="ml-auto text-sm font-semibold text-red-700 underline dark:text-red-400">
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </fieldset>
                  </form>
                </details>
              </li>
            ))}
          </ol>

          {canEdit && !page.archived_at ? (
            <Card title="Add a block">
              <form action={addBlock.bind(null, slug, id)} className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <SelectField
                    label="Kind of block"
                    name="type"
                    options={BLOCK_TYPES.map((t) => ({ value: t, label: `${BLOCK_INFO[t].label}: ${BLOCK_INFO[t].description}` }))}
                  />
                </div>
                <Button type="submit">Add block</Button>
              </form>
            </Card>
          ) : null}

          <Card title="Your pictures">
            {canEdit ? (
              <form action={uploadSiteImage.bind(null, slug, back)} className="mb-4 flex flex-wrap items-end gap-3">
                <label className="block min-w-56 flex-1 text-sm">
                  <span className="mb-1 block font-medium">Upload a picture</span>
                  <input type="file" name="file" required accept="image/png,image/jpeg,image/webp,image/svg+xml" className="block w-full text-sm file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-semibold dark:file:bg-zinc-800" />
                  <span className="mt-1 block text-xs text-zinc-500">PNG, JPEG, WebP or SVG, up to 1 MB. Pictures are public on your website.</span>
                </label>
                <Button type="submit" variant="secondary">
                  Upload
                </Button>
              </form>
            ) : null}
            {data.pictures.length ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {data.pictures.map((p) => (
                  <li key={p.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded pictures */}
                    <img src={assetUrl(p.key) ?? ""} alt={p.name ?? ""} className="aspect-square w-full rounded-[var(--radius)] border border-zinc-200 object-cover dark:border-zinc-800" />
                    {canEdit ? (
                      <form action={archiveSiteImage.bind(null, slug, back)}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-xs text-zinc-500 underline">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No pictures yet.</p>
            )}
          </Card>

          <Card title="Page details">
            <form action={savePageDetails.bind(null, slug, id)} className="grid gap-4 sm:grid-cols-2">
              <fieldset disabled={!canEdit || !!page.archived_at} className="contents">
                <Field label="Title" name="title" defaultValue={page.title} required maxLength={120} />
                <Field
                  label="Address"
                  name="page_slug"
                  defaultValue={page.slug}
                  disabled={page.slug === "home"}
                  hint={page.slug === "home" ? "The home page is always at /." : "Lower-case letters, numbers and hyphens."}
                />
                <div className="sm:col-span-2">
                  <TextArea label="Description for search engines" name="description" defaultValue={page.description ?? ""} maxLength={300} rows={2} />
                </div>
                <Field label="Menu position" name="nav_order" type="number" defaultValue={page.nav_order} hint="Smaller numbers come first." />
                <label className="flex items-center gap-2 self-center text-sm">
                  <input type="checkbox" name="show_in_menu" defaultChecked={page.show_in_menu} /> Show in the menu
                </label>
                {canEdit && !page.archived_at ? (
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="secondary">
                      Save page details
                    </Button>
                  </div>
                ) : null}
              </fieldset>
            </form>
            {canEdit && page.slug !== "home" && !page.archived_at ? (
              <form action={archivePage.bind(null, slug, id)} className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <button type="submit" className="text-sm font-semibold text-red-700 underline dark:text-red-400">
                  Archive this page
                </button>
              </form>
            ) : null}
          </Card>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Preview of your draft</h2>
            <div className="flex overflow-hidden rounded-[var(--radius)] border border-zinc-300 text-sm dark:border-zinc-700" aria-label="Preview size">
              {(["desktop", "phone"] as const).map((v) => (
                <Link
                  key={v}
                  href={`${back}?view=${v}`}
                  aria-current={view === v ? "true" : undefined}
                  className={`px-3 py-1.5 font-medium ${view === v ? "bg-[var(--brand)] text-white" : "bg-white dark:bg-zinc-900"}`}
                >
                  {v === "desktop" ? "Computer" : "Phone"}
                </Link>
              ))}
            </div>
          </div>
          <div className={`overflow-hidden rounded-[var(--radius)] border border-zinc-300 bg-zinc-100 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${view === "phone" ? "mx-auto w-[390px] max-w-full" : ""}`}>
            <iframe title="Preview of your draft page" src={previewSrc} className="block h-[75vh] min-h-[32rem] w-full bg-white" loading="lazy" />
          </div>
          <p className="mt-2 text-xs text-zinc-500">The preview shows your saved draft. Links do nothing here; visitors see the published version.</p>
        </aside>
      </div>
    </>
  );
}
