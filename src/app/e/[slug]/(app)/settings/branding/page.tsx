import { Button, Card, Field, Notice, PageHeader, SelectField } from "@/components/ui";
import { requirePermission } from "@/server/company";
import { saveBranding } from "../../../actions";

// P20 (first part): colours, fonts, corners and light/dark. The same brand
// kit will style the website, store, documents and staff apps.

export default async function BrandingPage({ params, searchParams }: PageProps<"/e/[slug]/settings/branding">) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requirePermission(slug, "admin.branding.edit");
  const b = ctx.branding;

  return (
    <>
      <PageHeader title="Brand kit" description="Your colours and style, used across your ERP, website, store and documents." />
      <Notice error={sp.error} success={sp.success} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <form action={saveBranding.bind(null, slug)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Main colour" name="primary_color" type="color" defaultValue={b.primaryColor} className="h-10 w-full cursor-pointer rounded border border-zinc-300" />
              <Field label="Second colour" name="secondary_color" type="color" defaultValue={b.secondaryColor} className="h-10 w-full cursor-pointer rounded border border-zinc-300" />
              <Field label="Highlight colour" name="accent_color" type="color" defaultValue={b.accentColor} className="h-10 w-full cursor-pointer rounded border border-zinc-300" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="Fonts"
                name="font_pair"
                defaultValue={b.fontPair}
                options={[
                  { value: "modern", label: "Modern" },
                  { value: "classic", label: "Classic" },
                  { value: "friendly", label: "Friendly" },
                  { value: "technical", label: "Technical" },
                ]}
              />
              <SelectField
                label="Corners"
                name="corner_style"
                defaultValue={b.cornerStyle}
                options={[
                  { value: "square", label: "Square" },
                  { value: "rounded", label: "Rounded" },
                  { value: "pill", label: "Extra round" },
                ]}
              />
              <SelectField
                label="Light or dark"
                name="theme_mode"
                defaultValue={b.themeMode}
                options={[
                  { value: "system", label: "Follow the device" },
                  { value: "light", label: "Always light" },
                  { value: "dark", label: "Always dark" },
                ]}
              />
            </div>
            <Button type="submit">Save brand kit</Button>
          </form>
        </Card>
        <Card title="Preview">
          <div className="space-y-3">
            <div className="flex gap-2">
              {[b.primaryColor, b.secondaryColor, b.accentColor].map((c) => (
                <span key={c} className="size-10 rounded-[var(--radius)] border border-zinc-200" style={{ background: c }} />
              ))}
            </div>
            <p className="text-lg font-semibold">{ctx.company.name}</p>
            <Button type="button">A button</Button>
            <p className="text-xs text-zinc-500">Save to see your changes across the ERP.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
