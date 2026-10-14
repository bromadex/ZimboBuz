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
