import { Button, Card, SelectField } from "@/components/ui";
import type { Branding } from "@/server/company";
import { removeLogo, saveMotion, uploadLogo } from "./actions";

// Brand kit (P20): logo upload and website animation level.

export function LogoAndMotion({ slug, logoUrl, motionLevel }: { slug: string; logoUrl: string | null; motionLevel: Branding["motionLevel"] }) {
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card title="Logo">
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- the company's uploaded logo
              <img src={logoUrl} alt="Your logo" className="max-h-full max-w-full object-contain p-2" />
            ) : (
              <span className="text-xs text-zinc-500">No logo</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <form action={uploadLogo.bind(null, slug)} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{logoUrl ? "Replace your logo" : "Upload your logo"}</span>
                <input
                  type="file"
                  name="logo"
                  required
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="block w-full text-sm file:mr-3 file:rounded-[var(--radius)] file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:font-semibold dark:file:bg-zinc-800"
                />
                <span className="mt-1 block text-xs text-zinc-500">PNG, JPEG, WebP or SVG, up to 1 MB. A wide logo on a transparent background works best.</span>
              </label>
              <Button type="submit">Save logo</Button>
            </form>
            {logoUrl ? (
              <form action={removeLogo.bind(null, slug)}>
                <button type="submit" className="text-sm font-semibold text-red-700 underline dark:text-red-400">
                  Remove logo
                </button>
              </form>
            ) : null}
          </div>
        </div>
      </Card>
      <Card title="Website animation">
        <form action={saveMotion.bind(null, slug)} className="space-y-4">
          <SelectField
            label="How much your website moves"
            name="motion_level"
            defaultValue={motionLevel}
            options={[
              { value: "off", label: "Off: no animation" },
              { value: "subtle", label: "Subtle: gentle fades as visitors scroll" },
              { value: "rich", label: "Rich: moving backgrounds and lively reveals" },
            ]}
            hint="Visitors who ask their device for less motion always get none."
          />
          <Button type="submit" variant="secondary">
            Save animation
          </Button>
        </form>
      </Card>
    </div>
  );
}
