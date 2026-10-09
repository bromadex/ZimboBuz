# ZimERP Product Vision

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

Companies get professional mailboxes on their own domain (e.g. `sales@company.co.zw`) through **Microsoft 365**, resold by ZimERP. We do not run our own mail servers.

### How we resell it
- Join the **Microsoft AI Cloud Partner Program** and sell through the **Cloud Solution Provider (CSP)** programme, starting as an **indirect reseller** through an authorised Microsoft distributor (direct billing needs a much larger business).
- Each customer company gets **its own Microsoft 365 tenant**; ZimERP manages it through a **GDAP** (granular delegated admin) relationship the customer approves.
- Plans offered (check current names and prices with the distributor): **Exchange Online** (email only, cheapest), **Microsoft 365 Business Basic** (email, Teams, OneDrive, web Office), **Business Standard** (adds desktop Office apps), **Business Premium** (adds advanced security and device management).

### ZimERP integration
- **One-click domain setup:** because ZimERP manages the company's domain, it adds Microsoft's verification, MX, autodiscover, SPF, DKIM and DMARC records automatically.
- **Mailboxes driven by HR:** adding an employee in the ERP creates their Microsoft 365 user and assigns a licence; marking them as left blocks sign-in, converts the mailbox to shared, forwards it to their manager and frees the licence (via Microsoft Graph).
- **Sign in with Microsoft:** staff log in to the ERP with their Microsoft 365 account (Entra ID single sign-on), so one password covers email and ERP.
- **ERP emails from the company's own mailbox:** invoices, quotes, statements and reminders are sent from e.g. `accounts@company.co.zw` through Microsoft Graph, so replies land in their Outlook. A transactional service (e.g. Resend, already used in Bravura) remains the fallback for high-volume or no-reply mail.
- **CRM email sync:** emails with a customer appear on that customer's record; Outlook calendar events sync with CRM activities and HR leave.
- **Documents and Teams (later):** attach OneDrive/SharePoint files to ERP records; post approvals and alerts to a Teams channel.
- **Website forms** deliver to the right mailbox and create a CRM lead.

### Pricing idea (not decided)
- Microsoft licence cost plus a ZimERP margin, billed monthly with the ERP subscription (one invoice, payable by EcoCash or card)
- Bundles such as "Website + store + 5 mailboxes"
- Once-off migration fee for moving mail from an existing host (cPanel, Gmail, other)
- Licences are billed in USD by Microsoft; ZiG pricing follows the company's exchange-rate policy

## Hosting and domains

### Platform hosting

**Decision:** build and test on **Vercel + Supabase**; move to **Microsoft Azure (South Africa North, Johannesburg)** when ZimERP is ready to sell.

#### Phase 1: building (Vercel + Supabase)
- Vercel serves websites, stores and ERP screens; Supabase provides the database, logins, file storage and server functions. Both are already connected and used by Bravura and Bromadex.
- Cheap and fast to iterate: roughly $50–100/month.
- Used for development, demos and pilot customers.

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
So the switch from Vercel + Supabase to Azure is a migration, not a rewrite:
- **Standard PostgreSQL only:** all schema, security rules (RLS) and business logic in SQL migration files kept in the repository, so they run unchanged on self-hosted Supabase or Azure PostgreSQL.
- **No Vercel-only features** (Vercel KV, Edge Config, Vercel-specific image or cron services) unless wrapped behind our own small adapter.
- **Wrap provider services behind adapters:** file storage, email sending, auth/sign-in, background jobs and DNS each go through one ZimERP module, so only that module changes when moving to Azure.
- **Configuration through environment variables**, never hard-coded URLs or keys.
- **Container-ready:** the app and server functions can be packaged as Docker containers.
- **Rehearse the move:** before launch, restore a copy of the database and files on Azure, run the full test suite there and measure speed from Harare and Bulawayo.

#### Phase 3: local hosting (Enterprise, on request)
For customers requiring data in Zimbabwe: a private install in a Zimbabwean data centre, or on the customer's own servers with a licence key. See **On-premise deployment** below.

#### Not offered
No plain cPanel web hosting at launch; customer websites are hosted as part of ZimERP.

### Backend choice: Supabase and alternatives

**Decision:** stay on **Supabase** (PostgreSQL, logins, storage, realtime, server functions).

Why:
- Bravura and Bromadex are already built on it, so their code, RLS security rules and SQL logic carry over.
- It is standard PostgreSQL underneath, so there is no lock-in.
- Apache 2.0 licence: can be self-hosted on Azure or a client's server for a closed-source product.
- The Azure move is either self-hosted Supabase on Azure or Azure PostgreSQL with our SQL migrations.

Alternatives considered:

| Option | What it is | Fit |
|---|---|---|
| Firebase (Google) | NoSQL database, auth, storage, functions; strong offline | Poor: no SQL for accounting/reports, Google lock-in, no Azure path, existing code would not carry over |
| Appwrite | Open-source, self-hostable backend | Fair: runs on Azure, but its database is weaker than PostgreSQL for ERP work |
| Nhost | PostgreSQL + Hasura GraphQL + auth + storage | Fair: PostgreSQL-based but smaller vendor and a different way of working |
| Convex | Reactive TypeScript backend | Poor: proprietary database, lock-in, no Azure path |
| PocketBase | Single binary with SQLite | Poor: too small for a multi-company ERP |
| AWS Amplify | Amazon's backend platform | Poor: ties to AWS while the target is Azure |
| Build our own | Azure PostgreSQL or Neon + Entra ID / Better Auth / Auth.js + Azure Blob + Node API with Drizzle or Prisma | Strongest long-term control and cleanest Azure fit, but slower to build and more rework of existing code |

### Offline sync: PowerSync

For offline-first POS and staff apps (load-shedding, expensive data), add **PowerSync**:
- Keeps a local SQLite copy of the data each user needs on their phone, tablet or browser, and syncs changes both ways with PostgreSQL when the connection returns.
- Works with Supabase and with any PostgreSQL, so it continues to work after the move to Azure and for on-premise installs (PowerSync can be self-hosted; check its licence terms for closed-source commercial use before committing).
- Sync rules decide what each device holds (e.g. only that branch's products, prices and today's sales), keeping data use small.
- Offline writes (sales, stock counts) go into an upload queue; server-side rules validate them and resolve conflicts (e.g. stock never negative, ZIMRA receipt numbering).
- Alternative considered: **ElectricSQL** (similar PostgreSQL sync); revisit if PowerSync's terms or pricing don't fit.

### On-premise deployment (client's own server)

Supabase is open source (Apache 2.0) and self-hostable, so building on Supabase does not prevent clients from keeping their data on their own servers.

#### How it works
- The client's server runs **self-hosted Supabase in Docker** (database, logins, storage, server functions) plus the **ZimERP app as a Node.js/Docker service**.
- The **same SQL migrations, security rules and functions** as the cloud version: one product, not a separate fork.
- This only works if the app avoids hosting-provider-only features (see "Building for the move").

#### What changes compared with cloud
| Area | Cloud | Client's own server |
|---|---|---|
| Backups | Automatic | Must be set up: daily backups plus an off-server copy |
| Updates | Deployed once for everyone | Each install updated separately, via an automated update script |
| Security | Managed by the provider | Firewall, SSL, OS patches and access control are ZimERP's or the client's IT team's job (agreed in the contract) |
| Power and internet | Data-centre grade | Needs a UPS or generator and a stable connection; load-shedding is a real risk |
| Extras | Full managed dashboard and features | A few managed-only extras (e.g. database branching) are unavailable; core features work |

#### Protecting closed-source code
On a client's server, their IT staff can access the database, including SQL functions and security rules, and the minified app code. Protection:
1. **Licence agreement:** no copying, reverse-engineering or resale, with penalties.
2. **Licence key** checked regularly, with expiry tied to payment.
3. **Keep the most valuable logic off the client's server:** run it in a compiled service or call ZimERP cloud services for it (e.g. ZIMRA fiscalisation, payment integrations, AI).
4. **Enterprise pricing** that covers the risk and extra support.

#### Responsibilities (set in the contract)
- **ZimERP:** installation, updates, licence management, application support, remote monitoring.
- **Client:** server hardware, power backup, internet, physical security, and either their own IT for OS/network or a paid ZimERP managed-service add-on.
- **Remote access** for ZimERP support (VPN or secure tunnel) agreed up front.

#### Server requirements (rough guide, size to real users and data)
- Linux server or virtual machine with Docker
- About 4–8 CPU cores, 16 GB RAM, fast SSD storage for a mid-sized company
- UPS, off-site backups, remote access for support

### Domain sales (feeds website, ERP and Microsoft 365 setup)
ZimERP sells domains, and the domain becomes the backbone of each company's setup.

- **What we sell:** Zimbabwean domains (`.co.zw`, `.org.zw`, `.ac.zw`) through **[name.co.zw](https://name.co.zw/)**, and `.com`, `.africa`, `.net` etc. through an international registrar with an API (Vercel can register many generic domains).
- **Registered in the customer's name** so they own it; ZimERP manages the DNS.
- **Customers can also bring an existing domain:** they point its nameservers to ZimERP, or we transfer it in.
- **Yearly renewals** give recurring income; automatic renewal reminders by email and WhatsApp, renewal billed with the subscription.

### Local registrar: name.co.zw
- Registers `.co.zw`, `.org.zw` and `.ac.zw`; from US$5.99/year or ZiG equivalent; pays via Paynow (verified merchant); nameserver changes are instant. Operated by Web Enchanter (Pvt) Ltd.
- Its website lists no reseller programme, no API and no hosting; it is used for domain registration only.
- **How automation still works:** register the domain at name.co.zw in the customer's name, point its nameservers to ZimERP-managed DNS (Vercel DNS or Cloudflare) once, then ZimERP adds every record automatically. Without an API, registration itself is a manual step done by the ZimERP team when an order comes in.

**Questions to ask name.co.zw:**
1. Do you have a reseller or partner account, and what are the wholesale prices per domain type?
2. Is there an API for checking availability, registering, renewing and changing nameservers?
3. Can domains be registered in the customer's name while managed from our reseller account?
4. Can renewals be automatic and billed to our account, and how far in advance are renewal reminders sent?
5. Can we set custom nameservers at registration, so domains point to ZimERP DNS from day one?
6. How are transfers handled (into name.co.zw from another registrar, and out if a customer leaves)?
7. What documents does the registry require for `.co.zw` (company registration, ID), and how long does approval take?
8. Can we pay in USD and ZiG on account, and do you invoice monthly?
9. What support do you offer partners (contact person, response times)?

### One-click setup flow
1. Company searches for and buys a domain inside ZimERP (or connects an existing one); `.co.zw` orders are registered at name.co.zw.
2. ZimERP creates the DNS zone and adds website, store and ERP records (`company.co.zw`, `www`, `erp`) with SSL.
3. ZimERP creates the company's **Microsoft 365 tenant**, adds the domain to it and publishes Microsoft's verification record automatically, then completes verification.
4. ZimERP adds the email records: MX, autodiscover, SPF, DKIM and DMARC.
5. Mailboxes are created from the ERP's HR employee list, and staff can sign in to the ERP with their Microsoft account.
6. The setup screen shows a checklist with live status (domain active, website live, SSL issued, Microsoft verified, email flowing).

### Data, law and reliability
- **Zimbabwe Cyber and Data Protection Act (2021)**, with POTRAZ as the data protection authority: take legal advice on cross-border data transfer and include a data processing agreement in customer contracts.
- **Local hosting option (Enterprise):** for government, banks and mining companies that require data in Zimbabwe, run in a local data centre or on the customer's servers with a licence key.
- **Backups:** daily automatic backups with point-in-time restore, plus a "download all my data" export per company.
- **Reliability:** uptime monitoring, a public status page, error tracking, and a staging environment so changes are tested before reaching customers.

## Payments

Payments flow in two directions: a company's customers paying the company, and companies paying ZimERP.

### 1. Customers paying companies (store, POS, invoices)

**Primary gateway: Paynow.** One integration covers EcoCash, OneMoney, InnBucks, Zimswitch (local bank cards) and Visa/Mastercard, in USD and ZiG.
- **Store and invoices:** "Pay now" button or payment link to Paynow; the invoice/order is marked paid automatically when Paynow confirms.
- **POS:** EcoCash express checkout: the cashier enters the customer's number and the customer approves with their PIN on their phone.
- **QR codes and payment links** on invoices, receipts, quotes and WhatsApp messages.

**Later options:**
- **Pesepay** (another Zimbabwean gateway) as a backup or for fee comparison
- **Direct EcoCash merchant API** for very high-volume companies wanting lower fees
- **Bank card terminals:** recorded as "card" at first; integrate with a bank's terminal later if the bank allows
- **ZIPIT and bank transfers:** recorded and matched against imported bank statements
- **Cash** in USD and ZiG with per-currency till sessions (see P1 features)

Stripe and most international gateways do not serve Zimbabwean merchants, so local gateways are the priority.

#### Who holds the money
**Decision (recommended): each company connects its own Paynow account; money goes straight to the company and ZimERP never holds funds.**
- Avoids ZimERP needing Reserve Bank of Zimbabwe approval as a payment operator (National Payment Systems Act); take legal advice before ever holding customer funds.
- Companies trust it more.
- Setup: the company enters its Paynow integration ID and key in the customisation interface (stored encrypted, server-side only), or the ZimERP team helps them register with Paynow as part of "done for you".

#### What ZimERP does with every payment
- Receives Paynow's result notification and **marks the invoice/order paid**; re-checks status by polling if a notification is missed.
- **Matches payments to invoices**, including partial payments and deposits; unmatched payments go to a review list.
- **Records gateway fees and IMTT** (intermediated money transfer tax) as expenses in the right currency.
- **Daily settlement report:** what Paynow reports versus what reached the bank.
- Handles refunds, and change given as store credit or an EcoCash refund.
- Every gateway goes through one **payment adapter** module, so adding Pesepay or EcoCash direct does not touch the rest of the system.

### 2. Companies paying ZimERP (subscriptions)
- **One monthly invoice** covering ERP modules, Microsoft 365 mailboxes, domains and premium apps, sent by WhatsApp and email with a Paynow link.
- **Payment methods:** EcoCash, OneMoney, InnBucks, local cards, Visa/Mastercard (useful for diaspora-owned businesses) and bank transfer.
- **Automatic reminders** before and after the due date.
- **Grace period, then read-only mode.** Never delete data or block data export for non-payment.
- **Annual prepayment discount** for cash flow and exchange-rate protection.
- **Priced in USD**, ZiG accepted at ZimERP's published rate.
- **Per-transaction fees:** because money goes straight to companies, ZimERP cannot easily take a cut; build the value into subscription pricing, or ask Paynow about a partner/referral arrangement.

### Questions to ask Paynow
1. Is there a partner, reseller or referral programme for platforms that onboard many merchants?
2. Can a platform onboard merchants on their behalf (documents, approval time)?
3. Which methods support express checkout (EcoCash, OneMoney, InnBucks), in USD and ZiG?
4. Fees per method and currency, and settlement times to the bank.
5. Is there a sandbox/test environment and webhook (result URL) documentation?
6. Is recurring billing or tokenised card payment supported for subscriptions?
7. Is there a settlement/transactions report or API for automatic reconciliation?

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

## Pricing (proposal, to validate with pilot customers)

Benchmark: Unicorn Solutions publishes $200 / $500 / $1,000 per month. All figures below are USD and are a starting proposal.

**Structure:** a plan per company with users and modules included, plus add-ons. Pure per-user pricing scares small shops; pure per-module pricing is confusing.

### Plans (per company, per month)

| Plan | Price | Users | Modules | Includes |
|---|---|---|---|---|
| Starter | Free | 1 | Core + 1 (POS or invoicing) | ZimERP subdomain (`shop.zimerp.co.zw`), 1 website template with "Powered by ZimERP" badge, PWA |
| Business | $29 | 5 | 3 | Own domain, website + store, Paynow, WhatsApp receipts, ZiG/USD |
| Growth | $79 | 15 | 6 | 2 branches, approvals, advanced reports, AI assistant (basic), priority support |
| Pro | $199 | 50 | All standard modules | 5 branches, branded Android app, API, custom workflows |
| Enterprise | From $499 | Unlimited | All, including industry modules | Branded iOS app, dedicated setup, SLA, dedicated database, on-premise option |

### Add-ons (per month)
- Extra user: $3–5
- Extra standard module: $10–20
- Industry module (healthcare, microfinance, mining and construction, etc.): $30–50
- Extra branch: $10
- ZIMRA fiscalisation: $10–15 per till/device
- Branded Android app on lower plans: $20; branded iOS app: $40 (client also pays Apple's $99/year)
- AI assistant beyond the included allowance, and SMS bundles: usage-based

### Resold services
- Microsoft 365: Microsoft price plus about 10–20%, on the same invoice
- `.co.zw` domains: cost from $5.99/year (name.co.zw), sell at about $15–20/year; other domains at cost plus margin

### Once-off fees
- Self-service setup: free
- "Done for you" website and store setup: $150–300
- Data migration (Excel, Sage Pastel, QuickBooks): $100–500 depending on size
- On-site training: per day
- On-premise install: setup fee plus annual licence (e.g. from $5,000/year), support priced separately

### Rules
- Annual prepayment: 2 months free
- Prices in USD; ZiG accepted at ZimERP's published rate, reviewed monthly
- Founding customers (first 20–50) keep launch pricing for life in exchange for feedback and testimonials
- Discounts for NGOs, schools and startups
- Accountant/bookkeeper partners: 20% recurring commission on referred clients, or free ZimERP for their own practice
- Starter (free) plan is self-service only, to keep support costs down

### Sanity check
- Hosting cost per company is cents to a few dollars a month; support time is the real cost.
- 100 companies at an average ~$60/month ≈ $6,000/month; 500 companies ≈ $30,000/month, plus setup fees, domains and Microsoft 365 margin.
- Validate by showing pilot customers the plan table: which would they choose, and what is missing?

### Other revenue
- Hardware resale: receipt printers, barcode scanners, cash drawers, low-cost Android tablets
- Custom development and integrations
- Paynow partner/referral arrangement, if available (ZimERP does not take a cut of transactions)
- Lender referral fees using sales data, only with the company's consent

## Marketing and go-to-market

### Message
**Headline:** "Run your whole business in one place: ZiG and USD, EcoCash, ZIMRA, website and email. Built for Zimbabwe."

Three proof points, each shown in a short video:
1. ZiG/USD split-tender sale with correct change, in 10 seconds
2. EcoCash prompt on the customer's phone; the invoice marks itself paid
3. Keeps working during load-shedding, then syncs when power returns

Positioning against alternatives:
- **Exercise books and Excel:** "stop losing money to mistakes and missing stock"
- **Expensive ERPs:** "what others charge $200 for, from $29"
- **Foreign software:** "built for ZIMRA, ZiG and EcoCash, not adapted for them"

### Use it ourselves
- The ZimERP website is built on ZimERP's own templates, so the site is the demo.
- Bromadex is customer #1; with permission, Bravura is the Mining and Construction case study. Real Zimbabwean customers are proof no competitor shows.

### Channels

| Channel | Use |
|---|---|
| WhatsApp | Business account with catalogue, daily Status, broadcast list for tips and offers, replies within minutes; expected main lead source |
| Facebook and Instagram | Short proof videos, customer stories, ads targeted at business owners in Harare and Bulawayo (small daily budget to start) |
| TikTok | "Day in the life of a shop on ZimERP", ZiG/USD tips |
| Google search (SEO) | Pages and articles for "POS system Zimbabwe", "ERP Zimbabwe", "ZIMRA fiscalisation software", "ZiG accounting software" |
| LinkedIn | Mining, construction and larger companies: case studies and founder posts |
| YouTube | How-to videos that double as support material |

### Partners who bring customers
- **Accountants and bookkeepers:** 20% recurring commission (see Pricing)
- **Tax consultants and fiscal device sellers:** ZIMRA compliance creates demand
- **Hardware shops:** bundle printers, scanners and tablets with ZimERP
- **Paynow and Microsoft:** partner listings for referrals and credibility
- **Banks and microfinance lenders:** better SME records make lending easier
- **Field agents:** commission-based; set up free plans in shops and earn when they upgrade

### Events and associations
- **ZITF** (Zimbabwe International Trade Fair, Bulawayo) and **Mine Entra** (mining expo, ideal for the Mining and Construction bundle)
- Chambers and associations such as ZNCC, CZI and retailer associations: talks, workshops, member discounts
- Free workshops, e.g. "ZIMRA fiscalisation and ZiG: what your business must do"

### Turning interest into paying customers
1. Free Starter plan: sign up in 2 minutes, sell the same day
2. In-app guided setup ("add your first product") plus a WhatsApp message from a real person on day 1
3. 14-day trial of Growth features inside the free plan
4. Live demos booked on WhatsApp, in person or by video call
5. Referral reward: one month free for both the referrer and the new customer

### Launch plan
1. **Before launch:** pilot with 5–10 businesses free for a month, record video testimonials, build the website and a WhatsApp waiting list; talk to 15–20 business owners before building each wave
2. **Launch month:** founding-customer price for the first 50, press release to local business media, launch event or webinar
3. **Months 2–6:** sign accountant partners, recruit field agents, steady social content, exhibit at ZITF and Mine Entra
4. **Ongoing:** a customer story every month, SEO articles, feature launch videos

### Budget and metrics
- Start with about $200–500/month on ads plus agent commissions; increase spend only on channels that bring sign-ups.
- Track: sign-ups per week, free-to-paid conversion, cost to acquire a paying customer, monthly churn, and where each customer heard about ZimERP.

## Differentiator ideas
- ZiG/USD split tender and change-shortage handling (store credit, vouchers, mobile-money refunds)
- Offline-first operation for load-shedding
- WhatsApp receipts, invoices, debt reminders and daily owner summaries
- Diaspora purchasing: relatives abroad pay, family collects in store
- Supplier ordering network: reorder from wholesalers inside the app
- Sales history to support loan applications
- Plain-language AI assistant ("how much did I make this week?")

## Existing work to build on

Two of the owner's existing projects already cover much of ZimERP for a single company. Their modules are adapted rather than rewritten; the main new work is making everything **multi-tenant** (many companies on one platform, each with its own data, branding, modules, features and domain).

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

### Ideas carried into ZimERP
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

ZimERP is **proprietary, closed-source software**. Customers rent access (SaaS); they never receive the source code.

- **Repositories private:** ZimERP, Bromadex and Bravura repositories must be private on GitHub. Only people under a written agreement (NDA and IP assignment) get access.
- **No copyleft code:** do not copy code from GPL/AGPL projects such as ERPNext/Frappe or Odoo Community into ZimERP. They can be studied for ideas only. Prefer libraries under MIT, BSD, Apache 2.0 or ISC licences, and check every new dependency's licence before adding it.
- **Business logic stays on the server:** pricing, tax, payroll and fiscalisation rules run in the database and server functions, not in browser or app code that can be copied.
- **Mobile apps and PWA** ship only compiled, minified front-end code; secrets never go into app builds.
- **Secrets** live in environment settings (Supabase, Vercel), never in the repository; `.env` files are always git-ignored.
- **Customer contracts:** terms of service and a licence agreement state that the software and website templates remain ZimERP property; the customer owns their own data and can export it.
- **On-premise deployments (Enterprise):** delivered as a licensed, compiled build with a licence key, not as source code.
- **Brand protection:** register the ZimERP name and logo as a trademark with ZIPO (Zimbabwe Intellectual Property Office); register the company and own the domains in the company's name.

## How it gets built
Development is done by AI (Claude), in small testable steps, each with automated tests, reviewed and tried by the owner before moving on. Decisions are recorded in this folder so later sessions keep context.

What the owner handles:
- Accounts and credentials: Paynow merchant account for ZimERP subscriptions (and a partner arrangement if available), Azure subscription (through the Microsoft partner/CSP relationship) before launch, domain registrar accounts (name.co.zw for `.co.zw`, and an international registrar), Microsoft partner/CSP enrolment with a distributor, Paynow merchant, ZIMRA fiscalisation registration and software approval, WhatsApp Business API, domains, hosting (Supabase and Vercel are connected)
- Testing with real businesses
- Sales, onboarding and support
- Product decisions: priorities, pricing, when something is ready to ship
- Legal: company registration, terms of service, data protection

## Decisions log
- Payments: Paynow first; each company connects its own Paynow account so money goes straight to them and ZimERP never holds funds.
- Product name is **ZimERP** (formerly ZimboBuz). Check the name is free (ZIPO trademark search, `.co.zw`/`.com` domains, company name) before registering it.
- Exchange rates are set by each company (no automatic RBZ feed).
- Interface is English only.
- Mobile apps are for staff (ERP) only, not for customers.
- PWA for everyone; branded APK/iOS builds on a premium plan.
- Websites and stores are as modern as possible, with motion throughout (per-template motion styles, company-controlled intensity, fast on low-end phones).
- `.co.zw` domains are registered through name.co.zw, with nameservers pointed to ZimERP DNS.
- ZimERP sells domains; the domain drives one-click setup of the website, store, ERP and Microsoft 365.
- Backend stays on Supabase (PostgreSQL); PowerSync for offline sync in POS and staff apps.
- Enterprise clients can run ZimERP on their own servers using self-hosted Supabase, protected by licence agreement, licence key and keeping key logic in ZimERP cloud services.
- Build on Vercel + Supabase; move to Azure (Johannesburg) for commercial launch; code stays portable (standard PostgreSQL, adapters for provider services). No plain cPanel hosting.
- Email hosting is Microsoft 365, resold through the CSP programme, with each company in its own tenant.
- ZimERP is proprietary and closed source; no GPL/AGPL code is copied in.
- Build on the Bromadex and Bravura codebases, converted to multi-tenant, rather than starting from scratch.

## Open questions
- Confirm release waves: which modules and features ship first?
- Do the mobile apps include every module, or daily tasks only (POS, stock, approvals, dashboard) with the rest on the web?
- Validate the pricing proposal with pilot customers; confirm module counts per plan.
- First target industries and pilot customers (Mining and Construction is a candidate given existing modules).
- Technical approach to multi-tenancy: shared database with a company id on every row, or a separate database per company.
