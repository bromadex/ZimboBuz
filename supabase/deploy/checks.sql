-- Checks a real Supabase database after the migrations (CLAUDE.md rules 1, 3
-- and 5), plus an isolation test with two throwaway sign-ins that is rolled
-- back, so nothing is left behind. Stops at the first failure.
--
--   psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/deploy/checks.sql

\set ON_ERROR_STOP on
\pset footer off

\echo '== 1. Row-level security on every table in public'
do $$
declare v text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v is not null then
    raise exception 'Tables without row-level security: %', v;
  end if;
  raise notice 'ok: every public table has row-level security';
end $$;

\echo '== 2. No DELETE for signed-in users or visitors'
do $$
declare v text;
begin
  select string_agg(distinct table_name || ' (' || grantee || ')', ', ') into v
  from information_schema.role_table_grants
  where table_schema = 'public' and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated');
  if v is not null then
    raise exception 'DELETE is granted on: %', v;
  end if;
  raise notice 'ok: no DELETE grants for anon or authenticated';
end $$;

\echo '== 3. Security definer functions have a fixed search_path'
do $$
declare v text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1) into v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app') and p.prosecdef
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');
  if v is not null then
    raise exception 'Security definer functions without search_path: %', v;
  end if;
  raise notice 'ok: every security definer function sets search_path';
end $$;

\echo '== 4. Catalogue data is loaded'
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['plans', 'modules', 'plan_modules', 'features', 'permissions', 'role_templates', 'industries', 'doctypes', 'tax_rates'] loop
    execute format('select count(*) from public.%I', t) into n;
    if n = 0 then
      raise exception 'Catalogue table public.% is empty', t;
    end if;
    raise notice 'ok: public.% has % rows', t, n;
  end loop;
end $$;

\echo '== 5. Tables without company_id (should all be catalogue tables)'
select c.relname as table_without_company_id
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
order by 1;

\echo '== 6. Companies cannot see each other (two throwaway sign-ins, rolled back)'
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a001', 'zimerp-check-a@example.invalid'),
  ('00000000-0000-4000-8000-00000000b001', 'zimerp-check-b@example.invalid');

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000a001', true) as sub_a,
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000a001","role":"authenticated"}', true) as claims_a \gset
select public.create_company('Check Company A', 'zimerp-check-a', 'business', array['sales'], 'USD') as company_a \gset
insert into public.customers (company_id, name) values (:'company_a', 'Customer of A');

select set_config('zimerp.check_company_a', :'company_a', true) as stash_a,
       set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b001', true) as sub_b,
       set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b001","role":"authenticated"}', true) as claims_b \gset
select public.create_company('Check Company B', 'zimerp-check-b', 'business', array['sales'], 'USD') as company_b \gset

do $$
begin
  if exists (select 1 from public.companies where slug = 'zimerp-check-a') then
    raise exception 'Isolation failed: company B''s owner can see company A';
  end if;
  if exists (select 1 from public.customers where name = 'Customer of A') then
    raise exception 'Isolation failed: company B''s owner can see company A''s customers';
  end if;
  if not exists (select 1 from public.companies where slug = 'zimerp-check-b') then
    raise exception 'Company B''s owner cannot see their own company';
  end if;
  raise notice 'ok: company B sees only its own company and customers';
end $$;

-- Writing into another company is refused.
do $$
begin
  begin
    insert into public.customers (company_id, name)
    values (current_setting('zimerp.check_company_a')::uuid, 'Intruder');
    raise exception 'Isolation failed: company B''s owner wrote into company A';
  exception when insufficient_privilege then
    raise notice 'ok: company B cannot write into company A';
  end;
end $$;

rollback;

\echo '== All checks passed'
