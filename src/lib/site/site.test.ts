import { describe, expect, it } from "vitest";
import { checkImage, isSafeSvg, sniffImageType } from "../files";
import {
  BLOCK_INFO,
  blockFromForm,
  cleanBlock,
  cleanBlocks,
  MAX_EVENTS,
  MAX_FAQ,
  MAX_PRICE_GROUPS,
  MAX_PRICE_ITEMS,
  MAX_STATS,
  moveBlock,
  newBlock,
  pageSlug,
  safeImageKey,
  safeLink,
  type Block,
} from "./blocks";
import { assetUrl, cleanSocialLinks, contrast, isTemplate, readableOn, siteStyle, TEMPLATE_CODES, TEMPLATES, whatsAppLink } from "./theme";

const company = "8f1d2c3b-4a5e-4f60-9a7b-1c2d3e4f5a6b";
const other = "11111111-2222-4333-8444-555555555555";
const enc = (s: string) => new TextEncoder().encode(s);

describe("blocks", () => {
  it("cleans untrusted blocks and drops unknown ones", () => {
    const blocks = cleanBlocks([
      { id: "a", type: "hero", heading: "  Hi  ", button_link: "javascript:alert(1)", image: `${company}/site/x.png`, extra: "dropped" },
      { id: "b", type: "script" },
      "nonsense",
      { id: "a", type: "text", body: "x".repeat(6000), align: "sideways" },
    ], company);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ id: "a", type: "hero", heading: "Hi", button_link: "", image: `${company}/site/x.png`, reveal: "fade-up" });
    expect(blocks[0]).not.toHaveProperty("extra");
    expect(blocks[1].id).not.toBe("a");
    expect(blocks[1]).toMatchObject({ type: "text", align: "left" });
    expect((blocks[1] as Extract<Block, { type: "text" }>).body).toHaveLength(5000);
  });

  it("only accepts this company's website pictures", () => {
    expect(safeImageKey(`${company}/site/abc-1.png`, company)).toBe(`${company}/site/abc-1.png`);
    expect(safeImageKey(`${other}/site/abc.png`, company)).toBeNull();
    expect(safeImageKey(`${company}/site/../x.png`, company)).toBeNull();
    expect(safeImageKey(`${company}/branding/logo.png`, company)).toBeNull();
    const g = cleanBlock({ id: "g", type: "gallery", images: [`${company}/site/a.png`, `${other}/site/b.png`, 5] }, company);
    expect(g).toMatchObject({ images: [`${company}/site/a.png`] });
  });

  it("accepts only safe links", () => {
    expect(safeLink("/shop")).toBe("/shop");
    expect(safeLink("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLink("mailto:sales@mhofu.co.zw")).toBe("mailto:sales@mhofu.co.zw");
    expect(safeLink("tel:+263 77 123 4567")).toBe("tel:+263 77 123 4567");
    expect(safeLink("//evil.example")).toBe("");
    expect(safeLink("javascript:alert(1)")).toBe("");
    expect(safeLink("data:text/html,x")).toBe("");
  });

  it("reads editor forms, including testimonials, gallery and switches", () => {
    const t = newBlock("testimonials", "t1");
    const form = new FormData();
    form.set("heading", "Kind words");
    form.set("quote_0", "Great service");
    form.set("name_0", "Rudo");
    form.set("quote_1", "");
    form.set("reveal", "zoom");
    form.set("$ACTION_ID_x", "ignored");
    expect(blockFromForm(t, form, company)).toEqual({
      id: "t1", type: "testimonials", reveal: "zoom", heading: "Kind words", items: [{ quote: "Great service", name: "Rudo", role: "" }],
    });

    const c = newBlock("contact", "c1");
    const off = new FormData();
    off.set("heading", "Talk to us");
    off.set("show_details", "on");
    expect(blockFromForm(c, off, company)).toMatchObject({ show_form: false, show_details: true, heading: "Talk to us" });

    const g = newBlock("gallery", "g1");
    const pics = new FormData();
    pics.append("images", `${company}/site/a.png`);
    pics.append("images", `${company}/site/b.webp`);
    expect(blockFromForm(g, pics, company)).toMatchObject({ images: [`${company}/site/a.png`, `${company}/site/b.webp`] });
  });

  it("cleans the new kinds of block with their limits", () => {
    const price = cleanBlock({
      id: "p", type: "price_list", heading: "Menu",
      groups: [
        { title: "Mains", items: [{ name: "Sadza and beef", price: "US$5.00", description: "x".repeat(400) }, { name: "", price: "US$1" }] },
        { title: "", items: [] },
        ...Array.from({ length: 9 }, (_, g) => ({ title: `G${g}`, items: Array.from({ length: 10 }, (_, i) => ({ name: `Item ${i}`, price: "1" })) })),
      ],
    }) as Extract<Block, { type: "price_list" }>;
    expect(price.groups[0].items).toEqual([{ name: "Sadza and beef", description: "x".repeat(300), price: "US$5.00" }]);
    expect(price.groups).toHaveLength(MAX_PRICE_GROUPS);
    expect(price.groups.reduce((n, g) => n + g.items.length, 0)).toBe(MAX_PRICE_ITEMS);

    const events = cleanBlock({ id: "e", type: "events", items: Array.from({ length: 20 }, (_, i) => ({ title: `Event ${i}`, when: "Sundays" })) });
    expect((events as Extract<Block, { type: "events" }>).items).toHaveLength(MAX_EVENTS);

    const team = cleanBlock({ id: "t", type: "team", people: [{ name: "Rudo", role: "Head", image: `${other}/site/a.png` }, { role: "No name" }] }, company);
    expect(team).toMatchObject({ people: [{ name: "Rudo", role: "Head", bio: "", image: null }] });

    const faq = cleanBlock({ id: "f", type: "faq", items: [{ question: "Q?", answer: "A." }, { question: "No answer" }, ...Array.from({ length: 30 }, () => ({ question: "q", answer: "a" }))] });
    expect((faq as Extract<Block, { type: "faq" }>).items).toHaveLength(MAX_FAQ);
    expect((faq as Extract<Block, { type: "faq" }>).items[0]).toEqual({ question: "Q?", answer: "A." });

    const stats = cleanBlock({ id: "s", type: "stats", items: Array.from({ length: 9 }, (_, i) => ({ value: `${i}`, label: "things" })) });
    expect((stats as Extract<Block, { type: "stats" }>).items).toHaveLength(MAX_STATS);

    const donate = cleanBlock({ id: "d", type: "donate", ways: [{ title: "EcoCash", detail: "Merchant code 12345" }, {}], button_link: "javascript:x" });
    expect(donate).toMatchObject({ ways: [{ title: "EcoCash", detail: "Merchant code 12345" }], button_link: "" });

    for (const type of ["price_list", "events", "team", "faq", "stats", "donate"] as const) {
      expect(newBlock(type, "x").type).toBe(type);
      expect(BLOCK_INFO[type].label).toBeTruthy();
    }
  });

  it("reads the new blocks' repeating fields from editor forms", () => {
    const form = new FormData();
    form.set("heading", "Price list");
    form.set("group_title_0", "Hair");
    form.set("item_name_0_0", "Haircut");
    form.set("item_price_0_0", "US$3");
    form.set("item_name_0_1", "");
    form.set("group_title_1", "");
    form.set("item_name_1_0", "Manicure");
    form.set("item_description_1_0", "Hands");
    form.set("item_price_1_0", "US$8");
    expect(blockFromForm(newBlock("price_list", "p1"), form, company)).toMatchObject({
      heading: "Price list",
      groups: [
        { title: "Hair", items: [{ name: "Haircut", description: "", price: "US$3" }] },
        { title: "", items: [{ name: "Manicure", description: "Hands", price: "US$8" }] },
      ],
    });

    const ev = new FormData();
    ev.set("event_title_0", "Sunday service");
    ev.set("event_when_0", "Sundays, 9:00");
    ev.set("event_place_0", "Main hall");
    ev.set("event_title_1", "");
    expect(blockFromForm(newBlock("events", "e1"), ev, company)).toMatchObject({
      items: [{ title: "Sunday service", when: "Sundays, 9:00", place: "Main hall", description: "" }],
    });

    const team = new FormData();
    team.set("person_name_0", "Tendai Moyo");
    team.set("person_role_0", "Head teacher");
    team.set("person_image_0", `${company}/site/tendai.jpg`);
    team.set("person_name_1", "Chipo");
    team.set("person_image_1", "");
    expect(blockFromForm(newBlock("team", "t1"), team, company)).toMatchObject({
      people: [
        { name: "Tendai Moyo", role: "Head teacher", image: `${company}/site/tendai.jpg` },
        { name: "Chipo", image: null },
      ],
    });

    const faq = new FormData();
    faq.set("faq_question_0", "Do you take ZWG?");
    faq.set("faq_answer_0", "Yes.");
    expect(blockFromForm(newBlock("faq", "f1"), faq, company)).toMatchObject({ items: [{ question: "Do you take ZWG?", answer: "Yes." }] });

    const stats = new FormData();
    stats.set("stat_value_0", "1,200");
    stats.set("stat_label_0", "learners");
    expect(blockFromForm(newBlock("stats", "s1"), stats, company)).toMatchObject({ items: [{ value: "1,200", label: "learners" }] });

    const give = new FormData();
    give.set("way_title_0", "EcoCash");
    give.set("way_detail_0", "Merchant code 12345");
    give.set("button_label", "Give");
    give.set("button_link", "/give");
    expect(blockFromForm(newBlock("donate", "d1"), give, company)).toMatchObject({
      ways: [{ title: "EcoCash", detail: "Merchant code 12345" }], button_label: "Give", button_link: "/give",
    });
  });

  it("moves blocks and makes page addresses", () => {
    const blocks = [newBlock("hero", "a"), newBlock("text", "b"), newBlock("cta", "c")];
    expect(moveBlock(blocks, "b", "up").map((b) => b.id)).toEqual(["b", "a", "c"]);
    expect(moveBlock(blocks, "c", "down").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(pageSlug("  About Us & Our Team! ")).toBe("about-us-and-our-team");
    expect(pageSlug("Café Ñoño")).toBe("cafe-nono");
  });
});

describe("theme", () => {
  it("lists every template once, with the industries each suits", () => {
    expect(TEMPLATES.map((t) => t.code)).toEqual([...TEMPLATE_CODES]);
    expect(TEMPLATE_CODES).toHaveLength(9);
    const industries = TEMPLATES.flatMap((t) => t.industries);
    expect(new Set(industries).size).toBe(industries.length);
    expect(TEMPLATES.find((t) => t.industries.includes("church"))?.code).toBe("ministry");
    expect(isTemplate("academy")).toBe(true);
    expect(isTemplate("fancy")).toBe(false);
  });

  it("picks readable text colours", () => {
    expect(readableOn("#0b6e4f")).toBe("#ffffff");
    expect(readableOn("#fde047")).toBe("#111827");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("builds CSS variables from the brand kit, ignoring bad colours", () => {
    const s = siteStyle({
      primaryColor: "#1D4ED8", secondaryColor: "red;}", accentColor: "#b42318", fontPair: "classic",
      themeMode: "system", motionLevel: "rich", cornerStyle: "pill", logoUrl: null,
    });
    expect(s["--brand"]).toBe("#1d4ed8");
    expect(s["--brand-2"]).toBe("#c98f00");
    expect(s["--radius-button"]).toBe("999px");
    expect(s["--font-heading"]).toContain("Georgia");
  });

  it("makes file, social and WhatsApp links", () => {
    expect(assetUrl(`${company}/site/a.png`)).toBe(`/api/files/${company}/site/a.png`);
    expect(assetUrl("../etc/passwd")).toBeNull();
    expect(cleanSocialLinks({ facebook: "facebook.com/mhofu", instagram: "https://evil.example/x", x: "http://twitter.com/mhofu" })).toEqual({
      facebook: "https://facebook.com/mhofu",
      x: "https://twitter.com/mhofu",
    });
    expect(whatsAppLink("077 123 4567")).toBe("https://wa.me/263771234567");
    expect(whatsAppLink("+27 82 123 4567")).toBe("https://wa.me/27821234567");
    expect(whatsAppLink("123")).toBeNull();
  });
});

describe("uploaded pictures", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const svg = enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>');

  it("recognises types by content, not name", () => {
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(svg)).toBe("image/svg+xml");
    expect(sniffImageType(enc("<html><body>hi</body></html>"))).toBeNull();
    expect(sniffImageType(enc("GIF89a"))).toBeNull();
  });

  it("refuses SVGs with scripts or links", () => {
    expect(isSafeSvg(svg)).toBe(true);
    expect(isSafeSvg(enc('<svg><script>alert(1)</script></svg>'))).toBe(false);
    expect(isSafeSvg(enc('<svg><rect onload="alert(1)"/></svg>'))).toBe(false);
    expect(isSafeSvg(enc('<svg><a href="javascript:alert(1)">x</a></svg>'))).toBe(false);
    expect(isSafeSvg(enc('<svg><image href="https://evil.example/x.png"/></svg>'))).toBe(false);
    expect(isSafeSvg(enc('<svg><foreignObject><div/></foreignObject></svg>'))).toBe(false);
  });

  it("limits size and explains problems in plain English", () => {
    expect(checkImage(png)).toEqual({ ok: true, contentType: "image/png", extension: "png" });
    expect(checkImage(new Uint8Array(0))).toMatchObject({ ok: false, error: "Please choose a picture to upload." });
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(png);
    expect(checkImage(big)).toMatchObject({ ok: false, error: expect.stringContaining("too big") });
    expect(checkImage(enc("hello"))).toMatchObject({ ok: false, error: expect.stringContaining("PNG, JPEG, WebP or SVG") });
  });
});
