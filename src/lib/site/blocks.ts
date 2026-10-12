// Website page blocks (P9, master plan §12.7). A page is an ordered list of
// blocks stored as JSON; the same definitions drive the ERP editor forms and
// the public renderer. Everything read from a form or the database passes
// through these functions, so the renderer only ever sees clean blocks.

export const BLOCK_TYPES = [
  "hero",
  "text",
  "featured_products",
  "products",
  "image_text",
  "contact",
  "cta",
  "testimonials",
  "gallery",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const REVEALS = ["fade-up", "fade", "zoom", "none"] as const;
export type Reveal = (typeof REVEALS)[number];

interface Base<T extends BlockType> {
  id: string;
  type: T;
  /** Entrance animation (used when the brand kit's motion is not off). */
  reveal: Reveal;
}

export interface HeroBlock extends Base<"hero"> {
  eyebrow: string;
  heading: string;
  text: string;
  button_label: string;
  button_link: string;
  secondary_label: string;
  secondary_link: string;
  image: string | null;
}
export interface TextBlock extends Base<"text"> {
  heading: string;
  body: string;
  align: "left" | "center";
}
export interface FeaturedProductsBlock extends Base<"featured_products"> {
  heading: string;
  text: string;
  count: number;
  product_ids: string[];
}
export interface ProductsBlock extends Base<"products"> {
  heading: string;
  text: string;
  count: number;
  show_search: boolean;
}
export interface ImageTextBlock extends Base<"image_text"> {
  heading: string;
  body: string;
  image: string | null;
  image_side: "left" | "right";
  button_label: string;
  button_link: string;
}
export interface ContactBlock extends Base<"contact"> {
  heading: string;
  text: string;
  show_form: boolean;
  show_details: boolean;
}
export interface CtaBlock extends Base<"cta"> {
  heading: string;
  text: string;
  button_label: string;
  button_link: string;
}
export interface Testimonial {
  quote: string;
  name: string;
  role: string;
}
export interface TestimonialsBlock extends Base<"testimonials"> {
  heading: string;
  items: Testimonial[];
}
export interface GalleryBlock extends Base<"gallery"> {
  heading: string;
  images: string[];
}

export type Block =
  | HeroBlock
  | TextBlock
  | FeaturedProductsBlock
  | ProductsBlock
  | ImageTextBlock
  | ContactBlock
  | CtaBlock
  | TestimonialsBlock
  | GalleryBlock;

export const BLOCK_INFO: Record<BlockType, { label: string; description: string }> = {
  hero: { label: "Hero banner", description: "A big heading at the top of a page, with buttons and an optional picture." },
  text: { label: "Text", description: "A heading and paragraphs." },
  featured_products: { label: "Featured products", description: "A few products you choose, with prices." },
  products: { label: "Shop grid", description: "Your products online, with a link to the full shop." },
  image_text: { label: "Picture and text", description: "A picture beside a heading and text." },
  contact: { label: "Contact details and form", description: "Your phone, WhatsApp, email, address and an enquiry form." },
  cta: { label: "Call to action", description: "A coloured panel with one button." },
  testimonials: { label: "Testimonials", description: "What your customers say about you." },
  gallery: { label: "Picture gallery", description: "A grid of your pictures." },
};

export const MAX_BLOCKS = 40;
export const MAX_TESTIMONIALS = 6;
export const MAX_GALLERY = 12;

const LIMITS = { heading: 160, eyebrow: 60, text: 1000, body: 5000, label: 40, link: 300, name: 80, quote: 600 };

export function newBlockId(): string {
  return "b" + Math.random().toString(36).slice(2, 12).padEnd(10, "0");
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true") return true;
  if (value === "false" || value === "off") return false;
  return fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

/** Internal paths (/shop), web addresses, email and phone links; anything else is dropped. */
export function safeLink(value: unknown): string {
  const link = str(value, LIMITS.link);
  if (!link) return "";
  if (/^\/(?!\/)[^\s\\]*$/.test(link)) return link;
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(link)) return link;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(link)) return link;
  if (/^tel:\+?[0-9 ()-]{3,20}$/i.test(link)) return link;
  if (/^#[a-z0-9-]*$/i.test(link)) return link;
  return "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A website image key of this company (see src/server/web/uploads.ts). */
export function safeImageKey(value: unknown, companyId?: string): string | null {
  const key = str(value, 200);
  const match = /^([0-9a-f-]{36})\/site\/[a-z0-9-]{1,80}\.(png|jpg|webp|svg)$/.exec(key);
  if (!match) return null;
  if (companyId && match[1] !== companyId.toLowerCase()) return null;
  return key;
}

function blockId(value: unknown): string {
  const id = str(value, 40);
  return /^[a-zA-Z0-9_-]{1,40}$/.test(id) ? id : newBlockId();
}

/** A block with sensible starting content. */
export function newBlock(type: BlockType, id = newBlockId()): Block {
  return cleanBlock({ id, type, reveal: "fade-up", ...STARTERS[type] })!;
}

const STARTERS: Record<BlockType, Record<string, unknown>> = {
  hero: {
    eyebrow: "Welcome",
    heading: "A heading that says what you do",
    text: "One or two sentences about why customers choose you.",
    button_label: "Browse the shop",
    button_link: "/shop",
  },
  text: { heading: "About us", body: "Tell visitors about your business.", align: "left" },
  featured_products: { heading: "Featured products", count: 4 },
  products: { heading: "Shop", count: 8, show_search: true },
  image_text: { heading: "Why choose us", body: "Explain what makes you different.", image_side: "right" },
  contact: { heading: "Get in touch", text: "Send us a message and we will reply as soon as we can.", show_form: true, show_details: true },
  cta: { heading: "Ready to order?", text: "Ask us for a quote today.", button_label: "Contact us", button_link: "/contact" },
  testimonials: { heading: "What our customers say", items: [] },
  gallery: { heading: "Gallery", images: [] },
};

/** Cleans one block from untrusted JSON. Returns null when it is not a block. */
export function cleanBlock(raw: unknown, companyId?: string): Block | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as BlockType;
  if (!BLOCK_TYPES.includes(type)) return null;
  const base = { id: blockId(r.id), reveal: oneOf(r.reveal, REVEALS, "fade-up") };
  const image = (v: unknown) => safeImageKey(v, companyId);
  switch (type) {
    case "hero":
      return {
        ...base, type,
        eyebrow: str(r.eyebrow, LIMITS.eyebrow),
        heading: str(r.heading, LIMITS.heading),
        text: str(r.text, LIMITS.text),
        button_label: str(r.button_label, LIMITS.label),
        button_link: safeLink(r.button_link),
        secondary_label: str(r.secondary_label, LIMITS.label),
        secondary_link: safeLink(r.secondary_link),
        image: image(r.image),
      };
    case "text":
      return { ...base, type, heading: str(r.heading, LIMITS.heading), body: str(r.body, LIMITS.body), align: oneOf(r.align, ["left", "center"] as const, "left") };
    case "featured_products":
      return {
        ...base, type,
        heading: str(r.heading, LIMITS.heading),
        text: str(r.text, LIMITS.text),
        count: int(r.count, 1, 12, 4),
        product_ids: (Array.isArray(r.product_ids) ? r.product_ids : []).filter((v): v is string => typeof v === "string" && UUID.test(v)).slice(0, 12),
      };
    case "products":
      return { ...base, type, heading: str(r.heading, LIMITS.heading), text: str(r.text, LIMITS.text), count: int(r.count, 1, 24, 8), show_search: bool(r.show_search, true) };
    case "image_text":
      return {
        ...base, type,
        heading: str(r.heading, LIMITS.heading),
        body: str(r.body, LIMITS.body),
        image: image(r.image),
        image_side: oneOf(r.image_side, ["left", "right"] as const, "right"),
        button_label: str(r.button_label, LIMITS.label),
        button_link: safeLink(r.button_link),
      };
    case "contact":
      return { ...base, type, heading: str(r.heading, LIMITS.heading), text: str(r.text, LIMITS.text), show_form: bool(r.show_form, true), show_details: bool(r.show_details, true) };
    case "cta":
      return { ...base, type, heading: str(r.heading, LIMITS.heading), text: str(r.text, LIMITS.text), button_label: str(r.button_label, LIMITS.label), button_link: safeLink(r.button_link) };
    case "testimonials":
      return {
        ...base, type,
        heading: str(r.heading, LIMITS.heading),
        items: (Array.isArray(r.items) ? r.items : [])
          .map((i) => {
            const t = (i ?? {}) as Record<string, unknown>;
            return { quote: str(t.quote, LIMITS.quote), name: str(t.name, LIMITS.name), role: str(t.role, LIMITS.name) };
          })
          .filter((t) => t.quote)
          .slice(0, MAX_TESTIMONIALS),
      };
    case "gallery":
      return {
        ...base, type,
        heading: str(r.heading, LIMITS.heading),
        images: (Array.isArray(r.images) ? r.images : []).map(image).filter((k): k is string => !!k).slice(0, MAX_GALLERY),
      };
  }
}

/** Cleans a whole page of blocks (drops anything unrecognised, keeps ids unique). */
export function cleanBlocks(raw: unknown, companyId?: string): Block[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS)) {
    const block = cleanBlock(item, companyId);
    if (!block) continue;
    if (seen.has(block.id)) block.id = newBlockId();
    seen.add(block.id);
    out.push(block);
  }
  return out;
}

/**
 * Reads a block's fields from an editor form. Field names match the block's
 * properties; testimonials use quote_0, name_0, role_0 ...; gallery images and
 * featured products use repeated "images" / "product_ids" fields.
 */
export function blockFromForm(existing: Block, form: FormData, companyId: string): Block {
  const raw: Record<string, unknown> = { id: existing.id, type: existing.type };
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !key.startsWith("$") && !(key in raw)) raw[key] = value;
  }
  raw.reveal = form.get("reveal") ?? existing.reveal;
  if (existing.type === "contact" || existing.type === "products") {
    for (const flag of ["show_form", "show_details", "show_search"]) raw[flag] = form.get(flag) === "on";
  }
  if (existing.type === "testimonials") {
    raw.items = Array.from({ length: MAX_TESTIMONIALS }, (_, i) => ({
      quote: form.get(`quote_${i}`),
      name: form.get(`name_${i}`),
      role: form.get(`role_${i}`),
    }));
  }
  if (existing.type === "gallery") raw.images = form.getAll("images");
  if (existing.type === "featured_products") raw.product_ids = form.getAll("product_ids");
  if ((existing.type === "hero" || existing.type === "image_text") && form.get("image") === "") raw.image = null;
  return cleanBlock(raw, companyId) ?? existing;
}

/** Moves the block with `id` one place up or down. */
export function moveBlock(blocks: Block[], id: string, direction: "up" | "down"): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Page addresses: lower-case letters, numbers and hyphens, from a title if need be. */
export function pageSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const RESERVED_PAGE_SLUGS = new Set(["shop", "quote", "account", "api", "site-preview", "preview", "sitemap", "robots"]);
