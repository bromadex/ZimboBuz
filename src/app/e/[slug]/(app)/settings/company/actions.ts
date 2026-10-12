"use server";

import { act, changed, text, UserError, uuid } from "@/server/act";

// Company details, VAT settings, the two-step requirement and branches.
// Plan, status, web address and base currency are not editable here (the
// database only lets companies change name and VAT columns).

const PATH = "/settings/company";

export async function saveCompanyName(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Company details saved.", async (q, ctx) => {
    const name = text(form, "name");
    if (!name) throw new UserError("Please enter the company name.");
    if (name.length > 120) throw new UserError("Please use a shorter name (up to 120 characters).");
    await changed(q("update public.companies set name = $2 where id = $1", [ctx.company.id, name]));
  });
}

export async function saveTax(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "VAT settings saved. New documents use them.", async (q, ctx) => {
    const registered = form.get("vat_registered") === "on";
    const number = text(form, "vat_number");
    if (number && !/^[A-Za-z0-9 -]{4,20}$/.test(number)) throw new UserError("Please check the VAT number (letters and numbers only).");
    await q("select public.set_company_tax($1, $2, $3, $4)", [ctx.company.id, registered, number || null, text(form, "prices_include_tax") === "yes"]);
  });
}

export async function saveTwoStepRequirement(slug: string, form: FormData): Promise<never> {
  const on = text(form, "require") === "true";
  return act(
    slug,
    PATH,
    on ? "Two-step sign-in is now required for everyone who manages the company." : "Two-step sign-in is now optional.",
    async (q, ctx) => {
      if (on && !ctx.twoStep.enabled) throw new UserError("Turn on two-step sign-in for yourself first (Sign-in security), so you are not locked out.");
      await q(
        `insert into public.company_preferences (company_id, require_two_step_admins) values ($1, $2)
         on conflict (company_id) do update set require_two_step_admins = excluded.require_two_step_admins`,
        [ctx.company.id, on],
      );
    },
  );
}

export async function addBranch(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Branch added, with its own main stock location.", async (q, ctx) => {
    const code = text(form, "code").toUpperCase();
    const name = text(form, "name");
    if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new UserError("Branch codes are 2 to 6 letters or numbers, like BYO.");
    if (!name) throw new UserError("Please enter the branch name.");
    await q("insert into public.branches (company_id, code, name) values ($1, $2, $3)", [ctx.company.id, code, name]);
  });
}

export async function renameBranch(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Branch renamed.", async (q, ctx) => {
    const name = text(form, "name");
    if (!name) throw new UserError("Please enter the branch name.");
    await changed(q("update public.branches set name = $3 where company_id = $1 and id = $2 and archived_at is null", [ctx.company.id, uuid(form, "id", "a branch"), name]));
  });
}

export async function archiveBranch(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Branch archived. Its records are kept.", async (q, ctx) => {
    await changed(
      q("update public.branches set archived_at = now() where company_id = $1 and id = $2 and archived_at is null and not is_head_office", [
        ctx.company.id,
        uuid(form, "id", "a branch"),
      ]),
    );
  });
}

export async function restoreBranch(slug: string, form: FormData): Promise<never> {
  return act(slug, PATH, "Branch restored.", async (q, ctx) => {
    await changed(q("update public.branches set archived_at = null where company_id = $1 and id = $2", [ctx.company.id, uuid(form, "id", "a branch")]));
  });
}
