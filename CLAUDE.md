# ZimERP — project guide for AI sessions

ZimERP is a multi-company business platform for Zimbabwe: ERP, websites and online stores, Microsoft 365 email and domains. The full plan is `docs/ZimERP-master-plan.md` (PDF alongside); issues on GitHub follow its phases (epics #1, #8–#16). Read the relevant section and issue before starting work.

Also read `AGENTS.md`: this Next.js version differs from older ones; check `node_modules/next/dist/docs/` before writing Next.js code.

## Layout

- `src/` — Next.js app (App Router, TypeScript, Tailwind)
- `supabase/migrations/` — SQL migrations, applied in filename order (`YYYYMMDDHHMMSS_name.sql`)
- `supabase/tests/supabase_shim.sql` — stand-in for Supabase's `auth` schema and roles, used only by tests
- `tests/db/` — database tests (vitest + pg) run against a fresh PostgreSQL database per file
- `docs/` — plan documents; `docs/pdf-build/` regenerates the master plan PDF

## Commands

```
npm run lint        # ESLint
npm run typecheck   # next typegen + tsc
npm test            # unit tests (src/**/*.test.ts)
npm run test:db     # database tests; needs PostgreSQL 16 (DATABASE_URL,
                    # default postgres://postgres@localhost:54329/postgres)
npm run build
```

Run all of them before pushing; CI (`.github/workflows/ci.yml`) runs the same checks.

## Non-negotiable rules

1. **Company isolation.** Every business table has `company_id` and row-level security. A new table without RLS, or without `company_id` and not listed as catalogue in `tests/db/isolation.test.ts`, fails CI.
2. **One access rule.** Check writes with `app.can(company_id, 'module.action')` (plan includes the module, company switched it and the feature on, role grants it). Never hard-code role names. New permissions go in the `permissions` catalogue and role templates.
3. **No hard deletes.** No DELETE grants or policies; archive with `archived_at` or a status. Submitted documents are locked (Draft → Submitted → Cancelled/Amended).
4. **Migrations are append-only once applied.** Change behaviour with a new migration. Until Supabase is connected, migrations live in git only and are tested locally/CI.
5. **Security definer functions** set `search_path = ''` and schema-qualify everything.
6. **Portable code.** Standard PostgreSQL only; external services (payments, email, messaging, storage, DNS, fiscal, AI) go through adapter modules; configuration via environment variables; no secrets in the repo.
7. **Money.** Store amounts as integer minor units with an explicit currency (`USD`, `ZWG`, `ZAR`); every document records the exchange rate it used.
8. **Tests with every change.** Database behaviour gets a test in `tests/db/`; isolation tests must keep passing.
9. **Closed source.** Never copy code from GPL/AGPL projects (ERPNext, Odoo Community); check dependency licences (MIT, BSD, Apache 2.0, ISC preferred).
10. **Plain English** in user-facing text; British spelling.
