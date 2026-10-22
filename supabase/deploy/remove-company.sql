-- Removes one company completely, for test sign-ups and mistakes only
-- (companies never delete their own records in the app). Also removes the
-- sign-in accounts that belong to this company and nothing else.
--
--   psql "$SUPABASE_DB_URL" -v slug=kuda -v really=false -f supabase/deploy/remove-company.sql
--
-- With really=false it only reports what would go, then rolls back.

\set ON_ERROR_STOP on
\pset footer off

begin;

select coalesce((select id::text from public.companies where slug = :'slug'), '') as company_id \gset
select :'company_id' = '' as missing \gset
\if :missing
  \echo 'No company with that address. Nothing to do.'
  rollback;
  \quit
\endif

-- Accounts that only belong to this company (as staff or as customers).
create temporary table doomed_users on commit drop as
select distinct u.id
from auth.users u
where (exists (select 1 from public.memberships m where m.user_id = u.id and m.company_id = :'company_id')
       or exists (select 1 from public.portal_users p where p.user_id = u.id and p.company_id = :'company_id'))
  and not exists (select 1 from public.memberships m where m.user_id = u.id and m.company_id <> :'company_id')
  and not exists (select 1 from public.portal_users p where p.user_id = u.id and p.company_id <> :'company_id');

-- Rows go regardless of order: foreign keys and the lock-down triggers are
-- switched off for this transaction only.
set local session_replication_role = replica;
select set_config('zimerp.remove_company', :'company_id', true) \gset

create temporary table removed (tbl text, n bigint) on commit drop;

do $$
declare
  t record;
  v_company uuid := current_setting('zimerp.remove_company')::uuid;
  n bigint;
begin
  for t in
    select table_schema, table_name from information_schema.columns
    where column_name = 'company_id' and table_schema in ('public', 'app')
      and (table_schema, table_name) in (select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE')
  loop
    execute format('delete from %I.%I where company_id = $1', t.table_schema, t.table_name) using v_company;
    get diagnostics n = row_count;
    if n > 0 then insert into removed values (t.table_schema || '.' || t.table_name, n); end if;
  end loop;
  delete from public.companies where id = v_company;
  insert into removed values ('public.companies', 1);
  -- What belongs to the removed accounts themselves.
  delete from app.user_totp where user_id in (select id from doomed_users);
  delete from public.record_followers where user_id in (select id from doomed_users);
  delete from auth.users where id in (select id from doomed_users);
  get diagnostics n = row_count;
  insert into removed values ('auth.users (sign-in accounts)', n);
end;
$$ ;

\echo '== Removed (rows per table)'
select tbl as "table", n as rows from removed order by tbl;

\if :really
  commit;
  \echo '== Done: the company and its own accounts are gone.'
\else
  rollback;
  \echo '== Practice run only: nothing was removed. Run again with "confirm" ticked to remove it.'
\endif
