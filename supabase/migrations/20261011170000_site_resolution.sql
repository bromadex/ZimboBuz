-- Domain routing support (issue #23, master plan §12.6).

-- Names that belong to ZimERP itself and can never be a company's address.
create function app.is_reserved_slug(p_slug text)
returns boolean
language sql immutable
as $$
  select lower(p_slug) = any (array[
    'www','app','api','admin','status','help','support','docs','erp','mail','email',
    'cdn','static','assets','auth','login','billing','zimerp','portal','dashboard'
  ]);
$$;

alter table public.companies
  add constraint companies_slug_not_reserved check (not app.is_reserved_slug(slug));

-- Public lookup used by the request router: which company (and which part of
-- ZimERP) a verified hostname belongs to. Reveals only the public slug and name.
create function public.resolve_site(p_hostname text)
returns table (company_slug text, kind text, company_name text)
language sql stable security definer set search_path = ''
as $$
  select c.slug, d.kind, c.name
  from public.company_domains d
  join public.companies c on c.id = d.company_id
  where d.hostname = lower(trim(trailing '.' from trim(p_hostname)))
    and d.archived_at is null
    and d.verified_at is not null
    and c.archived_at is null
    and c.status <> 'suspended';
$$;

revoke execute on function public.resolve_site(text) from public;
grant execute on function public.resolve_site(text) to anon, authenticated, service_role;
