import { Field, SelectField, TextArea } from "@/components/ui";
import {
  MAX_EVENTS,
  MAX_FAQ,
  MAX_GALLERY,
  MAX_GIVING_WAYS,
  MAX_PRICE_GROUPS,
  MAX_PRICE_ITEMS,
  MAX_STATS,
  MAX_TEAM,
  MAX_TESTIMONIALS,
  type Block,
} from "@/lib/site/blocks";
import { assetUrl } from "@/lib/site/theme";

// Editor form fields for each kind of block (P9). Field names match the
// block properties read by blockFromForm (src/lib/site/blocks.ts).

export interface Picture {
  key: string;
  name: string | null;
}

export interface OnlineProduct {
  id: string;
  name: string;
}

const REVEAL_OPTIONS = [
  { value: "fade-up", label: "Rise into view" },
  { value: "fade", label: "Fade in" },
  { value: "zoom", label: "Zoom in" },
  { value: "none", label: "No animation" },
];

function PicturePicker({ name, value, pictures, label }: { name: string; value: string | null; pictures: Picture[]; label: string }) {
  return (
    <SelectField
      label={label}
      name={name}
      defaultValue={value ?? ""}
      hint={pictures.length ? undefined : "Upload pictures in “Your pictures” below first."}
      options={[{ value: "", label: "No picture" }, ...pictures.map((p, i) => ({ value: p.key, label: p.name ?? `Picture ${i + 1}` }))]}
    />
  );
}

function LinkFields({ prefix = "button", label, link }: { prefix?: "button" | "secondary"; label: string; link: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={prefix === "button" ? "Button text" : "Second button text"} name={`${prefix}_label`} defaultValue={label} maxLength={40} />
      <Field label="Button goes to" name={`${prefix}_link`} defaultValue={link} placeholder="/shop or https://…" hint="A page such as /contact, or a full web address." />
    </div>
  );
}

export function BlockFields({ block, pictures, products }: { block: Block; pictures: Picture[]; products: OnlineProduct[] }) {
  const reveal = <SelectField label="Entrance animation" name="reveal" defaultValue={block.reveal} options={REVEAL_OPTIONS} hint="Used when animation is switched on in your brand kit." />;
  switch (block.type) {
    case "hero":
      return (
        <div className="space-y-4">
          <Field label="Small heading above" name="eyebrow" defaultValue={block.eyebrow} maxLength={60} />
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="text" defaultValue={block.text} maxLength={1000} />
          <LinkFields label={block.button_label} link={block.button_link} />
          <LinkFields prefix="secondary" label={block.secondary_label} link={block.secondary_link} />
          <div className="grid gap-4 sm:grid-cols-2">
            <PicturePicker name="image" label="Picture" value={block.image} pictures={pictures} />
            {reveal}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="body" defaultValue={block.body} maxLength={5000} rows={6} hint="Leave an empty line between paragraphs." />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Alignment" name="align" defaultValue={block.align} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} />
            {reveal}
          </div>
        </div>
      );
    case "featured_products":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <Field label="Text" name="text" defaultValue={block.text} maxLength={1000} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many to show" name="count" type="number" min={1} max={12} defaultValue={block.count} />
            {reveal}
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Products to feature</legend>
            <p className="mb-2 text-xs text-zinc-500">Tick up to 12. Leave all unticked to show the first products in your shop.</p>
            {products.length ? (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-[var(--radius)] border border-zinc-200 p-2 sm:grid-cols-2 dark:border-zinc-800">
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="product_ids" value={p.id} defaultChecked={block.product_ids.includes(p.id)} />
                    <span className="truncate">{p.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No products are shown online yet.</p>
            )}
          </fieldset>
        </div>
      );
    case "products":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <Field label="Text" name="text" defaultValue={block.text} maxLength={1000} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How many to show" name="count" type="number" min={1} max={24} defaultValue={block.count} />
            {reveal}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="show_search" defaultChecked={block.show_search} /> Show a search box
          </label>
        </div>
      );
    case "image_text":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="body" defaultValue={block.body} maxLength={5000} rows={5} />
          <div className="grid gap-4 sm:grid-cols-2">
            <PicturePicker name="image" label="Picture" value={block.image} pictures={pictures} />
            <SelectField label="Picture on the" name="image_side" defaultValue={block.image_side} options={[{ value: "right", label: "Right" }, { value: "left", label: "Left" }]} />
          </div>
          <LinkFields label={block.button_label} link={block.button_link} />
          {reveal}
        </div>
      );
    case "contact":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <Field label="Text" name="text" defaultValue={block.text} maxLength={1000} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="show_details" defaultChecked={block.show_details} /> Show phone, WhatsApp, email, address and hours
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="show_form" defaultChecked={block.show_form} /> Show the enquiry form
            </label>
          </div>
          <p className="text-xs text-zinc-500">Contact details come from “Site details” on the website screen. Messages arrive under Enquiries.</p>
          {reveal}
        </div>
      );
    case "cta":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <Field label="Text" name="text" defaultValue={block.text} maxLength={1000} />
          <LinkFields label={block.button_label} link={block.button_link} />
          {reveal}
        </div>
      );
    case "testimonials":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <p className="text-xs text-zinc-500">Only use real words from your customers, with their permission. Empty rows are left out.</p>
          {Array.from({ length: Math.min(MAX_TESTIMONIALS, block.items.length + 1) }, (_, i) => block.items[i] ?? { quote: "", name: "", role: "" }).map((t, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
              <div className="sm:col-span-2">
                <TextArea label={`What they said (${i + 1})`} name={`quote_${i}`} defaultValue={t.quote} maxLength={600} rows={2} />
              </div>
              <Field label="Name" name={`name_${i}`} defaultValue={t.name} maxLength={80} />
              <Field label="Business or town" name={`role_${i}`} defaultValue={t.role} maxLength={80} />
            </div>
          ))}
          {reveal}
        </div>
      );
    case "gallery":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Pictures (up to {MAX_GALLERY})</legend>
            {pictures.length ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {pictures.map((p) => (
                  <label key={p.key} className="relative block cursor-pointer">
                    <input type="checkbox" name="images" value={p.key} defaultChecked={block.images.includes(p.key)} className="peer absolute left-1.5 top-1.5 z-10" />
                    {/* eslint-disable-next-line @next/next/no-img-element -- uploaded pictures */}
                    <img src={assetUrl(p.key) ?? ""} alt={p.name ?? ""} className="aspect-square w-full rounded-[var(--radius)] object-cover opacity-70 ring-2 ring-transparent peer-checked:opacity-100 peer-checked:ring-[var(--brand)]" />
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Upload pictures in “Your pictures” below first.</p>
            )}
          </fieldset>
          {reveal}
        </div>
      );
    case "price_list": {
      // Existing groups plus one empty group; each group shows its items plus one empty row.
      // While there is room, the first groups each get one empty row.
      const room = MAX_PRICE_ITEMS - block.groups.reduce((n, g) => n + g.items.length, 0);
      const groups = rowsWithSpare(block.groups, MAX_PRICE_GROUPS, { title: "", items: [] });
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="text" defaultValue={block.text} maxLength={1000} rows={2} hint="For example: prices in US dollars; we also accept ZWG and EcoCash." />
          <p className="text-xs text-zinc-500">
            Up to {MAX_PRICE_GROUPS} groups and {MAX_PRICE_ITEMS} items in all. Save to get another empty row. Rows without a name are left out.
          </p>
          {groups.map((g, gi) => {
            const spare = gi < room ? 1 : 0;
            const items = [...g.items, ...Array.from({ length: spare }, () => ({ name: "", description: "", price: "" }))];
            return (
              <fieldset key={gi} className="space-y-3 rounded-[var(--radius)] border border-zinc-200 p-3 dark:border-zinc-800">
                <Field label={`Group ${gi + 1} title`} name={`group_title_${gi}`} defaultValue={g.title} maxLength={80} placeholder="Mains, Drinks, Hair, Every term…" hint="Optional." />
                {items.map((item, i) => (
                  <div key={i} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_8rem]">
                    <Field label="Item" name={`item_name_${gi}_${i}`} defaultValue={item.name} maxLength={80} />
                    <Field label="Description" name={`item_description_${gi}_${i}`} defaultValue={item.description} maxLength={300} />
                    <Field label="Price" name={`item_price_${gi}_${i}`} defaultValue={item.price} maxLength={40} placeholder="US$5.00" />
                  </div>
                ))}
              </fieldset>
            );
          })}
          {reveal}
        </div>
      );
    }
    case "events":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="text" defaultValue={block.text} maxLength={1000} rows={2} />
          <p className="text-xs text-zinc-500">Up to {MAX_EVENTS}. Rows without a title are left out.</p>
          {rowsWithSpare(block.items, MAX_EVENTS, { title: "", when: "", place: "", description: "" }).map((e, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
              <Field label={`Title (${i + 1})`} name={`event_title_${i}`} defaultValue={e.title} maxLength={80} placeholder="Sunday service" />
              <Field label="When" name={`event_when_${i}`} defaultValue={e.when} maxLength={120} placeholder="Sundays, 9:00 to 11:30" />
              <Field label="Where" name={`event_place_${i}`} defaultValue={e.place} maxLength={80} />
              <Field label="Description" name={`event_description_${i}`} defaultValue={e.description} maxLength={300} />
            </div>
          ))}
          {reveal}
        </div>
      );
    case "team":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="text" defaultValue={block.text} maxLength={1000} rows={2} />
          <p className="text-xs text-zinc-500">Up to {MAX_TEAM} people. Only show people who have agreed. Rows without a name are left out.</p>
          {rowsWithSpare(block.people, MAX_TEAM, { name: "", role: "", bio: "", image: null }).map((p, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 sm:grid-cols-2 dark:border-zinc-800">
              <Field label={`Name (${i + 1})`} name={`person_name_${i}`} defaultValue={p.name} maxLength={80} />
              <Field label="Role" name={`person_role_${i}`} defaultValue={p.role} maxLength={80} placeholder="Head teacher, Senior pastor, Partner…" />
              <div className="sm:col-span-2">
                <TextArea label="About them" name={`person_bio_${i}`} defaultValue={p.bio} maxLength={600} rows={2} />
              </div>
              <PicturePicker name={`person_image_${i}`} label="Photo" value={p.image} pictures={pictures} />
            </div>
          ))}
          {reveal}
        </div>
      );
    case "faq":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <p className="text-xs text-zinc-500">Up to {MAX_FAQ}. Questions without an answer are left out.</p>
          {rowsWithSpare(block.items, MAX_FAQ, { question: "", answer: "" }).map((f, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 dark:border-zinc-800">
              <Field label={`Question (${i + 1})`} name={`faq_question_${i}`} defaultValue={f.question} maxLength={300} />
              <TextArea label="Answer" name={`faq_answer_${i}`} defaultValue={f.answer} maxLength={2000} rows={3} />
            </div>
          ))}
          {reveal}
        </div>
      );
    case "stats":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} hint="Optional." />
          <p className="text-xs text-zinc-500">Up to {MAX_STATS} numbers. Use real, up-to-date figures.</p>
          {rowsWithSpare(block.items, MAX_STATS, { value: "", label: "" }).map((st, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 sm:grid-cols-[10rem_1fr] dark:border-zinc-800">
              <Field label={`Number (${i + 1})`} name={`stat_value_${i}`} defaultValue={st.value} maxLength={20} placeholder="12,000+" />
              <Field label="What it counts" name={`stat_label_${i}`} defaultValue={st.label} maxLength={80} placeholder="people reached" />
            </div>
          ))}
          {reveal}
        </div>
      );
    case "donate":
      return (
        <div className="space-y-4">
          <Field label="Heading" name="heading" defaultValue={block.heading} maxLength={160} />
          <TextArea label="Text" name="text" defaultValue={block.text} maxLength={1000} rows={2} />
          <p className="text-xs text-zinc-500">Ways to give, up to {MAX_GIVING_WAYS}: for example your EcoCash merchant code or bank details. Check them carefully.</p>
          {rowsWithSpare(block.ways, MAX_GIVING_WAYS, { title: "", detail: "" }).map((w, i) => (
            <div key={i} className="grid gap-3 rounded-[var(--radius)] border border-zinc-200 p-3 sm:grid-cols-[12rem_1fr] dark:border-zinc-800">
              <Field label={`Way to give (${i + 1})`} name={`way_title_${i}`} defaultValue={w.title} maxLength={80} placeholder="EcoCash" />
              <TextArea label="Details" name={`way_detail_${i}`} defaultValue={w.detail} maxLength={300} rows={2} placeholder="Merchant code 123456, reference: your name" />
            </div>
          ))}
          <LinkFields label={block.button_label} link={block.button_link} />
          {reveal}
        </div>
      );
  }
}

/** The existing rows plus one empty row to fill in, up to `max`. */
function rowsWithSpare<T>(rows: T[], max: number, empty: T): T[] {
  return rows.length < max ? [...rows, empty] : rows.slice(0, max);
}

export function blockSummary(block: Block): string {
  if ("heading" in block && block.heading) return block.heading;
  return "";
}
