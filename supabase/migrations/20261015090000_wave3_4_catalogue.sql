-- Waves 3 and 4 (master plan §5.1): the module catalogue, which plans include
-- each module, base permissions and role templates, and industry suggestions.
-- Each module's tables and screens come in their own migrations; this one only
-- registers what they share, so they can be built side by side.

-- ---------------------------------------------------------------------------
-- Adding a permission later: catalogue, role templates and existing companies
-- ---------------------------------------------------------------------------

-- Registers a permission, adds it to the named role templates and grants it to
-- those system roles in every existing company (new companies copy templates).
create function app.add_permission(
  p_code text, p_module text, p_feature text, p_action text, p_light_ok boolean,
  p_description text, p_roles text[]
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_role text;
  v_name text;
begin
  insert into public.permissions (code, module_code, feature_code, action, light_ok, description)
  values (p_code, p_module, p_feature, p_action, p_light_ok, p_description)
  on conflict (code) do nothing;
  foreach v_role in array coalesce(p_roles, array[]::text[]) loop
    select role_name into v_name from public.role_templates where role_code = v_role limit 1;
    v_name := coalesce(v_name, initcap(replace(v_role, '_', ' ')));
    insert into public.role_templates (role_code, role_name, permission_code)
    values (v_role, v_name, p_code) on conflict do nothing;
    insert into public.role_permissions (company_id, role_id, permission_code)
    select r.company_id, r.id, p_code
    from public.roles r
    where r.code = v_role and r.is_system
    on conflict do nothing;
  end loop;
end;
$$;
revoke execute on function app.add_permission(text, text, text, text, boolean, text, text[]) from public;

-- ---------------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------------

insert into public.modules (code, name, is_core, counts_toward_limit, sort_order) values
  -- Wave 3: growth
  ('crm',           'CRM and campaigns',            false, true,  10),
  ('projects',      'Projects and timesheets',      false, true,  11),
  ('manufacturing', 'Manufacturing and quality',    false, true,  12),
  ('maintenance',   'Assets and maintenance',       false, true,  13),
  ('helpdesk',      'Helpdesk and live chat',       false, true,  14),
  ('subscriptions', 'Subscription billing',         false, true,  15),
  ('studio',        'ZimERP Studio',                false, false, 16),
  ('api',           'API and webhooks',             false, false, 17),
  -- Waves 3 and 4: additional apps
  ('esign',         'E-signatures',                 false, true,  20),
  ('appointments',  'Appointments and bookings',    false, true,  21),
  ('field_service', 'Field service',                false, true,  22),
  ('rental',        'Rental',                       false, true,  23),
  ('events',        'Events and ticketing',         false, true,  24),
  ('surveys',       'Surveys and forms',            false, true,  25),
  ('elearning',     'eLearning',                    false, true,  26),
  -- Wave 4: industries
  ('mining',        'Mining and construction',      false, true,  30),
  ('fleet',         'Fleet, fuel and logistics',    false, true,  31),
  ('healthcare',    'Clinic and patients',          false, true,  32),
  ('microfinance',  'Loans and microfinance',       false, true,  33),
  ('hospitality',   'Restaurant and hospitality',   false, true,  34),
  ('garage',        'Garage and workshop',          false, true,  35),
  ('farming',       'Farming',                      false, true,  36),
  -- Wave 4: intelligence
  ('ai',            'Intelligence (AI, forecasts and benchmarks)', false, true, 40),
  ('iot',           'IoT devices and sensors',      false, true,  41);

-- Which plans include them. Starter keeps Release 1 modules only.
insert into public.plan_modules (plan_code, module_code)
select p.code, m.code
from public.plans p
cross join (values
  ('crm','business'), ('projects','business'), ('helpdesk','business'), ('subscriptions','business'),
  ('esign','business'), ('appointments','business'), ('field_service','business'), ('rental','business'),
  ('events','business'), ('surveys','business'), ('elearning','business'),
  ('hospitality','business'), ('garage','business'), ('farming','business'), ('healthcare','business'),
  ('manufacturing','growth'), ('maintenance','growth'), ('fleet','growth'), ('microfinance','growth'), ('ai','growth'),
  ('studio','pro'), ('api','pro'), ('iot','pro'), ('mining','pro')
) as m(code, min_plan)
join public.plans mp on mp.code = m.min_plan
where p.sort_order >= mp.sort_order;

-- Feature switches (each module can add more in its own migration).
insert into public.features (code, module_code, name, default_on) values
  ('crm.campaigns',          'crm',           'Campaigns by SMS, email and WhatsApp',     true),
  ('crm.automation',         'crm',           'Marketing automation',                     false),
  ('projects.timesheets',    'projects',      'Timesheets',                               true),
  ('projects.billing',       'projects',      'Invoice project time and costs',           true),
  ('manufacturing.quality',  'manufacturing', 'Quality checks',                           true),
  ('maintenance.depreciation','maintenance',  'Asset depreciation',                       true),
  ('helpdesk.live_chat',     'helpdesk',      'Live chat on your website',                true),
  ('helpdesk.portal',        'helpdesk',      'Customers raise tickets in the portal',    true),
  ('appointments.online',    'appointments',  'Online booking on your website',           true),
  ('events.tickets',         'events',        'Sell tickets online',                      true),
  ('ai.assistant',           'ai',            'Ask AI assistant',                         true),
  ('ai.capture',             'ai',            'Read receipts and supplier invoices',      true),
  ('ai.forecasting',         'ai',            'Sales and stock forecasts',                true),
  ('ai.benchmarks',          'ai',            'Industry benchmarks',                      true);

-- Base permissions: view (light users may) and manage, for owner and manager.
-- Studio and the API change how the whole company works: owners manage them.
do $$
declare
  m record;
begin
  for m in select code, name from public.modules where sort_order >= 10 loop
    perform app.add_permission(m.code || '.view', m.code, null, 'view', true, 'View ' || lower(m.name), array['owner','manager']);
    perform app.add_permission(m.code || '.manage', m.code, null, 'manage', false, 'Manage ' || lower(m.name),
                               case when m.code in ('studio', 'api') then array['owner'] else array['owner','manager'] end);
  end loop;
end;
$$;

-- Accountants see money-related modules.
select app.add_permission('subscriptions.view', 'subscriptions', null, 'view', true, 'View subscription billing', array['accountant']);
select app.add_permission('microfinance.view', 'microfinance', null, 'view', true, 'View loans and microfinance', array['accountant']);
select app.add_permission('maintenance.view', 'maintenance', null, 'view', true, 'View assets and maintenance', array['accountant']);

-- ---------------------------------------------------------------------------
-- Industries: suggestions that use the new modules, and two new industries
-- ---------------------------------------------------------------------------

insert into public.industries (code, name, description, sort_order, suggested_modules, suggested_features, website_template, terms, starter_items) values
  ('clinic', 'Clinic or medical practice', 'Patients, appointments, visits and billing to medical aid or cash.', 16,
   array['healthcare','appointments','sales','website'], '{"website.add_to_quote": false}', 'classic', '{"customer":"Patient","customers":"Patients"}', '[]'),
  ('microfinance', 'Microfinance or lending', 'Loans, repayment schedules, collections and statements.', 17,
   array['microfinance','sales','portal'], '{"website.add_to_quote": false}', 'consult', '{"customer":"Borrower","customers":"Borrowers"}', '[]');

update public.industries set sort_order = 99 where code = 'other';

update public.industries i
set suggested_modules = (select array_agg(distinct m) from unnest(i.suggested_modules || s.extra) m)
from (values
  ('retail',              array['crm']),
  ('hardware',            array['crm']),
  ('wholesale',           array['crm']),
  ('restaurant',          array['hospitality']),
  ('hospitality',         array['hospitality','appointments']),
  ('salon',               array['appointments']),
  ('agriculture',         array['farming']),
  ('mining_construction', array['mining','fleet','maintenance']),
  ('professional',        array['projects','esign','crm']),
  ('school',              array['elearning','events']),
  ('church',              array['events']),
  ('ngo',                 array['events','surveys','projects']),
  ('auto',                array['garage']),
  ('online_store',        array['crm'])
) as s(code, extra)
where i.code = s.code;
