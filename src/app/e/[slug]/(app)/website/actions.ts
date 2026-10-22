"use server";

import { act, changed, optional, text, UserError } from "@/server/act";
import type { CompanyContext } from "@/server/company";
import type { Query } from "@/server/data";
import {
  BLOCK_INFO,
  BLOCK_TYPES,
  blockFromForm,
  cleanBlocks,
  MAX_BLOCKS,
  moveBlock,
  newBlock,
  pageSlug,
  RESERVED_PAGE_SLUGS,
  type Block,
  type BlockType,
} from "@/lib/site/blocks";
import { cleanSocialLinks, isTemplate, SOCIAL_NETWORKS } from "@/lib/site/theme";
import { saveImage } from "@/server/web/uploads";

// Website screen actions (P9): site settings, template, going live, pages,
// blocks and website pictures. Row-level security and the publish functions
// decide who may do what (website.edit, website.publish).

const UUID = /^[0-9a-f-]{36}$/i;
const editor = (pageId: string, extra = "") => `/website/pages/${pageId}${extra}`;

function checkUuid(id: string) {
  if (!UUID.test(id)) throw new UserError("That page no longer exists.");
}

// --- Site ---------------------------------------------------------------------

export async function saveSiteSettings(slug: string, form: FormData): Promise<never> {
  return act(slug, "/website", "Site details saved.", async (q, ctx) => {
    const email = optional(form, "contact_email")?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("Please check the email address.");
    const social: Record<string, string> = {};
    for (const n of SOCIAL_NETWORKS) social[n.key] = text(form, `social_${n.key}`);
    const links = cleanSocialLinks(social);
    const refused = SOCIAL_NETWORKS.filter((n) => social[n.key] && !links[n.key]).map((n) => n.label);
    if (refused.length) throw new UserError(`Please check the ${refused.join(" and ")} link: it should be the address of your page there.`);
    const limit = (key: string, max: number, label: string) => {
      const v = optional(form, key);
      if (v && v.length > max) throw new UserError(`Please keep the ${label} under ${max} characters.`);
      return v;
    };
    await changed(
      q(
        `update public.site_settings set tagline = $2, about = $3, contact_phone = $4, contact_whatsapp = $5, contact_email = $6,
                address = $7, opening_hours = $8, social_links = $9, seo_description = $10
         where company_id = $1`,
        [
          ctx.company.id,
          limit("tagline", 200, "tagline"),
          limit("about", 5000, "description"),
          limit("contact_phone", 40, "phone number"),
          limit("contact_whatsapp", 40, "WhatsApp number"),
          email,
          limit("address", 500, "address"),
          limit("opening_hours", 1000, "opening hours"),
          JSON.stringify(links),
          limit("seo_description", 300, "search engine description"),
        ],
      ),
    );
  });
}

export async function setTemplate(slug: string, form: FormData): Promise<never> {
  const template = text(form, "template");
  return act(slug, "/website", "Template changed. Your site uses it straight away.", async (q, ctx) => {
    // Only the look changes: pages and their content stay as they are.
    if (!isTemplate(template)) throw new UserError("Please choose a template.");
    await changed(q("update public.site_settings set template = $2 where company_id = $1", [ctx.company.id, template]));
  });
}

export async function setSitePublished(slug: string, form: FormData): Promise<never> {
  const live = text(form, "published") === "true";
  return act(slug, "/website", live ? "Your website is live." : "Your website is offline. Visitors see a “coming soon” page.", (q, ctx) =>
    q("select public.set_site_published($1, $2)", [ctx.company.id, live]),
  );
}

// --- Pages --------------------------------------------------------------------

export async function addPage(slug: string, form: FormData): Promise<never> {
  return act(
    slug,
    "/website",
    "Page added. Add blocks, then publish it.",
    async (q, ctx) => {
      const title = text(form, "title");
      if (!title) throw new UserError("Please give the page a title.");
      if (title.length > 120) throw new UserError("Please keep the title under 120 characters.");
      const address = pageSlug(text(form, "page_slug") || title);
      if (!address) throw new UserError("Please give the page an address using letters or numbers.");
      if (RESERVED_PAGE_SLUGS.has(address)) throw new UserError(`The address “${address}” is used by the shop. Please choose another.`);
      const order = await q<{ n: number }>(
        "select coalesce(max(nav_order), 0) + 10 as n from public.site_pages where company_id = $1 and archived_at is null and nav_order < 90",
        [ctx.company.id],
      );
      const blocks = [{ ...newBlock("text"), heading: title, body: "" } as Block];
      try {
        const { rows } = await q<{ id: string }>(
          `insert into public.site_pages (company_id, slug, title, nav_order, show_in_menu, blocks)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [ctx.company.id, address, title, order.rows[0].n, form.get("show_in_menu") === "on", JSON.stringify(blocks)],
        );
        return rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new UserError(`You already have a page at /${address}. Please choose another address.`);
        throw e;
      }
    },
    { then: (id) => editor(String(id)) },
  );
}

export async function savePageDetails(slug: string, pageId: string, form: FormData): Promise<never> {
  return act(slug, editor(pageId), "Page details saved.", async (q, ctx) => {
    checkUuid(pageId);
    const title = text(form, "title");
    if (!title || title.length > 120) throw new UserError("Please give the page a title (up to 120 characters).");
    const current = (await q<{ slug: string }>("select slug from public.site_pages where company_id = $1 and id = $2", [ctx.company.id, pageId])).rows[0];
    if (!current) throw new UserError("That page no longer exists.");
    const address = current.slug === "home" ? "home" : pageSlug(text(form, "page_slug"));
    if (!address) throw new UserError("Please give the page an address using letters or numbers.");
    if (RESERVED_PAGE_SLUGS.has(address)) throw new UserError(`The address “${address}” is used by the shop. Please choose another.`);
    const order = Number.parseInt(text(form, "nav_order") || "0", 10);
    const description = optional(form, "description");
    if (description && description.length > 300) throw new UserError("Please keep the description under 300 characters.");
    try {
      await changed(
        q(
          `update public.site_pages set title = $3, slug = $4, description = $5, nav_order = $6, show_in_menu = $7
           where company_id = $1 and id = $2 and archived_at is null`,
          [ctx.company.id, pageId, title, address, description, Number.isFinite(order) ? Math.max(-1000, Math.min(1000, order)) : 0, form.get("show_in_menu") === "on"],
        ),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new UserError(`You already have a page at /${address}. Please choose another address.`);
      throw e;
    }
  });
}

export async function archivePage(slug: string, pageId: string): Promise<never> {
  return act(
    slug,
    editor(pageId),
    "Page archived. It is no longer on your website.",
    async (q, ctx) => {
      checkUuid(pageId);
      await changed(
        q("update public.site_pages set archived_at = now() where company_id = $1 and id = $2 and slug <> 'home' and archived_at is null", [ctx.company.id, pageId]),
      );
    },
    { then: () => "/website" },
  );
}

export async function publishPage(slug: string, pageId: string): Promise<never> {
  return act(slug, editor(pageId), "Published. Visitors now see this version.", async (q) => {
    checkUuid(pageId);
    await q("select public.publish_site_page($1)", [pageId]);
  });
}

// --- Blocks -------------------------------------------------------------------

async function editBlocks(q: Query, ctx: CompanyContext, pageId: string, change: (blocks: Block[]) => Block[]): Promise<void> {
  checkUuid(pageId);
  const row = (
    await q<{ blocks: unknown }>(
      "select blocks from public.site_pages where company_id = $1 and id = $2 and archived_at is null for update",
      [ctx.company.id, pageId],
    )
  ).rows[0];
  if (!row) throw new UserError("That page no longer exists.");
  const next = change(cleanBlocks(row.blocks, ctx.company.id));
  await changed(q("update public.site_pages set blocks = $3 where company_id = $1 and id = $2", [ctx.company.id, pageId, JSON.stringify(next)]));
}

export async function addBlock(slug: string, pageId: string, form: FormData): Promise<never> {
  const type = text(form, "type") as BlockType;
  const block = BLOCK_TYPES.includes(type) ? newBlock(type) : null;
  return act(
    slug,
    editor(pageId),
    `${block ? BLOCK_INFO[block.type].label : "Block"} added at the end of the page.`,
    (q, ctx) =>
      editBlocks(q, ctx, pageId, (blocks) => {
        if (!block) throw new UserError("Please choose a kind of block.");
        if (blocks.length >= MAX_BLOCKS) throw new UserError(`A page can have up to ${MAX_BLOCKS} blocks.`);
        return [...blocks, block];
      }),
    { then: () => editor(pageId, `?open=${block?.id ?? ""}#block-${block?.id ?? ""}`) },
  );
}

export async function saveBlock(slug: string, pageId: string, blockId: string, form: FormData): Promise<never> {
  return act(
    slug,
    editor(pageId),
    "Block saved. Publish the page when you are ready.",
    (q, ctx) =>
      editBlocks(q, ctx, pageId, (blocks) => {
        if (!blocks.some((b) => b.id === blockId)) throw new UserError("That block no longer exists.");
        return blocks.map((b) => (b.id === blockId ? blockFromForm(b, form, ctx.company.id) : b));
      }),
    { then: () => editor(pageId, `?open=${blockId}#block-${blockId}`) },
  );
}

export async function moveBlockAction(slug: string, pageId: string, blockId: string, direction: "up" | "down"): Promise<never> {
  return act(
    slug,
    editor(pageId),
    direction === "up" ? "Block moved up." : "Block moved down.",
    (q, ctx) => editBlocks(q, ctx, pageId, (blocks) => moveBlock(blocks, blockId, direction)),
    { then: () => editor(pageId, `#block-${blockId}`) },
  );
}

export async function removeBlock(slug: string, pageId: string, blockId: string): Promise<never> {
  return act(slug, editor(pageId), "Block removed from the draft.", (q, ctx) =>
    editBlocks(q, ctx, pageId, (blocks) => blocks.filter((b) => b.id !== blockId)),
  );
}

// --- Pictures -----------------------------------------------------------------

export async function uploadSiteImage(slug: string, back: string, form: FormData): Promise<never> {
  const path = back.startsWith("/website") ? back : "/website";
  return act(slug, path, "Picture uploaded. Choose it in a block.", async (q, ctx) => {
    await saveImage(q, ctx, form.get("file"), "image");
  });
}

export async function archiveSiteImage(slug: string, back: string, form: FormData): Promise<never> {
  const path = back.startsWith("/website") ? back : "/website";
  return act(slug, path, "Picture removed from your library.", (q, ctx) =>
    changed(
      q("update public.site_assets set archived_at = now() where company_id = $1 and id = $2 and kind = 'image' and archived_at is null", [
        ctx.company.id,
        text(form, "id"),
      ]),
    ),
  );
}
