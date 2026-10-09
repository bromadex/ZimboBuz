# ZimERP Technical Architecture

Status: draft. Describes how ZimERP serves many companies from one codebase. Hosting decisions are in [product-vision.md](product-vision.md#hosting-and-domains).

## Stack

| Layer | Choice |
|---|---|
| Web app (ERP, websites, stores) | Next.js (App Router) with TypeScript, Tailwind CSS |
| Database, auth, storage, functions | Supabase (PostgreSQL) — self-hostable on Azure or client servers |
| Offline sync | PowerSync (local SQLite on device, syncs with PostgreSQL) |
| Mobile | PWA for all; Capacitor wrapper for branded Android APK and iOS builds |
| Payments | Paynow first, behind a payment adapter |
| Email | Microsoft 365 via Microsoft Graph; Resend as fallback for transactional email |
| Hosting | Vercel + Supabase while building; Azure (Johannesburg) at commercial launch |

## Multi-tenancy

**Model:** one shared database; every business table has `company_id`; PostgreSQL row-level security (RLS) enforces isolation. Enterprise customers can get a dedicated database running the same migrations.

### Core platform tables (outline)
- `companies` — name, plan, status (active, grace, read-only, suspended), base currency
- `company_domains` — hostname, type (website, store, erp), verification and SSL status
- `company_branding` — logo, colours, fonts, template, motion setting
- `plans`, `plan_entitlements` — limits and included modules per plan
- `company_modules`, `company_features` — what each company has switched on
- `memberships` — user ↔ company with role; one user can belong to several companies (e.g. an accountant)
- `branches` — replaces Bravura's `site_id`; most records carry `company_id` and `branch_id`
- `roles`, `permissions`, `role_permissions` — Bravura model, scoped per company
- `audit_events` — append-only, written by triggers

### Access rule
A user can do an action only if **all three** are true:
1. The company's **plan** includes the module/feature.
2. The company has the module/feature **switched on**.
3. The user's **role** has the permission.

This is enforced in one SQL function (e.g. `can(company_id, 'pos.refund')`) used by RLS policies and server code, and mirrored in the UI to hide what is unavailable.

### Isolation tests
An automated test suite creates two companies and checks that every table, storage bucket, API route and sync rule refuses cross-company access. It runs on every change and blocks deployment on failure.

## Document model (patterns from ERPNext and Odoo)

- **Lifecycle:** financial and stock documents have `docstatus` Draft (0) → Submitted (1) → Cancelled (2); amending creates a new document linked to the cancelled one (`amended_from`). Triggers reject updates to submitted rows; cancel posts reversing ledger and stock entries.
- **Naming series:** `naming_series` table per company, document type and branch with a pattern (e.g. `INV-{BRANCH}-{YYYY}-{####}`); numbers allocated server-side, or from a per-device block for offline POS.
- **Activity panel:** shared `record_messages`, `record_followers` and `record_activities` tables keyed by (`company_id`, `doctype`, `record_id`) so every module gets chatter, notes, followers and scheduled activities without its own tables; system events written by triggers.
- **Connections and smart buttons:** a registry declaring which document types link to which (e.g. invoice → payments via `invoice_id`), used to build counts and filtered lists generically.
- **Field-level permissions:** sensitive columns exposed only through role-aware views/functions, so hidden fields are absent from API responses, exports and reports, not just hidden in the UI.
- **Views:** a generic list/card view component driven by per-doctype metadata (columns, filters, card layout), later extended with calendar, pivot, graph, map and timeline.
- **Portal users:** a separate `portal_contacts` identity linked to a customer or supplier, with RLS limiting them to their own documents; never counted as plan users.
- **ZimERP Studio (Wave 3):** custom fields stored as metadata plus a `custom` JSONB column per table, rendered by the same metadata-driven forms and views.

## Domain routing

- Next.js middleware reads the request hostname and resolves the company from `company_domains` (cached).
- `name.zimerp.co.zw` → company's website and store; `erp.name.zimerp.co.zw` or `erp.customdomain.co.zw` → ERP.
- Reserved names (`www`, `app`, `api`, `admin`, `status`, `help`) cannot be taken by companies.
- Custom domains are added through the hosting provider's API (Vercel now, Azure Front Door later) with automatic SSL.

## Website builder

- Pages are stored as JSON: an ordered list of blocks, each with type, content, settings and animation.
- A **template** = design tokens (colours, fonts, spacing, radii) + block styles + a motion preset + default pages.
- Blocks are React components shared by the editor (drag-and-drop, e.g. dnd-kit) and the public renderer.
- Public pages are rendered on the server and cached; editing invalidates the cache for that company's pages.
- Store blocks read live products, prices and stock from the ERP through read-only views.
- Motion uses CSS transforms and opacity, respects reduced motion, and pauses off screen (Bromadex motion code is the starting point).

## Offline-first (PowerSync)

- Sync rules give each device only its company, branch and role data (products, prices, customers, open till session).
- Offline writes go to an upload queue; server functions validate and apply them (stock, numbering, payment states) and reject or flag conflicts.
- Document numbers issued offline use a per-device prefix to avoid clashes, and fiscal numbering (Wave 2) is assigned server-side.

## Integrations through adapters

Each external service is reached through one module with a stable interface, so providers can change without touching the rest of the system:
- `payments` (Paynow, later Pesepay, EcoCash direct)
- `email` (Microsoft Graph, Resend)
- `messaging` (WhatsApp Business API, SMS)
- `storage` (Supabase Storage, later Azure Blob)
- `dns-and-domains` (Vercel/Azure DNS, name.co.zw manual workflow)
- `fiscal` (ZIMRA FDMS, Wave 2)
- `ai` (assistant provider)

## Public API and integrations

- REST API with per-company API keys and scopes, rate limits and webhooks (e.g. `invoice.paid`, `stock.low`).
- Available on Pro and Enterprise plans.
- Later: integration marketplace for partner-built add-ons, reviewed before listing.

## Reusing Bravura and Bromadex code

| Existing | ZimERP |
|---|---|
| React + Vite, JavaScript | Next.js + TypeScript (port screen by screen) |
| Inline styles with THEME tokens | Tailwind + design tokens from company branding |
| `site_id` scoping | `company_id` + `branch_id` |
| `_has_permission(code, site_id)` | `can(company_id, code)` including plan and feature checks |
| SQL migrations applied by hand | Versioned migrations applied automatically per environment |
| Ask Bravura (read-only `ai_*` functions) | ZimERP Ask, same principle, scoped per company |
| Bromadex store, quotation PDF, CRM lead flow | Website/store module with templates |

Order: port database logic first (tables, triggers, RLS with `company_id`), then screens per module, with isolation tests from day one.

## Environments

- **Local** (developer), **Staging** (test data, every change deployed here first), **Production**.
- Database migrations, seed data and tests run automatically in Staging before Production.

## Quality and testing strategy

- **Unit tests** for money, currency conversion, rounding, tax and payroll calculations.
- **Accounting accuracy tests:** scenarios worked out by hand by an accountant (sales, refunds, split tender, FX gains/losses, stock valuation) must match ZimERP's results exactly.
- **Database tests:** RLS isolation, permission checks, stock-never-negative, document numbering.
- **End-to-end tests:** sign-up to first sale, offline POS session, Paynow flows (test environment), store order to ERP.
- **Performance budget:** ERP screens usable on a mid-range Android phone on 3G; store pages ≥ 85 mobile Lighthouse score.
- **Release gate:** no deploy to Production unless all of the above pass in Staging.

## Reliability and disaster recovery

| Target | Value |
|---|---|
| Uptime (paid plans) | 99.5% monthly (Enterprise SLA may be higher) |
| Recovery time objective (back online after a major failure) | 4 hours |
| Recovery point objective (maximum data loss) | 15 minutes (point-in-time recovery) |
| Backups | Daily encrypted backups plus point-in-time recovery, copy in a second region, monthly restore test |

Offline-first POS keeps shops selling during a platform outage; queued sales sync when service returns.
