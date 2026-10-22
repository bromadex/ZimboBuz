"use server";

import { act, changed, text, UserError } from "@/server/act";
import { saveImage } from "@/server/web/uploads";

// Brand kit additions (P20): the logo, and how much the website moves.

const BACK = "/settings/branding";

export async function uploadLogo(slug: string, form: FormData): Promise<never> {
  return act(slug, BACK, "Logo saved. It now shows in your ERP and on your website.", async (q, ctx) => {
    const key = await saveImage(q, ctx, form.get("logo"), "logo");
    await changed(q("update public.company_branding set logo_path = $2 where company_id = $1", [ctx.company.id, key]));
  });
}

export async function removeLogo(slug: string): Promise<never> {
  return act(slug, BACK, "Logo removed. Your initials are shown instead.", async (q, ctx) => {
    await q(
      `update public.site_assets set archived_at = now()
       where company_id = $1 and kind = 'logo' and archived_at is null
         and storage_key = (select logo_path from public.company_branding where company_id = $1)`,
      [ctx.company.id],
    );
    await changed(q("update public.company_branding set logo_path = null where company_id = $1", [ctx.company.id]));
  });
}

export async function saveMotion(slug: string, form: FormData): Promise<never> {
  const level = text(form, "motion_level");
  return act(slug, BACK, "Animation setting saved.", async (q, ctx) => {
    if (!["off", "subtle", "rich"].includes(level)) throw new UserError("Please choose how much your website moves.");
    await changed(q("update public.company_branding set motion_level = $2 where company_id = $1", [ctx.company.id, level]));
  });
}

// "Website by ZimERP" in the website footer (Growth plan and higher may hide it).
export async function setPlatformBadge(slug: string, form: FormData): Promise<never> {
  const show = text(form, "show") === "true";
  return act(slug, BACK, show ? "“Website by ZimERP” is shown on your website." : "“Website by ZimERP” is hidden on your website.", async (q, ctx) => {
    const updated = await q("update public.site_settings set show_platform_badge = $2 where company_id = $1", [ctx.company.id, show]);
    if (!updated.rowCount) throw new UserError("Open the Website screen once to set up your website first.");
  });
}
