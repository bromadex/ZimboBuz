-- Lists companies and sign-in accounts (read only). Emails are masked: the
-- workflow log is visible to anyone who can read the repository.
\set ON_ERROR_STOP on
\pset footer off

create temporary view masked as
select id, regexp_replace(lower(email), '^(.{2})[^@]*(@.).*(\..*)$', '\1***\2***\3') as email, created_at
from auth.users;

\echo '== Companies'
select c.slug, c.name, c.plan_code as plan, c.industry_code as industry, c.created_at::date as created,
       (select count(*) from public.memberships m where m.company_id = c.id) as people,
       (select string_agg(u.email, ', ') from public.memberships m join masked u on u.id = m.user_id
        where m.company_id = c.id) as accounts
from public.companies c
order by c.created_at;

\echo '== Sign-in accounts'
select u.email, u.created_at::date as created,
       (select string_agg(c.slug, ', ') from public.memberships m join public.companies c on c.id = m.company_id where m.user_id = u.id) as staff_of,
       (select string_agg(c.slug, ', ') from public.portal_users p join public.companies c on c.id = p.company_id where p.user_id = u.id) as customer_of
from masked u
order by u.created_at;
