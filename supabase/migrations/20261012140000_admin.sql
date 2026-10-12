-- Administration (epic #9: P3, P10, P12, P17): inviting and managing users,
-- custom roles and permission changes, two-step sign-in storage, company
-- preferences (daily WhatsApp summary, two-step requirement) and the record of
-- summaries sent.

-- ---------------------------------------------------------------------------
-- Memberships: invitations
-- ---------------------------------------------------------------------------

alter table public.memberships
  add column invited_by uuid,
  add column invited_at timestamptz;

-- True when the signed-in user is an active owner of the company. The owner
-- role is the system role every company is created with (create_company).
create function app.is_owner(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m join public.roles r on r.id = m.role_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
      and r.code = 'owner' and r.is_system);
$$;
grant execute on function app.is_owner(uuid) to authenticated, service_role;

-- Guards changes to memberships made by users:
--   * a membership stays with its company and user;
--   * only owners may make someone an owner or change an owner's access;
--   * a company always keeps at least one active owner.
create function app.guard_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner_role uuid;
begin
  select id into v_owner_role from public.roles where company_id = new.company_id and code = 'owner' and is_system;

  if tg_op = 'INSERT' then
    -- The first membership is the founder's, made by create_company().
    -- Non-members are left to row-level security, which refuses them.
    if auth.uid() is not null and app.is_member(new.company_id)
       and new.role_id = v_owner_role and not app.is_owner(new.company_id)
       and exists (select 1 from public.memberships where company_id = new.company_id) then
      raise exception 'Only an owner can make someone an owner or change an owner''s access.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.company_id, new.user_id) is distinct from (old.company_id, old.user_id) then
    raise exception 'A membership cannot be moved to another company or user.' using errcode = 'check_violation';
  end if;

  if auth.uid() is not null
     and (new.role_id = v_owner_role or old.role_id = v_owner_role)
     and (new.role_id, new.status, new.user_type) is distinct from (old.role_id, old.status, old.user_type)
     and not (old.user_id = auth.uid() and old.status = 'invited')   -- accepting an invitation
     and not app.is_owner(new.company_id) then
    raise exception 'Only an owner can make someone an owner or change an owner''s access.'
      using errcode = 'check_violation';
  end if;

  if old.role_id = v_owner_role and old.status = 'active'
     and (new.role_id <> v_owner_role or new.status <> 'active')
     and not exists (select 1 from public.memberships m
                     where m.company_id = new.company_id and m.id <> new.id
                       and m.role_id = v_owner_role and m.status = 'active') then
    raise exception 'A company must keep at least one owner. Make someone else an owner first.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger memberships_guard before insert or update on public.memberships
  for each row execute function app.guard_membership();

-- Invites an existing auth user (the server creates the user first, through
-- the sign-in adapter). Invited full users count towards the plan limit so the
-- company never invites more people than it can let in.
create function public.invite_member(p_company uuid, p_user uuid, p_role uuid, p_user_type text default 'full')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan  public.plans;
  v_count integer;
  v_role  public.roles;
  v_id    uuid;
begin
  if not app.can(p_company, 'admin.users.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_user_type not in ('full', 'light') then
    raise exception 'Please choose full or light.' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_role from public.roles where id = p_role and company_id = p_company and archived_at is null;
  if v_role.id is null then
    raise exception 'Please choose a role.' using errcode = 'invalid_parameter_value';
  end if;
  if v_role.code = 'owner' and v_role.is_system and not app.is_owner(p_company) then
    raise exception 'Only an owner can make someone an owner or change an owner''s access.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.memberships where company_id = p_company and user_id = p_user) then
    raise exception 'That person is already on your list of users.' using errcode = 'check_violation';
  end if;

  select pl.* into v_plan from public.companies c join public.plans pl on pl.code = c.plan_code where c.id = p_company;
  if p_user_type = 'full' and v_plan.max_full_users is not null then
    select count(*) into v_count from public.memberships
    where company_id = p_company and user_type = 'full' and status in ('active', 'invited');
    if v_count + 1 > v_plan.max_full_users then
      raise exception 'plan % allows % full users', v_plan.code, v_plan.max_full_users using errcode = 'check_violation';
    end if;
  end if;

  insert into public.memberships (company_id, user_id, role_id, user_type, status, invited_by, invited_at)
  values (p_company, p_user, p_role, p_user_type, 'invited', auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.invite_member(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.invite_member(uuid, uuid, uuid, text) to authenticated;

-- The signed-in user's membership of a company by its web address, whatever
-- its status, so an invited or disabled user can be told where they stand.
create function public.my_membership(p_slug text)
returns table (company_id uuid, company_name text, role_name text, user_type text, status text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, r.name, m.user_type, m.status
  from public.companies c
  join public.memberships m on m.company_id = c.id and m.user_id = auth.uid()
  join public.roles r on r.id = m.role_id
  where c.slug = p_slug and c.archived_at is null;
$$;
revoke execute on function public.my_membership(text) from public, anon;
grant execute on function public.my_membership(text) to authenticated;

-- Accepts the signed-in user's invitation. Plan limits apply on acceptance too.
create function public.accept_invitation(p_company uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.memberships set status = 'active'
  where company_id = p_company and user_id = auth.uid() and status = 'invited';
  if not found then
    raise exception 'There is no invitation waiting for you.' using errcode = 'check_violation';
  end if;
end;
$$;
revoke execute on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Roles: custom roles and permission changes (always audited)
-- ---------------------------------------------------------------------------

-- Creates a custom role with the permissions of an existing role.
create function public.create_role(p_company uuid, p_name text, p_copy_from uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_base text;
  v_code text;
  v_n    integer := 1;
  v_id   uuid;
begin
  if not app.can(p_company, 'admin.roles.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if length(v_name) not between 2 and 60 then
    raise exception 'Please give the role a name (2 to 60 characters).' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from public.roles where company_id = p_company and lower(name) = lower(v_name) and archived_at is null) then
    raise exception 'A role with that name already exists.' using errcode = 'check_violation';
  end if;
  if p_copy_from is not null
     and not exists (select 1 from public.roles where id = p_copy_from and company_id = p_company) then
    raise exception 'Please choose a role to copy.' using errcode = 'invalid_parameter_value';
  end if;

  v_base := left(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), 24);
  if v_base !~ '^[a-z]' then v_base := 'role_' || v_base; end if;
  v_base := rtrim(v_base, '_');
  if length(v_base) < 2 then v_base := 'role'; end if;
  v_code := v_base;
  while exists (select 1 from public.roles where company_id = p_company and code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || '_' || v_n;
  end loop;

  insert into public.roles (company_id, code, name, is_system)
  values (p_company, v_code, v_name, false)
  returning id into v_id;

  insert into public.role_permissions (company_id, role_id, permission_code)
  select p_company, v_id, rp.permission_code from public.role_permissions rp where rp.role_id = p_copy_from;

  insert into public.audit_events (company_id, table_name, record_id, action, actor_id, before, after)
  values (p_company, 'role_permissions', v_id::text, 'insert', auth.uid(), null,
          jsonb_build_object('role', v_name, 'permissions',
            coalesce((select jsonb_agg(permission_code order by permission_code)
                      from public.role_permissions where role_id = v_id), '[]'::jsonb)));
  return v_id;
end;
$$;
revoke execute on function public.create_role(uuid, text, uuid) from public, anon;
grant execute on function public.create_role(uuid, text, uuid) to authenticated;

-- Gives or takes away one permission. The owner role always has everything.
-- This is the only way to take a permission away (there are no DELETE grants).
create function public.set_role_permission(p_role uuid, p_permission text, p_granted boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.roles;
  v_had  boolean;
begin
  select * into v_role from public.roles where id = p_role;
  if v_role.id is null or not app.can(v_role.company_id, 'admin.roles.manage') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_role.code = 'owner' and v_role.is_system then
    raise exception 'The owner role always has every permission.' using errcode = 'check_violation';
  end if;
  if v_role.archived_at is not null then
    raise exception 'That role has been archived.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.permissions where code = p_permission) then
    raise exception 'Unknown permission.' using errcode = 'invalid_parameter_value';
  end if;

  v_had := exists (select 1 from public.role_permissions where role_id = p_role and permission_code = p_permission);
  if v_had = p_granted then
    return false;
  end if;
  if p_granted then
    insert into public.role_permissions (company_id, role_id, permission_code)
    values (v_role.company_id, p_role, p_permission);
  else
    delete from public.role_permissions where role_id = p_role and permission_code = p_permission;
  end if;

  insert into public.audit_events (company_id, table_name, record_id, action, actor_id, before, after)
  values (v_role.company_id, 'role_permissions', p_role::text, 'update', auth.uid(),
          jsonb_build_object('role', v_role.name, 'permission', p_permission, 'granted', v_had),
          jsonb_build_object('role', v_role.name, 'permission', p_permission, 'granted', p_granted));
  return true;
end;
$$;
revoke execute on function public.set_role_permission(uuid, text, boolean) from public, anon;
grant execute on function public.set_role_permission(uuid, text, boolean) to authenticated;

-- Roles may not be renamed into duplicates, system roles keep their code, and
-- a role still given to someone cannot be archived.
create function app.guard_role()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.company_id, new.code, new.is_system) is distinct from (old.company_id, old.code, old.is_system) then
    raise exception 'A role''s code cannot be changed.' using errcode = 'check_violation';
  end if;
  if new.archived_at is not null and old.archived_at is null then
    if old.is_system then
      raise exception 'Built-in roles cannot be archived.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.memberships where role_id = new.id and status in ('active', 'invited')) then
      raise exception 'Move everyone off this role before archiving it.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger roles_guard before update on public.roles
  for each row execute function app.guard_role();

-- ---------------------------------------------------------------------------
-- Company preferences (one row per company, created when first saved)
-- ---------------------------------------------------------------------------

create table public.company_preferences (
  company_id               uuid primary key references public.companies(id),
  require_two_step_admins  boolean not null default false,
  daily_summary_enabled    boolean not null default false,
  daily_summary_phones     text[] not null default '{}'
                           check (cardinality(daily_summary_phones) <= 5),
  daily_summary_hour       smallint not null default 18 check (daily_summary_hour between 0 and 23),  -- Harare time
  updated_at               timestamptz not null default now()
);

create trigger company_preferences_touch before update on public.company_preferences
  for each row execute function app.touch_updated_at();
create trigger company_preferences_audit after insert or update on public.company_preferences
  for each row execute function app.audit_row();

-- Daily WhatsApp summaries sent (one per company per day; written by the scheduler).
create table public.daily_summary_runs (
  company_id    uuid not null references public.companies(id),
  summary_date  date not null,
  status        text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  recipients    integer not null default 0,
  body          text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (company_id, summary_date)
);

create trigger daily_summary_runs_touch before update on public.daily_summary_runs
  for each row execute function app.touch_updated_at();

alter table public.company_preferences enable row level security;
alter table public.daily_summary_runs  enable row level security;

-- Phone numbers are personal data: only people who edit company settings see them.
create policy admin_read  on public.company_preferences for select to authenticated using (app.can(company_id, 'admin.company.edit'));
create policy admin_write on public.company_preferences for insert to authenticated with check (app.can(company_id, 'admin.company.edit'));
create policy admin_edit  on public.company_preferences for update to authenticated
  using (app.can(company_id, 'admin.company.edit')) with check (app.can(company_id, 'admin.company.edit'));
create policy admin_read  on public.daily_summary_runs for select to authenticated using (app.can(company_id, 'admin.company.edit'));

revoke all on public.company_preferences, public.daily_summary_runs from anon, authenticated;
grant select, insert, update on public.company_preferences to authenticated;
grant select on public.daily_summary_runs to authenticated;

-- Whether a company asks staff with admin permissions to use two-step sign-in.
create function app.requires_two_step(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select require_two_step_admins from public.company_preferences where company_id = p_company), false);
$$;
grant execute on function app.requires_two_step(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- VAT settings for people with the tax permission but not "edit company details"
-- ---------------------------------------------------------------------------

create function public.set_company_tax(p_company uuid, p_vat_registered boolean, p_vat_number text, p_prices_include_tax boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not app.can(p_company, 'core.settings.tax') then
    raise exception 'you do not have permission to change VAT settings' using errcode = 'insufficient_privilege';
  end if;
  if p_vat_registered and coalesce(trim(p_vat_number), '') = '' then
    raise exception 'Please enter your VAT number.' using errcode = 'check_violation';
  end if;
  update public.companies
  set vat_registered = p_vat_registered, vat_number = nullif(trim(p_vat_number), ''), prices_include_tax = p_prices_include_tax
  where id = p_company;
end;
$$;
revoke execute on function public.set_company_tax(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.set_company_tax(uuid, boolean, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Two-step sign-in (development sign-in adapter). Secrets are encrypted by the
-- server before they are stored; this table is private to the server: signed-in
-- users and visitors cannot read it. With Supabase Auth, Supabase MFA is used.
-- ---------------------------------------------------------------------------

create table app.user_totp (
  user_id          uuid primary key references auth.users(id),
  secret_enc       text,                          -- AES-256-GCM, see src/server/secret-box.ts
  enabled_at       timestamptz,                   -- null: being set up, or switched off
  last_step        bigint not null default 0,     -- last 30-second step used (no replays)
  recovery_hashes  text[] not null default '{}',  -- SHA-256 of unused recovery codes
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger user_totp_touch before update on app.user_totp
  for each row execute function app.touch_updated_at();

revoke all on app.user_totp from public, anon, authenticated;
grant select, insert, update on app.user_totp to service_role;
