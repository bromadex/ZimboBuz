# ZimboBuz Product Vision

Status: brainstorming. This records decisions made so far; nothing here is built yet.

## Pitch

One Zimbabwean business platform with every feature competitors offer (see [erp-feature-research.md](erp-feature-research.md)), ZiG-ready, offline-capable, with transparent pricing, sold under each company's own brand.

## What a company gets

### 1. Public side (web only, for the company's customers)
- **Website:** choose from ~5 templates, connect their own domain, set logo and colours, edit pages with a drag-and-drop editor.
- **Online store:** template-based, connected to ERP stock and prices, takes ZiG/USD and Paynow.
- No customer-facing mobile app.

### Website and store design direction
Websites and stores must look as modern as possible and use motion throughout.

- **Each of the ~5 templates has its own motion style**, e.g. corporate (calm fades and slides), bold (large type reveals, parallax), product/store (image zooms, card lifts), creative (scroll-driven storytelling).
- **Hero animations:** animated backgrounds (like the Bromadex "power grid" network canvas), animated headlines, subtle video or gradient motion, recoloured automatically to the company's brand colours.
- **Scroll motion:** sections and cards reveal as you scroll, staggered lists, parallax layers, sticky scroll-driven sections, animated number counters.
- **Page transitions:** smooth transitions between pages and shared-element transitions (product card expands into the product page).
- **Micro-interactions:** buttons press in, cards lift on touch/hover, add-to-cart flies to the cart icon, animated toasts, loading skeletons instead of spinners.
- **Store motion:** image galleries with swipe and zoom, quantity steppers that animate, cart drawer slides in, animated checkout/quote progress.
- **Motion setting per company:** Off / Subtle / Rich, editable in the customisation interface; drag-and-drop blocks each carry an optional entrance animation.
- **Fast on cheap phones and expensive data:** animations use CSS transforms and opacity (GPU-friendly), pause when off screen or in a background tab, images are lazy-loaded and compressed, and the site stays fully usable before animation scripts load.
- **Accessibility:** respect the device's "reduce motion" setting (already done in Bromadex's motion code); nothing important is shown only through animation.

### 2. ERP (admin side, for the company's staff)
- Web app plus mobile apps, used by owners and staff only.
- **Modules are chosen by the company** (POS, inventory, payroll, etc.).
- **Features within each module are toggled individually** (e.g. POS: split tender on, lay-bys off, credit book on).
- Branded with the company's name, logo and colours.

## Setup and customisation
- A customisation interface for branding, templates, pages, modules and features.
- The company chooses: **do it themselves** (self-service) or **done for you** (paid setup service).

## Mobile app distribution

The home-screen name of an app is fixed at build time, so one shared store app cannot rename itself per company. Chosen approach:

| Tier | Delivery | Branding |
|---|---|---|
| All plans | Installable web app (PWA) from the company's own ERP domain, e.g. `erp.company.co.zw` | Company name and icon on the home screen; no app store needed |
| Premium | Automatically built Android APK (direct download, optionally Play Store) | Company name and icon |
| Premium | iOS app distributed privately to the company's staff via Apple Business Manager (Custom Apps) | Company name and icon; company needs an Apple account (can be arranged as part of "done for you") |

Inside every version, the company's logo, colours, modules and features load after login.

## Module catalogue

Modules come from the consolidated list in [erp-feature-research.md](erp-feature-research.md). Each module has its own feature toggles.

- **Core (always on):** companies and branches, users and roles, currencies and company-set exchange rates, customers, suppliers, products, basic accounting
- **Commerce:** POS, sales and invoicing, inventory and warehouses, purchasing, CRM and campaigns (SMS, email, WhatsApp)
- **Finance and people:** full accounting, budgets, fixed assets, expenses, payroll (PAYE, NSSA, AIDS Levy, ZIMDEF), tax returns, ZIMRA fiscalisation
- **Operations:** manufacturing, projects, quality, assets and maintenance, helpdesk, subscription billing
- **Industry:** healthcare, microfinance, hospitality, garages, fleet and logistics, farming
- **Platform:** website builder, online store, reports and dashboards, integrations and API, AI features

### Proposed release waves (idea, not decided)
1. Core, POS, inventory, sales and invoicing, Paynow, website and store templates
2. Purchasing, payroll, tax returns, ZIMRA fiscalisation
3. CRM, projects, manufacturing, helpdesk
4. Industry modules, AI features, IoT

Each wave ships and earns money while the next is built.

## Staff app scope (idea, not decided)
The mobile app focuses on daily tasks; heavy work (full accounting, payroll runs, website editing, large reports) stays on the web app.
- POS, offline-capable, on low-cost Android phones with Bluetooth receipt printers
- Stock counts and camera barcode scanning
- Approvals: purchase orders, leave, expenses
- Owner dashboard: sales by currency, cash, debtors, low stock
- Notifications: low stock, large sales, till short at close

## Pricing ideas (not decided)
- Free: core plus one module, one user
- Roughly $10–20/month per extra module
- Bundles (e.g. Retail, Manufacturing, Hospitality) cheaper than separate modules
- Once-off setup fee for "done for you" (domain, design, data import)
- Premium tier for branded APK and iOS apps
- Prices shown in USD and ZiG, payable monthly by EcoCash or card
- Benchmark: Unicorn Solutions charges $200–1,000/month

### Other revenue ideas
- Small fee per Paynow/EcoCash transaction
- Hardware resale: receipt printers, barcode scanners
- Data migration and custom development
- Referral fees from lenders using sales data (with the company's consent)

## Go-to-market ideas
- Pilot: 5–10 businesses free for a month in exchange for feedback and testimonials
- Accountants and bookkeepers as resellers (commission or free access)
- Commission-based field agents who sign up and set up shops
- WhatsApp for marketing and support
- Talk to 15–20 business owners before building each wave

## Differentiator ideas
- ZiG/USD split tender and change-shortage handling (store credit, vouchers, mobile-money refunds)
- Offline-first operation for load-shedding
- WhatsApp receipts, invoices, debt reminders and daily owner summaries
- Diaspora purchasing: relatives abroad pay, family collects in store
- Supplier ordering network: reorder from wholesalers inside the app
- Sales history to support loan applications
- Plain-language AI assistant ("how much did I make this week?")

## Existing work to build on

Two of the owner's existing projects already cover much of ZimboBuz for a single company. Their modules are adapted rather than rewritten; the main new work is making everything **multi-tenant** (many companies on one platform, each with its own data, branding, modules, features and domain).

### Bromadex website (website + store + ERP for one company)
- Public website: home, services, about, projects portfolio, contact (React + Tailwind)
- Online store: categories, products, cart that generates a **quotation PDF** sent via WhatsApp
- ERP: finance (invoices, payments, expenses), procurement, inventory, CRM/sales pipeline, store admin
- Database-enforced rules: stock changes only through movements and never goes negative; purchase orders follow a fixed status flow with weighted-average costing on receipt; invoice totals and balances kept by triggers; customers de-duplicated by email or phone; **every website quote request opens a CRM lead**

### Bravura ERP (multi-site mining and camp operations)
- Finance (GL, bank reconciliation, statements, cost centres, automatic postings from other modules), procurement, inventory, fuel, fleet, HR and payroll with statutory returns, contractors, campsite, meals, SHEQ (~35 screens), projects, DocShare, Connect (internal chat), governance (announcements, policies)
- **Ask Bravura:** AI assistant that can only call read-only, permission-checked database functions as the asking user, logs every question, supports voice notes
- Approval routes and inbox, notification centre, AI daily brief, scheduled email reports, fuel flow-meter ingest (IoT), command palette with screen codes, installable PWA, public supplier order confirmation page
- Offline stores prototype (local browser storage, QR scanning)

### Ideas carried into ZimboBuz
1. **Website → store → quote → ERP lead:** every enquiry on a company's website becomes a lead in its ERP. A headline selling point.
2. **"Add to quote" as well as "Buy" in the store:** a store feature toggle for businesses that quote rather than sell at fixed prices (hardware, engineering, wholesale).
3. **Quotation and invoice PDFs sent by WhatsApp.**
4. **Permission-safe AI assistant (Ask):** the AI only sees what the asking user is allowed to see.
5. **Shared platform services for every module:** approval routes, notification centre, AI daily brief, scheduled email reports, audit log.
6. **Multi-site with head-office view:** HQ buys and pays centrally, each transaction names the destination site.
7. **Shared document viewer and controlled documents** (versions, approvals, acknowledgements, expiry) usable from any module.
8. **Mining and Construction bundle:** SHEQ, fleet, fuel, contractors, campsite, meals, batch plant. An industry no competitor targets directly.
9. **Engineering standards:** no hard deletes (archive only), audit trail on every record, permission checks enforced in the database, screen codes and a command palette.

## Ownership and licensing

ZimboBuz is **proprietary, closed-source software**. Customers rent access (SaaS); they never receive the source code.

- **Repositories private:** ZimboBuz, Bromadex and Bravura repositories must be private on GitHub. Only people under a written agreement (NDA and IP assignment) get access.
- **No copyleft code:** do not copy code from GPL/AGPL projects such as ERPNext/Frappe or Odoo Community into ZimboBuz. They can be studied for ideas only. Prefer libraries under MIT, BSD, Apache 2.0 or ISC licences, and check every new dependency's licence before adding it.
- **Business logic stays on the server:** pricing, tax, payroll and fiscalisation rules run in the database and server functions, not in browser or app code that can be copied.
- **Mobile apps and PWA** ship only compiled, minified front-end code; secrets never go into app builds.
- **Secrets** live in environment settings (Supabase, Vercel), never in the repository; `.env` files are always git-ignored.
- **Customer contracts:** terms of service and a licence agreement state that the software and website templates remain ZimboBuz property; the customer owns their own data and can export it.
- **On-premise deployments (Enterprise):** delivered as a licensed, compiled build with a licence key, not as source code.
- **Brand protection:** register the ZimboBuz name and logo as a trademark with ZIPO (Zimbabwe Intellectual Property Office); register the company and own the domains in the company's name.

## How it gets built
Development is done by AI (Claude), in small testable steps, each with automated tests, reviewed and tried by the owner before moving on. Decisions are recorded in this folder so later sessions keep context.

What the owner handles:
- Accounts and credentials: Paynow merchant, ZIMRA fiscalisation registration and software approval, WhatsApp Business API, domains, hosting (Supabase and Vercel are connected)
- Testing with real businesses
- Sales, onboarding and support
- Product decisions: priorities, pricing, when something is ready to ship
- Legal: company registration, terms of service, data protection

## Decisions log
- Exchange rates are set by each company (no automatic RBZ feed).
- Interface is English only.
- Mobile apps are for staff (ERP) only, not for customers.
- PWA for everyone; branded APK/iOS builds on a premium plan.
- Websites and stores are as modern as possible, with motion throughout (per-template motion styles, company-controlled intensity, fast on low-end phones).
- ZimboBuz is proprietary and closed source; no GPL/AGPL code is copied in.
- Build on the Bromadex and Bravura codebases, converted to multi-tenant, rather than starting from scratch.

## Open questions
- Confirm release waves: which modules and features ship first?
- Do the mobile apps include every module, or daily tasks only (POS, stock, approvals, dashboard) with the rest on the web?
- Final pricing per module, bundles, setup fees, premium app tier.
- First target industries and pilot customers (Mining and Construction is a candidate given existing modules).
- Technical approach to multi-tenancy: shared database with a company id on every row, or a separate database per company.
