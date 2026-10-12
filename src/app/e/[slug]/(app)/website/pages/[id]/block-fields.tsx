import { Field, SelectField, TextArea } from "@/components/ui";
import { MAX_GALLERY, MAX_TESTIMONIALS, type Block } from "@/lib/site/blocks";
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
  }
}

export function blockSummary(block: Block): string {
  if ("heading" in block && block.heading) return block.heading;
  return "";
}
