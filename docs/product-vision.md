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

## Email hosting (Microsoft 365)

Companies get professional mailboxes on their own domain (e.g. `sales@company.co.zw`) through **Microsoft 365**, resold by ZimboBuz. We do not run our own mail servers.

### How we resell it
- Join the **Microsoft AI Cloud Partner Program** and sell through the **Cloud Solution Provider (CSP)** programme, starting as an **indirect reseller** through an authorised Microsoft distributor (direct billing needs a much larger business).
- Each customer company gets **its own Microsoft 365 tenant**; ZimboBuz manages it through a **GDAP** (granular delegated admin) relationship the customer approves.
- Plans offered (check current names and prices with the distributor): **Exchange Online** (email only, cheapest), **Microsoft 365 Business Basic** (email, Teams, OneDrive, web Office), **Business Standard** (adds desktop Office apps), **Business Premium** (adds advanced security and device management).

### ZimboBuz integration
- **One-click domain setup:** because ZimboBuz manages the company's domain, it adds Microsoft's verification, MX, autodiscover, SPF, DKIM and DMARC records automatically.
- **Mailboxes driven by HR:** adding an employee in the ERP creates their Microsoft 365 user and assigns a licence; marking them as left blocks sign-in, converts the mailbox to shared, forwards it to their manager and frees the licence (via Microsoft Graph).
- **Sign in with Microsoft:** staff log in to the ERP with their Microsoft 365 account (Entra ID single sign-on), so one password covers email and ERP.
- **ERP emails from the company's own mailbox:** invoices, quotes, statements and reminders are sent from e.g. `accounts@company.co.zw` through Microsoft Graph, so replies land in their Outlook. A transactional service (e.g. Resend, already used in Bravura) remains the fallback for high-volume or no-reply mail.
- **CRM email sync:** emails with a customer appear on that customer's record; Outlook calendar events sync with CRM activities and HR leave.
- **Documents and Teams (later):** attach OneDrive/SharePoint files to ERP records; post approvals and alerts to a Teams channel.
- **Website forms** deliver to the right mailbox and create a CRM lead.

### Pricing idea (not decided)
- Microsoft licence cost plus a ZimboBuz margin, billed monthly with the ERP subscription (one invoice, payable by EcoCash or card)
- Bundles such as "Website + store + 5 mailboxes"
- Once-off migration fee for moving mail from an existing host (cPanel, Gmail, other)
- Licences are billed in USD by Microsoft; ZiG pricing follows the company's exchange-rate policy

## Hosting and domains

### Platform hosting

**Decision:** build and test **locally on the owner's computer**; move to **Microsoft Azure (South Africa North, Johannesburg)** when ZimboBuz is ready to sell.

#### Phase 1: building (owner's computer)
- The code lives in the private GitHub repository; AI sessions write and push code there, and the owner pulls it to run on their computer.
- Runs locally with free tools: **Node.js** for the app, **Docker Desktop** and the **Supabase CLI** for a full local database, logins, file storage and server functions (the same stack used by Bravura and Bromadex, so it moves to self-hosted Supabase on Azure unchanged).
- Costs nothing beyond the computer and internet.
- **Limits:** only the owner can use it; a home computer has no fixed public address and goes down with load-shedding, so it is not suitable for real customers. For showing it to others, use a temporary online preview (e.g. a free Vercel/Supabase project or a short-lived Azure setup) rather than exposing the home computer to the internet.
- Keep regular backups of the local database and push code to GitHub often, so nothing is lost if the computer fails.

#### Phase 2: commercial launch (Azure, Johannesburg)
- **Why Azure:** same Microsoft partnership (CSP) as Microsoft 365 email, margin on resold Azure usage, data centre in South Africa close to Zimbabwe, staff sign in with Microsoft 365 (Entra ID), trusted by enterprise customers, possible startup credits (check Microsoft for Startups terms).
- **Target setup:**

| Need | Azure service |
|---|---|
| Websites, stores, ERP screens | Azure Static Web Apps / App Service / Container Apps behind Azure Front Door (custom domains, automatic SSL, CDN) |
| Server code | Azure Functions or Container Apps |
| Database, logins, storage | Self-hosted Supabase on Azure, or Azure Database for PostgreSQL + Entra ID + Blob Storage |
| DNS | Azure DNS |
| Backups and monitoring | Azure Backup, Azure Monitor |

- All companies share one platform; only **Enterprise** customers get a dedicated Azure setup (own database and app), priced at a premium.

#### Building for the move (rules from day one)
So the move from the local setup to Azure is a migration, not a rewrite:
- **Standard PostgreSQL only:** all schema, security rules (RLS) and business logic in SQL migration files kept in the repository, so they run unchanged on self-hosted Supabase or Azure PostgreSQL.
- **No provider-only features** (e.g. Vercel KV or Edge Config, cloud-specific cron or image services) unless wrapped behind our own small adapter.
- **Wrap provider services behind adapters:** file storage, email sending, auth/sign-in, background jobs and DNS each go through one ZimboBuz module, so only that module changes when moving to Azure.
- **Configuration through environment variables**, never hard-coded URLs or keys.
- **Container-ready:** the app and server functions can be packaged as Docker containers.
- **Rehearse the move:** before launch, restore a copy of the database and files on Azure, run the full test suite there and measure speed from Harare and Bulawayo.

#### Phase 3: local hosting (Enterprise, on request)
For customers requiring data in Zimbabwe: a private install in a Zimbabwean data centre, or on the customer's own servers with a licence key.

#### Not offered
No plain cPanel web hosting at launch; customer websites are hosted as part of ZimboBuz.

### Domain sales (feeds website, ERP and Microsoft 365 setup)
ZimboBuz sells domains, and the domain becomes the backbone of each company's setup.

- **What we sell:** Zimbabwean domains (`.co.zw`, `.org.zw`, `.ac.zw`) through **[name.co.zw](https://name.co.zw/)**, and `.com`, `.africa`, `.net` etc. through an international registrar with an API.
- **Registered in the customer's name** so they own it; ZimboBuz manages the DNS.
- **Customers can also bring an existing domain:** they point its nameservers to ZimboBuz, or we transfer it in.
- **Yearly renewals** give recurring income; automatic renewal reminders by email and WhatsApp, renewal billed with the subscription.

### Local registrar: name.co.zw
- Registers `.co.zw`, `.org.zw` and `.ac.zw`; from US$5.99/year or ZiG equivalent; pays via Paynow (verified merchant); nameserver changes are instant. Operated by Web Enchanter (Pvt) Ltd.
- Its website lists no reseller programme, no API and no hosting; it is used for domain registration only.
- **How automation still works:** register the domain at name.co.zw in the customer's name, point its nameservers to ZimboBuz-managed DNS (Azure DNS or Cloudflare) once, then ZimboBuz adds every record automatically. Without an API, registration itself is a manual step done by the ZimboBuz team when an order comes in.

**Questions to ask name.co.zw:**
1. Do you have a reseller or partner account, and what are the wholesale prices per domain type?
2. Is there an API for checking availability, registering, renewing and changing nameservers?
3. Can domains be registered in the customer's name while managed from our reseller account?
4. Can renewals be automatic and billed to our account, and how far in advance are renewal reminders sent?
5. Can we set custom nameservers at registration, so domains point to ZimboBuz DNS from day one?
6. How are transfers handled (into name.co.zw from another registrar, and out if a customer leaves)?
7. What documents does the registry require for `.co.zw` (company registration, ID), and how long does approval take?
8. Can we pay in USD and ZiG on account, and do you invoice monthly?
9. What support do you offer partners (contact person, response times)?

### One-click setup flow
1. Company searches for and buys a domain inside ZimboBuz (or connects an existing one); `.co.zw` orders are registered at name.co.zw.
2. ZimboBuz creates the DNS zone and adds website, store and ERP records (`company.co.zw`, `www`, `erp`) with SSL.
3. ZimboBuz creates the company's **Microsoft 365 tenant**, adds the domain to it and publishes Microsoft's verification record automatically, then completes verification.
4. ZimboBuz adds the email records: MX, autodiscover, SPF, DKIM and DMARC.
5. Mailboxes are created from the ERP's HR employee list, and staff can sign in to the ERP with their Microsoft account.
6. The setup screen shows a checklist with live status (domain active, website live, SSL issued, Microsoft verified, email flowing).

### Data, law and reliability
- **Zimbabwe Cyber and Data Protection Act (2021)**, with POTRAZ as the data protection authority: take legal advice on cross-border data transfer and include a data processing agreement in customer contracts.
- **Local hosting option (Enterprise):** for government, banks and mining companies that require data in Zimbabwe, run in a local data centre or on the customer's servers with a licence key.
- **Backups:** daily automatic backups with point-in-time restore, plus a "download all my data" export per company.
- **Reliability:** uptime monitoring, a public status page, error tracking, and a staging environment so changes are tested before reaching customers.

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
- **Secrets** live in environment settings (local `.env` during development, Azure Key Vault in production), never in the repository; `.env` files are always git-ignored.
- **Customer contracts:** terms of service and a licence agreement state that the software and website templates remain ZimboBuz property; the customer owns their own data and can export it.
- **On-premise deployments (Enterprise):** delivered as a licensed, compiled build with a licence key, not as source code.
- **Brand protection:** register the ZimboBuz name and logo as a trademark with ZIPO (Zimbabwe Intellectual Property Office); register the company and own the domains in the company's name.

## How it gets built
Development is done by AI (Claude), in small testable steps, each with automated tests, reviewed and tried by the owner before moving on. Decisions are recorded in this folder so later sessions keep context.

What the owner handles:
- Accounts and credentials: Azure subscription (through the Microsoft partner/CSP relationship) before launch, domain registrar accounts (name.co.zw for `.co.zw`, and an international registrar), Microsoft partner/CSP enrolment with a distributor, Paynow merchant, ZIMRA fiscalisation registration and software approval, WhatsApp Business API, domains
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
- `.co.zw` domains are registered through name.co.zw, with nameservers pointed to ZimboBuz DNS.
- ZimboBuz sells domains; the domain drives one-click setup of the website, store, ERP and Microsoft 365.
- Build locally on the owner's computer; move to Azure (Johannesburg) for commercial launch; code stays portable (standard PostgreSQL, adapters for provider services). No plain cPanel hosting.
- Email hosting is Microsoft 365, resold through the CSP programme, with each company in its own tenant.
- ZimboBuz is proprietary and closed source; no GPL/AGPL code is copied in.
- Build on the Bromadex and Bravura codebases, converted to multi-tenant, rather than starting from scratch.

## Open questions
- Confirm release waves: which modules and features ship first?
- Do the mobile apps include every module, or daily tasks only (POS, stock, approvals, dashboard) with the rest on the web?
- Final pricing per module, bundles, setup fees, premium app tier.
- First target industries and pilot customers (Mining and Construction is a candidate given existing modules).
- Technical approach to multi-tenancy: shared database with a company id on every row, or a separate database per company.
