-- Industry suggestions are in priority order: sign-up ticks them in this
-- order until the plan's module allowance is used (src/lib/signup/modules.ts).
-- 20261015090000_wave3_4_catalogue merged in the new modules with
-- array_agg(distinct ...), which sorted them alphabetically, so CRM crowded
-- out quotes and invoicing for a hardware shop. This puts each industry's
-- list back in a deliberate order, with its own industry module near the front.

update public.industries i
set suggested_modules = s.modules
from (values
  ('retail',              array['pos','inventory','crm','website']),
  ('hardware',            array['pos','sales','inventory','crm','website']),
  ('wholesale',           array['sales','inventory','portal','crm','website']),
  ('restaurant',          array['pos','hospitality','inventory','website']),
  ('hospitality',         array['pos','hospitality','appointments','sales','website']),
  ('salon',               array['pos','appointments','inventory','website']),
  ('pharmacy',            array['pos','sales','inventory','website']),
  ('agriculture',         array['farming','pos','sales','inventory','website']),
  ('mining_construction', array['mining','fleet','sales','inventory','maintenance','portal','website']),
  ('professional',        array['sales','projects','portal','crm','esign','website']),
  ('school',              array['sales','portal','elearning','events','website']),
  ('church',              array['sales','events','website']),
  ('ngo',                 array['sales','events','projects','surveys','website']),
  ('auto',                array['pos','garage','sales','inventory','website']),
  ('online_store',        array['website','sales','inventory','crm']),
  ('clinic',              array['healthcare','appointments','sales','website']),
  ('microfinance',        array['microfinance','sales','portal']),
  ('other',               array['pos','sales'])
) as s(code, modules)
where i.code = s.code;
