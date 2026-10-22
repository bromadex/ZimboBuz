"use server";

import { act, changed, optional, text, UserError, uuid } from "@/server/act";

// P3/P17: custom roles and what each role may do. Every change goes through
// public.create_role / public.set_role_permission, which check
// admin.roles.manage, keep the owner role whole and write the audit log.

export async function createRole(slug: string, form: FormData): Promise<never> {
  return act(
    slug,
    "/settings/roles",
    "Role created. Adjust its permissions below.",
    async (q, ctx) => {
      const name = text(form, "name");
      if (!name) throw new UserError("Please give the role a name.");
      const copy = optional(form, "copy_from");
      return (await q<{ id: string }>("select public.create_role($1, $2, $3) as id", [ctx.company.id, name, copy])).rows[0].id;
    },
    { then: (id) => `/settings/roles?role=${id}` },
  );
}

export async function saveRolePermissions(slug: string, roleId: string, form: FormData): Promise<never> {
  const back = `/settings/roles?role=${encodeURIComponent(roleId)}`;
  return act(slug, back, "Permissions saved.", async (q, ctx) => {
    const role = (await q<{ id: string }>("select id from public.roles where id = $1 and company_id = $2", [roleId, ctx.company.id])).rows[0];
    if (!role) throw new UserError("That role no longer exists.");
    const wanted = new Set(form.getAll("perm").map(String));
    const all = (await q<{ code: string; granted: boolean }>(
      `select p.code, exists (select 1 from public.role_permissions rp where rp.role_id = $1 and rp.permission_code = p.code) as granted
       from public.permissions p`,
      [roleId],
    )).rows;
    let changes = 0;
    for (const p of all) {
      if (p.granted !== wanted.has(p.code)) {
        await q("select public.set_role_permission($1, $2, $3)", [roleId, p.code, wanted.has(p.code)]);
        changes++;
      }
    }
    if (changes === 0) throw new UserError("Nothing changed.");
  });
}

export async function renameRole(slug: string, roleId: string, form: FormData): Promise<never> {
  return act(slug, `/settings/roles?role=${encodeURIComponent(roleId)}`, "Role renamed.", async (q, ctx) => {
    const name = text(form, "name");
    if (name.length < 2 || name.length > 60) throw new UserError("Please give the role a name (2 to 60 characters).");
    await changed(q("update public.roles set name = $3 where company_id = $1 and id = $2 and archived_at is null", [ctx.company.id, roleId, name]));
  });
}

export async function archiveRole(slug: string, form: FormData): Promise<never> {
  return act(slug, "/settings/roles", "Role archived.", async (q, ctx) => {
    await changed(
      q("update public.roles set archived_at = now() where company_id = $1 and id = $2 and archived_at is null", [ctx.company.id, uuid(form, "id", "a role")]),
    );
  });
}
