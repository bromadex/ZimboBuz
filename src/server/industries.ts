import "server-only";
import { cache } from "react";
import { getPool } from "./db";

// The industries catalogue (supabase/migrations/20261014150000_industries.sql).
// Public reference data, read as the server.

export interface Industry {
  code: string;
  name: string;
  description: string;
  suggestedModules: string[];
  websiteTemplate: string;
  hasStarterItems: boolean;
}

export const listIndustries = cache(async (): Promise<Industry[]> => {
  const { rows } = await getPool().query<{
    code: string; name: string; description: string; suggested_modules: string[]; website_template: string; starter: boolean;
  }>(
    `select code, name, description, suggested_modules, website_template, jsonb_array_length(starter_items) > 0 as starter
     from public.industries order by sort_order`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    suggestedModules: r.suggested_modules,
    websiteTemplate: r.website_template,
    hasStarterItems: r.starter,
  }));
});

export interface PlanOption {
  code: string;
  name: string;
  priceUsdCents: number;
  maxModules: number | null;
  maxUsers: number | null;
  modules: string[];
}
export interface ModuleOption {
  code: string;
  name: string;
  countsTowardLimit: boolean;
}

/** Plans on sale at sign-up (Enterprise is arranged with ZimERP) and the modules each includes. */
export const listPlans = cache(async (): Promise<PlanOption[]> => {
  const { rows } = await getPool().query<{
    code: string; name: string; price_usd_cents: number; max_modules: number | null; max_full_users: number | null; modules: string[] | null;
  }>(
    `select p.code, p.name, p.price_usd_cents, p.max_modules, p.max_full_users,
            array_agg(pm.module_code order by pm.module_code) filter (where pm.module_code is not null) as modules
     from public.plans p left join public.plan_modules pm on pm.plan_code = p.code
     where p.code <> 'enterprise'
     group by p.code order by p.sort_order`,
  );
  return rows.map((r) => ({
    code: r.code, name: r.name, priceUsdCents: r.price_usd_cents, maxModules: r.max_modules, maxUsers: r.max_full_users, modules: r.modules ?? [],
  }));
});

export const listModules = cache(async (): Promise<ModuleOption[]> => {
  const { rows } = await getPool().query<{ code: string; name: string; counts_toward_limit: boolean }>(
    "select code, name, counts_toward_limit from public.modules where not is_core order by sort_order",
  );
  return rows.map((r) => ({ code: r.code, name: r.name, countsTowardLimit: r.counts_toward_limit }));
});
