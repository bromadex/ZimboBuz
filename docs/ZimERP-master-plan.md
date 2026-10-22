# ZimERP Master Plan

**One Zimbabwean business platform: ERP, website, online store, email and domains, connected end to end.**

Version 1.0 · October 2026 · Status: planning (nothing built yet) · Confidential

This document consolidates and supersedes the separate planning notes in this folder (product vision, feature research, Release 1 specification, architecture, financial plan and the ERPNext/Odoo review). Where those notes disagreed, this document records the resolved position. Section references such as §4.3 point to sections in this document.

---

# Part I — Strategy

## 1. Executive summary {#s1}

**What ZimERP is.** A modular, cloud business platform for Zimbabwean companies. Each company gets, under its own brand and domain:

- an **ERP** (point of sale, inventory, invoicing, accounting, payroll and more) on the web and as staff mobile apps;
- a **modern, animated website** and an **online store** built from templates and edited by drag and drop;
- **professional email** on Microsoft 365;
- a **domain**, set up automatically so the website, store, ERP and email all work together from day one.

**Why it wins.** Competitors either sell foreign software that partners adapt for Zimbabwe, or local products with thin evidence of real customers and no published prices. ZimERP is built for how Zimbabwean businesses actually trade: **ZiG and USD side by side at company-set rates, split payments, EcoCash and Paynow built in, ZIMRA fiscalisation, offline operation through load-shedding, and WhatsApp everywhere**, with transparent prices from free to Enterprise.

**Why it is credible.** The owner's existing systems already cover much of the scope for single companies: **Bromadex** (website, store with WhatsApp quotations, ERP with CRM, inventory, procurement and finance) and **Bravura** (a large multi-site ERP with finance, HR and payroll, fleet, fuel, SHEQ, projects and a permission-safe AI assistant). ZimERP turns these into one multi-company platform.

**Everything communicates.** One customer, one product, one employee and one ledger are shared by every module and channel (§4). A website enquiry becomes a CRM lead, a quote, an invoice, a Paynow payment, a ledger entry and a WhatsApp receipt without retyping anything.

**How it gets built and launched.**

| When | Milestone |
|---|---|
| Nov 2026 – Feb 2027 | Build Release 1 on Vercel + Supabase |
| Mar – Apr 2027 | Pilot with 5–10 businesses, including Bromadex |
| May 2027 | Public launch with founding-customer pricing |
| Jun – Aug 2027 | Wave 2: purchasing, payroll, ZIMRA fiscalisation, Microsoft 365 automation |
| Sep 2027 | Production moves to Microsoft Azure (Johannesburg) |

**Commercial model.** Plans per company from **Free** to **$29, $79, $199 and Enterprise from $499 per month**, plus add-ons, resold Microsoft 365 and domains, and setup services. Break-even is about **35 paying companies**; startup costs are estimated at **$4,000–11,000** (§22).

## 2. Market and competitors {#s2}

### 2.1 Sources reviewed

| Source | Type | Key observations |
|---|---|---|
| M&J Consultants article (Acumatica, Dynamics 365 Business Central + LS Retail, Odoo) | Implementation consultancy | Recommends Dynamics for large chains, Acumatica/Odoo for SMEs; no prices or drawbacks |
| Matiyas Solutions | ERPNext implementation partner | Most detailed Zimbabwe claims (ZIMRA, NSSA, EcoCash, Paynow, offline POS); counters show "0+", testimonials not Zimbabwean, templated page, +91 phone |
| Unicorn Solutions | Harare IT company | Only published ERP prices: $200 / $500 / $1,000 per month; no Zimbabwe-specific features listed |
| YoERP | Cloud ERP with mobile apps | Widest industry modules (healthcare, microfinance, hospitality, garages, fleet, farming); no prices, contacts or named clients; USD/ZWL only |
| ERPNext | Open-source ERP (GPL) | Strong accounting discipline, workflows, customisation; pay only for hosting |
| Odoo | Modular ERP (Community LGPL, Enterprise proprietary) | Polished apps and website builder; per-user pricing |

All competitor features are their own website claims (checked October 2026), not tested hands-on.

### 2.2 Price comparison

| Product | Price |
|---|---|
| Unicorn Solutions | $200 (10 users), $500 (50 users), $1,000 (unlimited) per month |
| Odoo | One app free; Standard about $25–39 per user per month; Custom about $49–76 per user; Light User $8.90 (confirm on live page) |
| ERPNext (Frappe Cloud) | No per-user fee; hosting from about $14 per month, plus partner implementation |
| **ZimERP** | Free; $29 (5 users); $79 (15 users); $199 (50 users); Enterprise from $499 |

Example: 10 users on Odoo Standard cost about $250–390 per month; ZimERP Growth is $79 for 15 users.

### 2.3 Gaps no competitor clearly covers

1. ZiG as a first-class currency alongside USD
2. Mobile money (EcoCash via Paynow) built into the point of sale
3. Offline-first operation for load-shedding
4. Transparent prices with self-service sign-up
5. Evidence of real Zimbabwean customers
6. Website, store, ERP, email and domain as one connected product

### 2.4 What ZimERP adopts from ERPNext and Odoo

Ideas and patterns only: ERPNext (GPL) and Odoo Community (LGPL) code is never copied into closed-source ZimERP (§21).

| Pattern | From | ZimERP use | When |
|---|---|---|---|
| Document lifecycle: Draft → Submitted (locked) → Cancelled or Amended | ERPNext | All financial and stock documents | Release 1 |
| Configurable naming series | ERPNext | `INV-HRE-2026-0001`, offline-safe prefixes | Release 1 |
| Connections panel and smart buttons with counts | Both | Linked records on every document | Release 1 |
| Chatter: messages, notes, followers, scheduled activities | Odoo | Activity panel on every record | Release 1 |
| Field-level permissions | ERPNext | Hide cost prices, margins, salaries by role | Release 1 |
| Data import with templates | ERPNext | Excel, Pastel, QuickBooks migration | Release 1 |
| Customer and supplier portals; portal users free | Both | Customers view and pay; suppliers confirm orders | Release 1 / Wave 2 |
| Edit the website on the live page | Odoo | Click-to-edit with drag-in blocks | Release 1 |
| Light users at a lower price | Odoo | Approvers, leave requesters, viewers | Pricing |
| Pricing rules, print designer, workflow designer, custom fields | ERPNext | Discounts, invoice layouts, approvals, extra fields | Wave 2 |
| POS profiles and shift opening/closing | ERPNext | Till sessions per currency | Release 1 |
| Loyalty and gift cards; restaurant mode | Odoo | Retail loyalty; hospitality module | Wave 2 / Wave 4 |
| Studio (no-code builder) | Odoo | **ZimERP Studio** for Pro and Enterprise | Wave 3 |
| Multiple views (calendar, pivot, graph, map, timeline) | Odoo | Beyond list and card views | Later waves |
| Extra apps: e-signatures, appointments, field service, rental, events, surveys, eLearning, live chat, marketing automation | Odoo | Additional modules | Waves 3–4 |
| AI reading supplier invoices and receipts | Odoo | Draft bills and expenses | Wave 4 |

**Not adopted:** overwhelming menus and settings (ZimERP has simple mode and feature switches), per-user pricing for everyone, and leaving Zimbabwe requirements to partners.

## 3. Product concept {#s3}

### 3.1 Pitch

> **Run your whole business in one place: ZiG and USD, EcoCash, ZIMRA, website and email. Built for Zimbabwe.**

### 3.2 What a company gets

| Component | Who uses it | Summary | Details |
|---|---|---|---|
| ERP | Owner and staff | Modules chosen by the company, features switched on or off inside each module, branded with the company's brand kit (§8.4) | §5 |
| Staff apps | Owner and staff | Installable web app for everyone; branded Android and iOS apps on higher plans; no customer app | §9 |
| Website | The company's customers | About 5 templates (2 at launch), own domain, drag-and-drop editing, motion throughout | §8 |
| Online store | The company's customers | Template-based, live ERP stock and prices, Buy and Add-to-quote, Paynow | §8 |
| Customer portal | The company's customers | View quotes, invoices and statements; pay online | §5.3 |
| Email | Owner and staff | Microsoft 365 mailboxes on the company's domain, linked to HR and CRM | §10 |
| Domain | Everyone | Bought through ZimERP; drives one-click setup of everything else | §10 |

**Setup:** each company chooses **do it yourself** (self-service setup screens) or **done for you** (paid setup by the ZimERP team).

### 3.3 Differentiators

- ZiG/USD split payments with correct change, and change-shortage handling (store credit, vouchers, EcoCash refunds)
- Offline-first point of sale and stock that sync after load-shedding
- WhatsApp receipts, invoices, debt reminders and daily owner summaries
- Website enquiries and store orders flow straight into the ERP (§4)
- Transparent pricing with a free plan
- Later: diaspora purchasing (relatives abroad pay, family collects), supplier ordering network, sales history to support loan applications, plain-language AI assistant, anonymous industry benchmarks (§19.6)

### 3.4 Building on Bromadex and Bravura

| Existing system | What it brings |
|---|---|
| **Bromadex** (website + store + ERP for one company) | Marketing site; store whose cart produces a quotation PDF sent by WhatsApp; ERP with finance, procurement, inventory, CRM pipeline and store admin; database rules (stock only via movements and never negative, purchase order status flow with weighted-average costing, invoice totals by triggers, customer de-duplication, **every website quote opens a CRM lead**); motion code that respects reduced-motion settings |
| **Bravura** (multi-site mining and camp ERP) | Finance (ledger, bank reconciliation, statements, cost centres, automatic postings), procurement, inventory, fuel, fleet, HR and payroll with statutory returns, contractors, campsite, meals, SHEQ, projects, DocShare, internal chat, governance; **Ask Bravura** AI that only uses read-only, permission-checked database functions; approval routes, notification centre, AI daily brief, scheduled reports, flow-meter ingest, command palette, PWA, supplier confirmation page, offline stores prototype |

Ideas carried into ZimERP: website → quote → lead flow; Add-to-quote in the store; WhatsApp PDFs; permission-safe AI; shared approvals, notifications and audit log; head-office view across branches; shared document viewer with controlled documents; a **Mining and Construction bundle** (SHEQ, fleet, fuel, contractors, campsite, meals, batch plant); and engineering standards (archive instead of delete, audit trail on every record, permissions enforced in the database, screen codes and command palette). How the code is ported is in §16.

---

# Part II — Product

## 4. How everything connects {#s4}

ZimERP is designed as **one system with many doors**, not a set of separate apps. Every channel and module reads and writes the same records through the same shared services, and external services plug in through adapters.

<figure class="diagram">
<svg viewBox="0 0 760 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ZimERP layered integration map">
  <style>
    .lbl{font:600 12px Inter,Arial,sans-serif;fill:#0d1b16}
    .sm{font:500 10.5px Inter,Arial,sans-serif;fill:#0d1b16}
    .hd{font:700 11px Inter,Arial,sans-serif;fill:#ffffff;letter-spacing:.04em}
    .ar{stroke:#5b6b64;stroke-width:1.4;fill:none;marker-end:url(#a)}
  </style>
  <defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5b6b64"/></marker></defs>

  <!-- Channels -->
  <rect x="10" y="10" width="740" height="78" rx="10" fill="#e8f3ee" stroke="#0b6e4f"/>
  <rect x="10" y="10" width="150" height="22" rx="10" fill="#0b6e4f"/><text x="20" y="25" class="hd">CHANNELS</text>
  <g>
    <rect x="22" y="40" width="108" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="76" y="63" text-anchor="middle" class="sm">Website</text>
    <rect x="140" y="40" width="108" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="194" y="63" text-anchor="middle" class="sm">Online store</text>
    <rect x="258" y="40" width="108" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="312" y="63" text-anchor="middle" class="sm">Customer portal</text>
    <rect x="376" y="40" width="108" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="430" y="58" text-anchor="middle" class="sm">POS</text><text x="430" y="71" text-anchor="middle" class="sm">(works offline)</text>
    <rect x="494" y="40" width="118" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="553" y="58" text-anchor="middle" class="sm">Staff apps</text><text x="553" y="71" text-anchor="middle" class="sm">web · Android · iOS</text>
    <rect x="622" y="40" width="118" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="681" y="58" text-anchor="middle" class="sm">WhatsApp · email</text><text x="681" y="71" text-anchor="middle" class="sm">SMS</text>
  </g>
  <path class="ar" d="M380 90 L380 108"/>

  <!-- Shared services -->
  <rect x="10" y="110" width="740" height="104" rx="10" fill="#fff8e1" stroke="#c98f00"/>
  <rect x="10" y="110" width="250" height="22" rx="10" fill="#c98f00"/><text x="20" y="125" class="hd">SHARED PLATFORM SERVICES</text>
  <g class="sm">
    <rect x="22" y="140" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="108" y="159" text-anchor="middle" class="sm">Identity · roles · permissions</text>
    <rect x="202" y="140" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="288" y="159" text-anchor="middle" class="sm">Plans · feature switches</text>
    <rect x="382" y="140" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="468" y="159" text-anchor="middle" class="sm">Document lifecycle · numbering</text>
    <rect x="562" y="140" width="176" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="650" y="159" text-anchor="middle" class="sm">Activity panel · approvals</text>
    <rect x="22" y="176" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="108" y="195" text-anchor="middle" class="sm">Notifications · alerts</text>
    <rect x="202" y="176" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="288" y="195" text-anchor="middle" class="sm">Audit log · files · documents</text>
    <rect x="382" y="176" width="172" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="468" y="195" text-anchor="middle" class="sm">Search · Ask AI · reports</text>
    <rect x="562" y="176" width="176" height="30" rx="6" fill="#fff" stroke="#c98f00"/><text x="650" y="195" text-anchor="middle" class="sm">Event bus · API · webhooks</text>
  </g>
  <path class="ar" d="M380 216 L380 234"/>

  <!-- Modules -->
  <rect x="10" y="236" width="740" height="78" rx="10" fill="#e8f3ee" stroke="#0b6e4f"/>
  <rect x="10" y="236" width="110" height="22" rx="10" fill="#0b6e4f"/><text x="20" y="251" class="hd">MODULES</text>
  <g>
    <rect x="22" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="64" y="289" text-anchor="middle" class="sm">Sales · invoices</text>
    <rect x="112" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="154" y="289" text-anchor="middle" class="sm">Inventory</text>
    <rect x="202" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="244" y="289" text-anchor="middle" class="sm">Purchasing</text>
    <rect x="292" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="334" y="289" text-anchor="middle" class="sm">Accounting</text>
    <rect x="382" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="424" y="289" text-anchor="middle" class="sm">HR · payroll</text>
    <rect x="472" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="514" y="289" text-anchor="middle" class="sm">CRM</text>
    <rect x="562" y="266" width="84" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="604" y="289" text-anchor="middle" class="sm">Operations</text>
    <rect x="652" y="266" width="86" height="38" rx="7" fill="#fff" stroke="#0b6e4f"/><text x="695" y="289" text-anchor="middle" class="sm">Industry</text>
  </g>
  <path class="ar" d="M380 316 L380 334"/>

  <!-- Shared records -->
  <rect x="10" y="336" width="740" height="70" rx="10" fill="#eef1f5" stroke="#334155"/>
  <rect x="10" y="336" width="290" height="22" rx="10" fill="#334155"/><text x="20" y="351" class="hd">ONE DATABASE · SHARED RECORDS</text>
  <g>
    <rect x="22" y="364" width="110" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="77" y="384" text-anchor="middle" class="sm">Company · branch</text>
    <rect x="142" y="364" width="110" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="197" y="384" text-anchor="middle" class="sm">Customer</text>
    <rect x="262" y="364" width="110" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="317" y="384" text-anchor="middle" class="sm">Product · stock</text>
    <rect x="382" y="364" width="110" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="437" y="384" text-anchor="middle" class="sm">Employee · user</text>
    <rect x="502" y="364" width="110" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="557" y="384" text-anchor="middle" class="sm">One ledger</text>
    <rect x="622" y="364" width="116" height="32" rx="16" fill="#fff" stroke="#334155"/><text x="680" y="384" text-anchor="middle" class="sm">Rates · tax rules</text>
  </g>
  <path class="ar" d="M380 408 L380 426"/>

  <!-- External -->
  <rect x="10" y="428" width="740" height="82" rx="10" fill="#fdeceb" stroke="#b42318"/>
  <rect x="10" y="428" width="280" height="22" rx="10" fill="#b42318"/><text x="20" y="443" text-anchor="start" class="hd">EXTERNAL SERVICES · VIA ADAPTERS</text>
  <g>
    <rect x="22" y="458" width="110" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="77" y="476" text-anchor="middle" class="sm">Paynow</text><text x="77" y="489" text-anchor="middle" class="sm">EcoCash · cards</text>
    <rect x="142" y="458" width="110" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="197" y="476" text-anchor="middle" class="sm">Microsoft 365</text><text x="197" y="489" text-anchor="middle" class="sm">mail · sign-in</text>
    <rect x="262" y="458" width="110" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="317" y="476" text-anchor="middle" class="sm">ZIMRA FDMS</text><text x="317" y="489" text-anchor="middle" class="sm">fiscal receipts</text>
    <rect x="382" y="458" width="110" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="437" y="476" text-anchor="middle" class="sm">WhatsApp · SMS</text><text x="437" y="489" text-anchor="middle" class="sm">messaging</text>
    <rect x="502" y="458" width="110" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="557" y="476" text-anchor="middle" class="sm">Domains · DNS</text><text x="557" y="489" text-anchor="middle" class="sm">name.co.zw</text>
    <rect x="622" y="458" width="116" height="40" rx="7" fill="#fff" stroke="#b42318"/><text x="680" y="476" text-anchor="middle" class="sm">Hosting</text><text x="680" y="489" text-anchor="middle" class="sm">Vercel → Azure</text>
  </g>
</svg>
<figcaption>Figure 1. Every channel and module uses the same shared services and records; external services connect through one adapter each.</figcaption>
</figure>

### 4.1 Integration principles

1. **One record, used everywhere.** A customer, product, employee or account exists once per company. The website, store, POS, invoices, CRM and portal all use the same customer; the store, POS and inventory use the same product and stock.
2. **One ledger.** Every module posts to the same accounting ledger automatically (sales, cost of sales, VAT, payments, payroll, stock adjustments, gateway fees, FX gains and losses). Nobody re-enters figures into accounting.
3. **One permission model.** Plan, company switches and user role are checked together everywhere: screens, reports, exports, API, sync and AI (§12.3).
4. **Events connect modules.** When something important happens (sale submitted, invoice paid, stock low, employee added), the system records an event once; subscribers react: post to the ledger, notify by WhatsApp, update CRM, call a webhook. Modules never call each other directly, so adding a module never breaks another.
5. **Adapters for the outside world.** Paynow, Microsoft 365, ZIMRA, WhatsApp/SMS, DNS, storage and AI each sit behind one module (§12.8), so changing provider or moving to Azure touches only that module.
6. **Linked documents are visible.** Every document shows what it came from and what came after it (Connections panel and counts, §5.3).

### 4.2 Shared records and who uses them

| Record | Created or updated by | Used by |
|---|---|---|
| Company and branches | Sign-up, setup screens | Everything (isolation, branding, domains, plan limits) |
| Customer | Website forms, store, POS, CRM, invoices, portal | Sales, CRM, credit book, statements, WhatsApp, portal, reports |
| Product and stock | Inventory, purchasing, import tool | Store, POS, quotes, invoices, stock takes, valuation, reports |
| Employee and user | HR (Wave 2), admin | Logins and roles, Microsoft 365 mailbox, payroll, approvals, activity assignments |
| Ledger | Automatic postings from every module | Financial statements, tax returns, dashboards, AI answers |
| Exchange rates and tax rules | Company (rates), ZimERP (statutory rules) | Prices, invoices, payroll, returns, FX revaluation (§6) |

### 4.3 Key events

| Event | Raised by | Reactions |
|---|---|---|
| `lead.created` | Website form, store quote request | CRM lead, owner notification, Microsoft 365 mailbox delivery |
| `sale.submitted` | POS, store, invoice | Stock movement, ledger posting, receipt by WhatsApp/print, fiscal receipt (Wave 2), dashboard update |
| `payment.received` | Paynow notification, manual entry, bank match | Invoice/order marked paid, ledger posting, gateway fee and IMTT recorded, customer receipt, portal update |
| `stock.low` | Inventory | Owner/storekeeper alert, draft purchase order suggestion (Wave 2) |
| `document.submitted` / `cancelled` | Any lifecycle document | Locking, reversing entries, audit log, activity timeline |
| `approval.requested` / `decided` | Workflows | Approver notification, document continues or returns |
| `employee.joined` / `left` | HR (Wave 2) | ERP user and role, Microsoft 365 mailbox and licence, payroll; reversed on exit |
| `rate.changed` / `rule.changed` | Company rates, regulatory updates | New prices and calculations from the effective date only; customer notice for rule changes |
| `subscription.overdue` | ZimERP billing | Reminders, grace period, read-only mode |

### 4.4 End-to-end flows

**A. Website enquiry to cash**

1. Visitor submits a contact or quote form on the company website → **lead** in CRM, email to the right Microsoft 365 mailbox, WhatsApp alert to the owner.
2. Staff turn the lead into a **quote** (prices from the shared product list, in ZiG or USD) and send it by WhatsApp with a Paynow link.
3. Customer accepts → **invoice** (submitted and locked) → customer pays by EcoCash → **payment** matched automatically → invoice paid.
4. Ledger receives revenue, VAT and payment entries; customer gets a receipt; the activity panel shows the whole history; the customer can see it all in the portal.

**B. Online store order**

1. Customer buys on the store (live stock and prices) → **order** reserves stock → Paynow checkout.
2. Paynow confirms → order paid → pick and deliver → **invoice** and **stock movement** → ledger (revenue, cost of sales, VAT, gateway fee).
3. Store items marked "Add to quote" instead create a quote request → flow A.

**C. Point-of-sale day**

1. Cashier opens a **till session** with a float per currency; sales continue offline during load-shedding.
2. Each sale: split tender (USD cash, ZiG EcoCash, card, store credit) → **stock movement**, **till totals**, receipt (print or WhatsApp); from Wave 2 a **ZIMRA fiscal receipt**.
3. On reconnect, sales sync and are validated by the server (stock, numbering, payments).
4. Close: counted cash per currency → variance per cashier → ledger → **owner's WhatsApp daily summary**.

**D. Restocking (Wave 2)**
`stock.low` → suggested **purchase order** → approval workflow (limits by amount) → supplier confirms in the **supplier portal** → goods received → stock and weighted-average cost updated → supplier bill → payment → ledger; supplier tax clearance checked for withholding tax.

**E. People (Wave 2)**
New employee in HR → ERP user with role → **Microsoft 365 mailbox and licence** → single sign-on → payroll with PAYE, NSSA, AIDS Levy, ZIMDEF → statutory returns. When the employee leaves: sign-in blocked, mailbox converted and forwarded, licence freed, final pay processed.

**F. New company onboarding**
Sign-up → plan → **domain** bought (name.co.zw) or connected → DNS records created → website, store and ERP live with SSL → Microsoft 365 tenant and email records (automated from Wave 2) → Paynow keys → data import → first sale → ZimERP subscription invoice (§10.3).

## 5. Modules and features {#s5}

### 5.1 Module catalogue and release waves

| Group | Modules | Wave |
|---|---|---|
| Core (always on) | Company and branches, users and roles, currencies and company-set exchange rates, customers, suppliers, products, basic accounting | 1 |
| Commerce | POS, sales and invoicing, inventory and warehouses | 1 |
| Payments | Paynow (EcoCash, OneMoney, InnBucks, cards), payment links and QR codes, reconciliation | 1 |
| Platform | Website builder and store, customer portal, reports and dashboards, data import | 1 |
| Commerce and finance | Purchasing and supplier portal, full accounting, budgets, fixed assets, expenses, pricing rules, loyalty and gift cards | 2 |
| People and compliance | HR, payroll (PAYE, NSSA, AIDS Levy, ZIMDEF), statutory returns, **ZIMRA fiscalisation** | 2 |
| Platform | Microsoft 365 automation, print designer, workflow designer, custom fields, branded Android app, 5 templates, advanced branding (own fonts, overrides, sub-brands, rollback) | 2 |
| Growth | CRM and campaigns (SMS, email, WhatsApp), projects, manufacturing, quality, assets and maintenance, helpdesk, subscription billing, **ZimERP Studio**, public API | 3 |
| Additional apps | E-signatures, appointments, field service, rental, events and ticketing, surveys, eLearning, website live chat, marketing automation | 3–4 |
| Industry | Mining and Construction (SHEQ, fleet, fuel, contractors, campsite, meals, batch plant), healthcare, microfinance, hospitality (restaurant POS, kitchen display), garages, fleet and logistics, farming | 4 |
| Intelligence | Ask AI assistant, AI document capture, forecasting, IoT, industry benchmarks | 4 |

Each wave ships and earns money while the next is built. Every module has its own feature switches.

### 5.2 Zimbabwe-specific features

Priorities: **P1** = core differentiator, **P2** = strong value, **P3** = later. Priority says how important a feature is; §5.1 says when it ships. ZIMRA fiscalisation and statutory returns are P1 in importance but ship in Wave 2 because they need ZIMRA software approval and accountant-verified payroll (§23).

| Area | Feature | Priority |
|---|---|---|
| Money | ZiG-first, USD-equal multi-currency; company-set, effective-dated rates; automatic FX gain/loss | P1 |
| Money | Split tender with correct change and per-currency till balances | P1 |
| Money | Change-shortage handling: store credit, vouchers, mobile-money refunds | P1 |
| Money | Per-currency price lists and rounding (ZiG to the nearest note, USD to $0.05) | P2 |
| Money | Per-currency bank and cash accounts with local bank statement import | P2 |
| Payments | EcoCash, OneMoney, InnBucks, O'mari, Zimswitch, Visa/Mastercard via Paynow; prompts from POS and invoices | P1 |
| Payments | Automatic payment reconciliation | P1 |
| Payments | Payment links and QR codes; IMTT recorded as a cost | P2 |
| Tax | ZIMRA FDMS integration (virtual fiscal device, QR receipts, offline fiscal day) | P1 (Wave 2) |
| Tax | Statutory returns: VAT, PAYE, NSSA, ZIMDEF, AIDS Levy, annual tax certificates | P1 (Wave 2) |
| Tax | Compliance calendar with reminders (VAT, PAYE, QPDs on 25 Mar, 25 Jun, 25 Sep, 20 Dec, NSSA) | P2 |
| Tax | Supplier tax clearance (ITF263) tracking with automatic withholding tax | P2 |
| Tax | Landed costs for imports (duty, freight, clearing, transport) | P3 |
| Reliability | Offline-first POS, invoicing and stock | P1 |
| Reliability | Low-data mode | P1 |
| Reliability | Cheap Android devices, Bluetooth printers, camera scanning | P2 |
| Reliability | USSD/SMS fallback for owner queries | P2 |
| WhatsApp | Invoices, receipts, quotes and statements by WhatsApp in one tap | P1 |
| WhatsApp | Catalogue and ordering through WhatsApp; daily owner summary | P2 |
| WhatsApp | Customer self-service assistant | P3 |
| SME reality | Simple mode for small shops | P1 |
| SME reality | Cash-up and till control with variance per cashier | P1 |
| SME reality | Credit book ("chikwereti"): limits, reminders, partial payments | P2 |
| SME reality | Lay-bys and instalments; diaspora purchasing | P2 |
| SME reality | Loyalty points and gift cards | P3 |
| Growth | Import from Excel, Sage Pastel, QuickBooks, Tally | P1 |
| Growth | Accountant portal (one login, many client companies) | P2 |
| Growth | Industry starter templates (retail, hardware, pharmacy, restaurant, agro-dealer) | P2 |
| Commercial | Public prices in USD and ZiG, EcoCash payment, free plan | P1 |

### 5.3 Shared platform features (in every module)

- **Document lifecycle:** Draft → Submitted (locked) → Cancelled (with reversing entries) or Amended (new linked version). Enforced by the database.
- **Naming series** per document type and branch; offline devices use their own prefixes.
- **Activity panel:** messages, internal notes, followers and scheduled activities with reminders; system events appear in the same timeline.
- **Connections panel and counts:** e.g. a customer shows "5 invoices, 2 open quotes"; clicking opens exactly those records.
- **List and card views** with saved filters and export; calendar, pivot, graph, map and timeline later.
- **Field-level permissions:** sensitive fields hidden from screens, exports, reports and API by role.
- **Approvals, notifications, audit log, search and command palette, document viewer**, inherited from Bravura.
- **Portals:** customers view and pay documents; suppliers confirm orders (Wave 2). Portal users are free.

## 6. Zimbabwe localisation and compliance {#s6}

### 6.1 Currencies and exchange rates
- USD and ZiG on by default; ZAR optional.
- **Each company sets its own exchange rates** (no automatic RBZ feed), with effective date and time and full history.
- Every document stores the rate it used; changing rates never changes past documents.
- Period-end revaluation of open foreign-currency balances posts FX gains and losses automatically.

### 6.2 Tax and fiscalisation
- VAT at the standard rate, zero-rated and exempt items, VAT return reports.
- ZIMRA fiscalisation (Wave 2): fiscal receipts with QR codes, fiscal day handling including offline, numbering assigned by the server. Software approval process starts early (§23); meanwhile companies can use an approved fiscal device.

### 6.3 Payroll statutory items (Wave 2)
PAYE, NSSA, AIDS Levy and ZIMDEF calculated from effective-dated rule tables; payslips; monthly and annual returns; payroll in USD and ZiG.

### 6.4 Regulatory change management
- **Rules as data:** tax tables, rates, ceilings and deadlines live in versioned, effective-dated tables, so a change is a data update with a start date, not a software release.
- **Owner of the rules:** a named person, with an accountant or tax adviser on retainer, watches ZIMRA, NSSA, RBZ and Ministry of Finance announcements, including the national budget and mid-term review.
- **Process:** announcement → update in Staging → accountant checks test payslips and invoices → release → customer notice explaining what changed and from when.
- **Target:** routine changes live within 5 working days, and before the effective date when announced in advance.
- **Currency policy changes** become company settings with sensible defaults; past documents keep the rules that applied at the time.

## 7. Payments {#s7}

### 7.1 Customers paying companies
- **Paynow first:** one integration covers EcoCash, OneMoney, InnBucks, Zimswitch and Visa/Mastercard in USD and ZiG.
- **Store and invoices:** Pay now button, payment links and QR codes (also on quotes, receipts and WhatsApp messages).
- **POS:** EcoCash express checkout: the cashier enters the number, the customer approves on their phone; timeouts and failures never leave a half-paid sale.
- **Later:** Pesepay as backup, direct EcoCash merchant API for high volume, bank card terminals, ZIPIT and bank transfers matched against statements. Cash in USD and ZiG through till sessions.
- Stripe and most international gateways do not serve Zimbabwean merchants.

### 7.2 Who holds the money
**Decision:** each company connects **its own Paynow account**; money goes straight to the company and **ZimERP never holds funds**. This avoids needing Reserve Bank of Zimbabwe approval as a payment operator (legal advice required before ever holding funds) and builds trust. Paynow keys are entered in setup, stored encrypted and used only on the server; "done for you" includes help registering with Paynow.

### 7.3 What happens to every payment
Paynow result notification (hash verified) → invoice or order marked paid, with a status check if a notification is missed → matched to invoices including partial payments → gateway fee and IMTT recorded → daily settlement report (Paynow versus bank) → refunds and change as store credit or EcoCash refund. All gateways go through one payment adapter.

### 7.4 Companies paying ZimERP
One monthly invoice (modules, users, Microsoft 365, domains, apps) by WhatsApp and email with a Paynow link; EcoCash, OneMoney, InnBucks, cards and bank transfer; reminders before and after the due date; grace period, then **read-only mode** (never deletion, export always allowed); annual prepayment discount; priced in USD with ZiG accepted at ZimERP's published rate. ZimERP takes no cut of company transactions; value is in the subscription, plus any Paynow partner arrangement.

## 8. Websites, stores, design and branding {#s8}

### 8.1 Templates and editing
- About **5 templates** (2 at launch, 5 by the end of Wave 2), each with its own look and motion style: corporate, bold, product/store, creative and one more chosen from pilot feedback.
- Company logo, colours and fonts applied automatically from the brand kit (§8.4); own domain with automatic SSL.
- **Edit on the live page:** click text or images to change them, drag in blocks (hero, text, image, gallery, product grid, contact form, testimonials, map, WhatsApp button), built-in SEO settings.
- Store: categories, product pages, live stock and prices, **Buy** (Paynow) or **Add to quote**; orders and quote requests flow into the ERP (§4.4).

### 8.2 Motion
- Animated hero backgrounds (starting from Bromadex's network canvas) recoloured to the brand; animated headlines.
- Scroll reveals, staggered lists, parallax, sticky scroll sections, counters.
- Page transitions, including a product card expanding into its page.
- Micro-interactions: buttons press in, cards lift, add-to-cart flies to the cart, animated toasts, loading skeletons.
- Store motion: swipe-and-zoom galleries, animated steppers, sliding cart drawer, animated checkout progress.
- **Company setting:** Off / Subtle / Rich, plus an entrance animation per block.

### 8.3 Performance and accessibility
Animations use only transforms and opacity, pause off screen, and never block content; images are compressed and lazy-loaded; the site works before scripts load. Reduced-motion settings are respected and nothing important depends on animation. Target: store pages score at least 85 on mobile Lighthouse on a mid-range Android profile.

### 8.4 Branding and theming
Each company sets its brand once in a **brand kit**; every part of ZimERP uses it automatically.

**Brand kit**

- **Colours:** primary, secondary and accent, chosen by the company or **suggested from the uploaded logo**. A full palette (lighter and darker shades for buttons, backgrounds, borders and charts) is generated automatically.
- **Readability check:** warns when text on a chosen colour would be hard to read and offers a corrected shade.
- **Light and dark mode** for the website, store, portal and ERP.
- **Fonts:** curated, tested pairs of free web fonts (heading and body), e.g. Modern, Classic, Friendly, Technical; **upload your own licensed font** on Pro and Enterprise; a fast fallback font for low-end phones.
- **Shape and style:** corner roundness, button style (solid, outline, pill), shadow strength, icon style, spacing (compact or roomy).
- **Logo set:** full logo, icon, and a black-and-white version for thermal receipts; favicon and app icon generated from it.

**Where the brand appears**

| Place | What follows the brand kit |
|---|---|
| Website and store | Colours, fonts, buttons, motion colours, favicon |
| ERP web app and staff apps | Header, menus, buttons, charts, login page, app icon, splash screen |
| Customer portal | Same look as the website |
| Documents | Invoices, quotes, statements, payslips: logo, colours, fonts, footer |
| Receipts | Black-and-white logo for 58 mm and 80 mm thermal printers |
| Emails and WhatsApp messages | Logo, colours, signature |
| Branded Android and iOS apps | Name, icon, splash colours (§9.1) |

**More control**

- **Per-template overrides:** a template can use the brand kit as is or adjust it (e.g. a darker hero section).
- **Per-branch sub-brands** (Enterprise) for groups with several trading names.
- **Preview before publishing**, with **version history and rollback** of brand changes.
- **"Done for you"** setup includes brand set-up for companies without a designer.

**How it works:** colours, fonts and styles are stored per company as **design tokens** (§12.7); changing them updates every channel immediately, with no code changes.

**Release timing:** Release 1 includes logo set, three brand colours with automatic palette and readability check, light and dark mode, curated font pairs, and branding of website, store, ERP, documents, receipts and emails (P20). Own font upload, per-template overrides, sub-brands and brand version rollback follow in Wave 2.

## 9. Staff apps and devices {#s9}

### 9.1 Distribution

| Tier | Delivery | Branding |
|---|---|---|
| All plans | Installable web app (PWA) from the company's ERP address | Company name and icon on the home screen; no app store |
| Pro and above (add-on on lower plans) | Automatically built Android APK, direct download or Play Store | Company name and icon |
| Enterprise (add-on otherwise) | iOS app distributed privately to the company's staff via Apple Business Manager | Company name and icon; company needs an Apple account |

An app's home-screen name is fixed when it is built, which is why branded apps are built per company. Inside every version, the company's branding, modules and features load after login. There is no customer app.

### 9.2 What the app is for
Recommended (to confirm with pilots, Appendix B): the app focuses on daily work — offline POS on low-cost Android with Bluetooth printers, stock counts and camera scanning, approvals, the owner dashboard (sales by currency, cash, debtors, low stock) and alerts (low stock, large sales, till short). Heavy work (full accounting, payroll runs, website editing, large reports) is done on the web, which also works on phones.

### 9.3 Supported devices

| Device | Minimum |
|---|---|
| Android phones and tablets | Android 9+, 3 GB RAM recommended, Chrome |
| iPhone and iPad | iOS 16+ (Safari PWA; branded app on Enterprise) |
| Computers | Current Chrome, Edge, Firefox or Safari |
| Receipt printers | Bluetooth or USB ESC/POS thermal, 58 mm and 80 mm |
| Barcode scanners | USB or Bluetooth in keyboard mode, or the device camera |
| Connectivity | Works offline; syncs on 3G or better |

Published in the help centre and reviewed every six months.

## 10. Email, domains and one-click setup {#s10}

### 10.1 Email on Microsoft 365
- ZimERP resells Microsoft 365 through the **Cloud Solution Provider (CSP)** programme, starting as an indirect reseller through a Microsoft distributor. ZimERP does not run mail servers.
- Each company has **its own Microsoft 365 tenant**, managed by ZimERP through a delegated-admin (GDAP) relationship the company approves. The tenant belongs to the company.
- Plans: Exchange Online (email only), Business Basic, Business Standard, Business Premium (confirm current names and prices with the distributor).
- Integration: email DNS records set automatically; **mailboxes created and removed from HR**; **sign in to ZimERP with Microsoft**; invoices and quotes sent from the company's own mailbox via Microsoft Graph (Resend as fallback for bulk or no-reply mail); customer emails and calendar linked to CRM and leave; later OneDrive files on records and approvals in Teams; website forms deliver to the right mailbox and create leads.
- Release 1 supports manual email setup; the automation arrives in Wave 2.

### 10.2 Domains
- ZimERP sells domains: `.co.zw`, `.org.zw`, `.ac.zw` through **name.co.zw** (from US$5.99/year or ZiG equivalent, pays via Paynow, instant nameserver changes; no reseller programme or API listed), and `.com`, `.africa` and others through an international registrar with an API.
- Domains are **registered in the customer's name**; ZimERP manages DNS. Customers can also connect an existing domain.
- Because name.co.zw has no listed API, registration is a manual step by the ZimERP team; once nameservers point to ZimERP DNS (Vercel DNS or Cloudflare while building, Azure DNS after the move), every record is automatic.
- Yearly renewals with reminders, billed with the subscription. Questions for name.co.zw are in Appendix C.

### 10.3 One-click setup flow
1. Buy a domain inside ZimERP (or connect one); `.co.zw` orders are registered at name.co.zw.
2. DNS zone created; website, store and ERP addresses added with SSL.
3. Microsoft 365 tenant created, domain added and verified automatically (Wave 2).
4. Email records added: MX, autodiscover, SPF, DKIM, DMARC.
5. Mailboxes created from the HR employee list; staff sign in with Microsoft.
6. A live checklist shows domain active, website live, SSL issued, Microsoft verified, email flowing.

## 11. Release plan {#s11}

### 11.1 Release 1 goal
A shop with 1–5 tills can sign up, set up products, sell in ZiG and USD (cash, EcoCash, card), manage stock, issue quotes and invoices, take Paynow payments, run a branded website and store on its own domain, and keep working during load-shedding.

### 11.2 Release 1 features and acceptance tests

| # | Feature | Done when |
|---|---|---|
| P1 | Sign-up and guided setup | A new user goes from sign-up to a completed first sale in under 15 minutes without help |
| P2 | Plans, modules, feature switches | Switching a feature off removes it from menus, screens and API for the whole company, proved by a test |
| P3 | Users, roles, permissions, two-step login for owners and admins | A cashier cannot refund, void without a manager PIN, change prices or see cost prices (automated tests) |
| P4 | Currencies and company-set rates; per-currency prices and rounding | Every sale and invoice records its rate; later rate changes never alter past documents |
| P5 | Offline POS, split tender, change handling, tills and cash-up, scanning, receipts | 50 offline sales including split tender sync correctly with stock and till totals |
| P6 | EcoCash express checkout | Success, decline, timeout and duplicate notifications all end in the correct state (Paynow test environment) |
| P7 | Inventory: locations, movements, transfers, stock takes, low-stock alerts, weighted-average valuation | Stock on hand always equals the sum of movements (database check and tests) |
| P8 | Quotes, invoices, payments, credit notes, credit book, statements, payment links | A Paynow payment marks the invoice paid; a missed notification is caught within 15 minutes |
| P9 | Website and store: 2 templates, live-page editing, motion, Buy and Add-to-quote, custom domain | Store page ≥ 85 mobile Lighthouse; a store order appears in the ERP within 10 seconds |
| P10 | Owner dashboard, daily WhatsApp summary, Excel/PDF export of every report | Reports match underlying records |
| P11 | ZimERP subscription billing with grace period and read-only mode | An unpaid company becomes read-only but can still log in and export everything |
| P12 | Audit log for creates, edits, voids, refunds, price and permission changes | Every listed action is logged with before and after values |
| P13 | Document lifecycle and naming series | The database rejects edits to submitted documents; cancel and amend produce correct reversing entries |
| P14 | Activity panel and scheduled activities | Assignees are notified on the due date; status changes appear in the timeline |
| P15 | Connections panel and counts | Clicking a count opens exactly those records |
| P16 | List and card views | Views remember the user's last choice; filters and export work |
| P17 | Field-level permissions | Hidden fields are absent from screens, exports, reports and API for that role |
| P18 | Data import tool | A 2,000-product file with errors imports valid rows only after confirmation and lists each error by row |
| P19 | Customer portal | A customer sees only their own documents (isolation tests) |
| P20 | Brand kit: logo set, colours with automatic palette and readability check, light/dark mode, font pairs (§8.4) | Changing the primary colour or font updates the website, store, ERP, portal, invoices, receipts and emails within one minute; low-contrast choices are flagged |

Out of Release 1 (scheduled in §5.1): ZIMRA fiscalisation, payroll, purchasing workflows, Microsoft 365 automation, branded native apps, own fonts, brand sub-brands and rollback, pricing rules, print and workflow designers, custom fields, supplier portal, loyalty, Studio, AI assistant.

### 11.3 Release checklist
All acceptance tests pass; company isolation tests pass; accountant-agreed accounting tests pass; penetration test done with critical findings fixed; help articles and videos exist for every feature; 5–10 pilot companies have used it for at least 4 weeks.

### 11.4 Pilot programme
- **Who:** 5–10 businesses across 2–3 types (retail/grocery, hardware, one service business) plus Bromadex; at least one each in Harare and Bulawayo; a mix of VAT-registered and small businesses.
- **They get:** free use for 4–8 weeks, free setup and training, founding-customer pricing afterwards.
- **We ask:** daily use, a weekly 15-minute feedback call, permission for a testimonial and case study.
- **We measure:** time to first sale, daily active users, sales processed, offline syncs correct, support questions, bugs, willingness to pay and preferred plan.
- **Success:** at least 70% still using it daily at the end, and at least half convert to paid.

### 11.5 Roadmap

| When | Milestone |
|---|---|
| Oct 2026 | Plan documented; repositories made private |
| Nov 2026 – Feb 2027 | Build Release 1; start ZIMRA and Paynow partner conversations; register company and trademark |
| Mar – Apr 2027 | Pilot; fixes; penetration test |
| May 2027 | Public launch, founding-customer pricing |
| Jun – Aug 2027 | Wave 2 (purchasing, payroll, ZIMRA, Microsoft 365 automation, 5 templates, branded Android app) |
| Sep 2027 | Production moves to Azure, Johannesburg |
| Q4 2027 | Wave 3 (CRM, projects, manufacturing, helpdesk, Studio, API); ZITF and Mine Entra |
| 2028 | Wave 4 (industry modules starting with Mining and Construction, AI, IoT); ISO 27001 preparation |

Dates are targets, reviewed monthly against progress and pilot feedback.

---

# Part III — Technology

## 12. Architecture {#s12}

### 12.1 Stack

| Layer | Choice |
|---|---|
| Web app (ERP, websites, stores, portals) | Next.js with TypeScript and Tailwind CSS |
| Database, logins, storage, server functions | Supabase (PostgreSQL), self-hostable |
| Offline sync | PowerSync (local SQLite on each device) |
| Mobile | PWA for all; Capacitor wrapper for branded Android and iOS builds |
| Payments | Paynow first, through the payment adapter |
| Email | Microsoft 365 via Microsoft Graph; Resend fallback |
| Hosting | Vercel + Supabase while building; Azure (Johannesburg) at commercial scale (§13) |

### 12.2 Multi-tenancy
**Decision:** one shared database; every business table carries `company_id`; PostgreSQL row-level security enforces isolation regardless of app code. Enterprise customers can have a dedicated database running the same migrations. Core platform tables: companies, domains, branding, plans and entitlements, company modules and features, memberships (one user can belong to several companies, e.g. an accountant), branches (replacing Bravura's `site_id`), roles and permissions, and an append-only audit log.

### 12.3 One access rule
A user can perform an action only if **all three** hold: the company's **plan** includes it, the company has it **switched on**, and the user's **role** allows it. One database function (e.g. `can(company_id, 'pos.refund')`) is used by security policies, server code, sync rules, reports and the AI, and the interface hides whatever is unavailable.

### 12.4 Document model
Lifecycle status with database triggers that reject edits to submitted documents; amendments linked to the cancelled original; naming series allocated by the server or in per-device blocks for offline POS; shared activity, follower and message tables for every document type; a connections registry that builds counts and linked lists generically; sensitive columns served only through role-aware views; portal contacts as a separate identity limited to their own documents; Studio custom fields stored as metadata plus a flexible JSON column (Wave 3).

### 12.5 Event backbone
Important changes write an event to an outbox table in the same transaction as the change. Background workers deliver events to subscribers (ledger posting, notifications, WhatsApp, Microsoft Graph, webhooks) with retries, so a temporary outage of an external service never loses work. This implements the event list in §4.3.

### 12.6 Domain routing
Middleware reads the hostname and resolves the company (cached). `name.zimerp.co.zw` serves the website and store; `erp.` addresses serve the ERP. Reserved names (www, app, api, admin, status, help) cannot be claimed. Custom domains are attached through the hosting provider's API with automatic SSL.

### 12.7 Website builder
Pages are stored as ordered JSON blocks with content, settings and animation. A template is design tokens plus block styles plus a motion preset plus default pages; the company's brand kit (§8.4) fills the design tokens, so one change restyles every channel. The same React block components power the live-page editor and the public renderer. Pages are rendered on the server and cached; editing refreshes that company's cache. Store blocks read live products, prices and stock through read-only views.

### 12.8 Offline sync and adapters
Sync rules give each device only its company, branch and role data; offline writes queue and are validated by server functions (stock, numbering, payment states), with conflicts flagged. External services sit behind adapters: payments, email, messaging, storage, DNS and domains, fiscal (ZIMRA) and AI.

### 12.9 API
REST API with per-company keys, scopes, rate limits and webhooks (e.g. `invoice.paid`, `stock.low`) on Pro and Enterprise from Wave 3; a reviewed marketplace for partner add-ons later.

### 12.10 Environments
Local, **Staging** (every change lands here first, with automatic migrations, seed data and tests) and Production.

## 13. Hosting and deployment {#s13}

### 13.1 Phases
1. **Building (now to launch):** Vercel + Supabase, about $50–100 per month, for development, demos and pilots.
2. **Commercial scale (from Sep 2027):** Microsoft Azure, South Africa North (Johannesburg): same Microsoft partnership as Microsoft 365 (CSP), margin on resold Azure, data close to Zimbabwe, Microsoft sign-in, enterprise trust, possible startup credits. Services: Static Web Apps / App Service / Container Apps behind Front Door; Functions or Container Apps; self-hosted Supabase or Azure PostgreSQL with Entra ID and Blob Storage; Azure DNS; Azure Backup and Monitor. All companies share one platform; Enterprise can have a dedicated setup.
3. **Local hosting (Enterprise, on request):** a private install in a Zimbabwean data centre or on the client's servers (§13.4).

No plain cPanel hosting is offered.

### 13.2 Building for the move (rules from day one)
Standard PostgreSQL only, with all schema, security rules and logic in versioned SQL migrations; no provider-only features unless wrapped in an adapter; storage, email, sign-in, background jobs and DNS each behind one module; configuration through environment variables; container-ready app and functions; rehearse the move before switching (restore on Azure, run all tests, measure speed from Harare and Bulawayo).

### 13.3 Backend choice
**Decision: Supabase.** It reuses Bravura and Bromadex code and security rules, is standard PostgreSQL (no lock-in), is Apache 2.0 licensed (self-hostable for a closed-source product) and moves cleanly to Azure. Alternatives considered: Firebase (no SQL, Google lock-in), Appwrite (weaker database for ERP), Nhost (smaller vendor), Convex (proprietary database), PocketBase (too small), AWS Amplify (wrong cloud), and building our own on Azure PostgreSQL with Entra ID (cleanest long term but slower and more rework). **PowerSync** provides offline sync with any PostgreSQL, including after the move and on-premise; check its licence for closed-source commercial use before committing; ElectricSQL is the fallback.

### 13.4 On-premise deployment
- Self-hosted Supabase in Docker plus the ZimERP app on the client's Linux server; same migrations and rules as the cloud (one product, not a fork).
- Differences from cloud: backups, updates, security patches and power resilience must be organised; a few managed extras are unavailable.
- **Protecting closed-source code:** licence agreement (no copying, reverse-engineering or resale), licence key with expiry tied to payment, the most valuable logic kept in ZimERP cloud services (fiscalisation, payment integrations, AI), and Enterprise pricing.
- **Responsibilities:** ZimERP installs, updates, licenses, supports and monitors; the client provides hardware, power backup, internet and physical security, plus their own IT or a paid managed service; remote access agreed up front.
- **Rough server size:** Linux with Docker, 4–8 CPU cores, 16 GB RAM, fast SSD, UPS, off-site backups.

## 14. Security {#s14}

| Area | Measures |
|---|---|
| Company isolation | Row-level security on every table; automated cross-company tests block any deployment that breaks isolation; per-company private files; dedicated database option |
| Logins | Two-step verification for owners and admins; Microsoft sign-in; cashier PINs on manager-authorised devices; device list with remote logout; inactivity logout; new-device alerts |
| Permissions and fraud | Role and feature permissions; approval limits; segregation of duties; voids, discounts, refunds and till variances logged per cashier with anomaly alerts; tamper-proof audit trail; archive instead of delete |
| Data protection | Encryption in transit and at rest; secrets in secure stores (Azure Key Vault after the move); company Paynow and Microsoft credentials encrypted and server-only; no card data stored; Paynow notifications hash-verified; minimal personal data with masking |
| Offline devices | Encrypted local data limited to need; remote wipe; server re-validation of offline transactions |
| AI | Read-only, permission-checked tools as the logged-in user; content treated as data, never instructions; actions need confirmation; all questions logged |
| Websites and email | Attack and DDoS protection, rate limits and bot protection; SPF, DKIM, DMARC to stop spoofed invoices; Microsoft 365 security defaults |
| Development | Security review, dependency and secret scanning and tests on every release; OWASP Top 10 practices; independent penetration test before launch and yearly |
| Staff access | Customer-approved, time-limited, logged support access; two-step verification on all ZimERP accounts; least privilege; immediate removal on exit |
| Backups and incidents | Daily encrypted backups with point-in-time restore in a second location; monthly restore test; incident plan including POTRAZ notification where the Cyber and Data Protection Act requires |
| Compliance | Privacy policy, data processing agreements, processor register (Microsoft, Paynow, hosting), export and deletion on request; ISO 27001 later |

Immediate actions are listed in Appendix D.

## 15. Quality, reliability and disaster recovery {#s15}

### 15.1 Testing
Unit tests for money, currency, rounding, tax and payroll; **accountant-verified scenarios** (sales, refunds, split tender, FX gains and losses, stock valuation) that ZimERP must match exactly; database tests for isolation, permissions, stock never negative and numbering; end-to-end tests (sign-up to first sale, offline POS session, Paynow flows, store order to ERP); performance budgets (usable on a mid-range Android phone on 3G; store pages ≥ 85 Lighthouse). Nothing reaches Production unless all pass in Staging.

### 15.2 Reliability targets

| Target | Value |
|---|---|
| Uptime (paid plans) | 99.5% per month (Enterprise SLA may be higher) |
| Back online after a major failure | Within 4 hours |
| Maximum data loss | 15 minutes (point-in-time recovery) |
| Backups | Daily, encrypted, second region, monthly restore test |

Offline-first POS keeps shops selling through a platform outage. Monitoring, error tracking and a public status page are in place from launch.

## 16. Reusing Bravura and Bromadex {#s16}

| Existing | In ZimERP |
|---|---|
| React + Vite, JavaScript | Next.js + TypeScript, ported screen by screen |
| Inline styles with theme tokens | Tailwind and design tokens from company branding |
| `site_id` scoping | `company_id` + `branch_id` |
| `_has_permission(code, site_id)` | `can(company_id, code)` including plan and feature checks |
| SQL migrations applied by hand | Versioned migrations applied automatically per environment |
| Ask Bravura | ZimERP Ask, same principle, scoped per company |
| Bromadex store, quotation PDF, lead flow | Website and store module with templates |

Order: database logic first (tables, triggers, security policies with `company_id`), then screens per module, with isolation tests from the first day.

---

# Part IV — Business

## 17. Pricing {#s17}

All USD, a proposal to validate with pilots (§11.4). Structure: a plan per company with users and modules included, plus add-ons.

### 17.1 Plans (per company, per month)

| Plan | Price | Full users | Modules | Includes |
|---|---|---|---|---|
| Starter | Free | 1 | Core + 1 (POS or invoicing) | ZimERP subdomain, 1 template with "Powered by ZimERP" badge, PWA, self-service support |
| Business | $29 | 5 | 3 | Own domain, website and store, Paynow, WhatsApp receipts, ZiG/USD |
| Growth | $79 | 15 | 6 | 2 branches, approvals, advanced reports, Ask AI (basic), priority support |
| Pro | $199 | 50 | All standard | 5 branches, branded Android app, own fonts, API, custom workflows, Studio (from Wave 3) |
| Enterprise | From $499 | Unlimited | All, including industry | Branded iOS app, per-branch sub-brands, dedicated setup and database, SLA, on-premise option |

### 17.2 User types
- **Full users** count towards the plan limit.
- **Light users:** about $1–2 per month (or a free allowance per plan) for staff who only approve, request leave, view reports or use self-service.
- **Portal users** (customers and suppliers) are always free.

### 17.3 Add-ons, resale and one-off fees

| Item | Price |
|---|---|
| Extra full user | $3–5 per month |
| Extra standard module | $10–20 per month |
| Industry module | $30–50 per month |
| Extra branch | $10 per month |
| ZIMRA fiscalisation | $10–15 per till per month |
| Branded Android app (below Pro) | $20 per month |
| Branded iOS app (below Enterprise) | $40 per month, plus Apple's $99 per year paid by the client |
| Ask AI beyond allowance, SMS bundles | Usage-based |
| Microsoft 365 | Microsoft price plus about 10–20% |
| `.co.zw` domain | About $15–20 per year (cost from $5.99) |
| "Done for you" website and store | $150–300 once |
| Data migration | $100–500 once |
| On-site training | Per day |
| On-premise | Setup fee plus annual licence (e.g. from $5,000), support separate |

### 17.4 Rules
Two months free for annual prepayment; USD prices with ZiG accepted at a published rate reviewed monthly; founding customers (first 20–50) keep launch prices for life; discounts for NGOs, schools and startups; accountant partners earn 20% recurring commission or use ZimERP free; the free plan is self-service only.

### 17.5 Other revenue
Hardware resale (printers, scanners, cash drawers, tablets), custom development and integrations, a Paynow partner arrangement if available, and lender referrals using sales data only with the company's consent.

## 18. Marketing and go-to-market {#s18}

### 18.1 Message and brand
- Headline: "Run your whole business in one place: ZiG and USD, EcoCash, ZIMRA, website and email. Built for Zimbabwe."
- Three proof videos: a split-tender sale with correct change in 10 seconds; an EcoCash prompt that marks the invoice paid; working through load-shedding and syncing afterwards.
- Positioning: against exercise books and Excel ("stop losing money to mistakes and missing stock"), against expensive ERPs ("what others charge $200 for, from $29"), against foreign software ("built for ZIMRA, ZiG and EcoCash, not adapted for them").
- Brand: name **ZimERP** (check trademark, company name, `zimerp.co.zw`, `zimerp.com` and social handles before registering); taglines "Run your whole business in one place" or "Built for Zimbabwe business"; logo that works dark, light, small and on black-and-white receipts; a brand guide for logo, colours, fonts, tone (clear, practical, local) and icons.

### 18.2 Proof and channels
- ZimERP's own website runs on ZimERP templates; Bromadex is customer #1; Bravura is the Mining and Construction case study (with permission).
- **WhatsApp** (main lead source: catalogue, Status, broadcasts, fast replies); **Facebook and Instagram** (proof videos, stories, targeted ads); **TikTok** (day-in-the-life, ZiG/USD tips); **Google search** (pages for "POS system Zimbabwe", "ERP Zimbabwe", "ZIMRA fiscalisation software", "ZiG accounting software"); **LinkedIn** (mining, construction, larger companies); **YouTube** (how-to videos that double as support).

### 18.3 Partners and events
Accountants and bookkeepers (20% recurring commission), tax consultants and fiscal device sellers, hardware shops, Paynow and Microsoft partner listings, banks and microfinance lenders, commission-based field agents. Events: ZITF and Mine Entra in Bulawayo; chambers and associations such as ZNCC and CZI; free workshops ("ZIMRA fiscalisation and ZiG: what your business must do").

### 18.4 From interest to paying customer
Free plan with same-day selling → guided setup plus a WhatsApp message from a real person on day 1 → 14-day trial of Growth features → live demos → referral reward (a month free for both).

### 18.5 Launch plan and budget
Before launch: pilot, testimonials, website, WhatsApp waiting list, 15–20 owner interviews per wave. Launch month: founding pricing for the first 50, press release, launch event or webinar. Months 2–6: accountant partners, field agents, steady content, ZITF and Mine Entra. Ongoing: monthly customer story, SEO articles, feature videos. Ads start at about $200–500 per month plus commissions, increased only where sign-ups follow.

## 19. Customer support and success {#s19}

### 19.1 Support levels

| Plan | Channels | First response | Hours |
|---|---|---|---|
| Starter | Help centre, videos, AI help bot, community group | Self-service | 24/7 self-service |
| Business | + WhatsApp and email tickets | 8 working hours | Mon–Fri 8:00–17:00, Sat 9:00–13:00 |
| Growth | + in-app chat | 4 working hours | Plus extended evenings |
| Pro | + phone and video, priority queue | 2 hours | 7 days |
| Enterprise | + account manager, SLA, on-site | Critical within 1 hour | 24/7 for critical |

Critical issues (system down, POS cannot sell, payments or ZIMRA submissions failing) get top priority on every paid plan. The support **help bot** (all plans) answers how-to questions; **Ask AI** about business data is a product feature from Growth.

### 19.2 How support works
- **WhatsApp first, AI first:** the help bot answers from the help centre and, with permission-safe read-only access, the customer's own setup; it hands over to a person on request, when stuck, or for anything critical. Every conversation becomes a ticket in ZimERP's own Helpdesk module.
- **Self-service:** searchable help with a "?" on every screen, 1–2 minute videos, setup checklist, tooltips and "what's new", community group.
- **Onboarding:** setup checklist; welcome call and day-7 and day-30 check-ins on paid plans; "done for you" setup; free monthly online class and paid on-site training.
- **Reporting problems:** a button that attaches screenshot, page, user, device, version and recent errors; error tracking; public status page with WhatsApp and email notices; escalation from agent to technical lead to developer, with a written incident report for critical issues.
- **On-premise:** remote access, server health monitoring and agreed maintenance windows.
- **Partners** trained and certified as first-line support for their own clients.
- **Resilience:** support staff have backup power and data; about 1 support person per 150–250 paying customers.

### 19.3 Customer success
Health score per company (logins, active users, sales recorded, modules used, tickets, payment status); at-risk alerts acted on before customers leave; growth prompts when a company hits limits or would benefit from another module; quarterly check-ins for Pro and Enterprise.

### 19.4 Data ownership and exit
Companies own their data and can export everything at any time (Excel/CSV, PDF documents, files as ZIP), including in read-only mode. After cancellation data stays read-only for 90 days, then is deleted with written confirmation. Domains and Microsoft 365 tenants already belong to the customer. No exit fees.

### 19.5 Support metrics
First response and resolution times, satisfaction per ticket, share solved by AI or self-service, top question topics (fed into product and help), churn after poor support.

### 19.6 Industry benchmarks (later)
Opt-in, anonymous comparisons (e.g. gross margin versus similar hardware stores in Bulawayo), shown only from aggregates of at least 5 companies. A differentiator and a source of marketing content.

## 20. Organisation {#s20}

### 20.1 Team plan

| Stage | Roles |
|---|---|
| Building | Owner (decisions, testing, sales); AI development; accountant or tax adviser on retainer |
| Pilot | + implementation and support person |
| Launch | + second support person; field agents; accountant partners |
| ~100 customers | + sales lead; second implementation consultant; part-time developer reviewing AI-written code and handling on-premise installs |
| ~250+ customers | Support team sized to load; customer success role; Enterprise account manager |

### 20.2 How AI development works
AI (Claude) writes code and tests in small steps; the owner, later a developer, reviews and tries each step before the next; decisions are written down in this folder so every session keeps context.

### 20.3 What the owner handles
Accounts and agreements (Appendix D), testing with real businesses, sales and onboarding, product decisions (priorities, pricing, when to ship), and legal setup (§21).

## 21. Legal, licensing and IP {#s21}

- **Company:** register ZimERP (or a holding company) as a private limited company; ZIMRA tax registration, and VAT when turnover requires; USD and ZiG business bank accounts.
- **Trademark:** search and register the name and logo with ZIPO; own domains in the company's name.
- **Contracts (with a lawyer):** Terms of Service, SLA by plan, Data Processing Agreement, Privacy Policy, Acceptable Use Policy, on-premise licence, partner/reseller and field agent agreements, employee and contractor agreements with NDA and IP assignment.
- **Partner agreements** in the company's name: Microsoft CSP, Paynow, registrars.
- **Closed source:** customers rent access and never receive source code; repositories are private and accessible only under NDA and IP assignment; no GPL/AGPL code is copied in (ERPNext, Odoo Community studied for ideas only); every dependency's licence is checked (MIT, BSD, Apache 2.0, ISC preferred); valuable logic stays on the server; apps ship only compiled code without secrets; on-premise is a licensed build with a key.
- **Data protection:** Cyber and Data Protection Act (2021), with POTRAZ as the authority; legal advice on cross-border data transfer before launch.
- **Payments regulation:** ZimERP does not hold customer funds (§7.2); legal advice before any change.

## 22. Financial plan {#s22}

Rough estimates; confirm with real quotes.

### 22.1 Startup costs (once-off)

| Item | Estimate |
|---|---|
| Company registration, trademark, legal templates | $500–1,500 |
| Domains | $50–100 |
| Penetration test | $2,000–5,000 |
| Accountant review of tax, payroll and accounting logic | $500–1,500 |
| Brand identity | $200–1,000 |
| Launch marketing | $500–1,500 |
| Test devices (Android, printers, scanner) | $300–600 |
| **Total** | **about $4,000–11,000** |

### 22.2 Monthly running costs

| Item | While building | First year after launch |
|---|---|---|
| Hosting | $50–100 | $150–500 |
| AI development tools | $100–200 | $100–200 |
| Other software (error tracking, status page, WhatsApp API, email) | $0–50 | $100–250 |
| Advertising | $0 | $200–500 |
| Support staff (1–2) | $0 | $600–1,500 |
| Internet, power backup, phone | $50–100 | $100–200 |
| **Total** | **about $200–450** | **about $1,250–3,150** |

Field agent and partner commissions are paid from revenue.

### 22.3 Break-even and growth
At about $2,000 monthly cost and about $60 average revenue per company, break-even is roughly **35 paying companies**, before setup fees and resale margins.

| Paying companies | Monthly subscription revenue |
|---|---|
| 35 | ~$2,100 |
| 100 | ~$6,000 |
| 250 | ~$15,000 |
| 500 | ~$30,000 |

### 22.4 Runway and funding
Runway is cash divided by monthly cost; for example $10,000 covers about $6,000 of startup costs plus about 9 months of building. Plan for pilots converting within 2 months of launch. Funding: self-funded from Bromadex and consulting income, founding-customer annual prepayments, grants and startup competitions, Microsoft for Startups credits, and investors once there are paying customers.

## 23. Risks and mitigations {#s23}

| Risk | Impact | Mitigation |
|---|---|---|
| ZIMRA approval delayed | VAT-registered customers can't fully switch | Start early; launch without fiscalisation; partner with an approved fiscal device provider meanwhile |
| Dependence on Paynow | Payments stop or terms change | Payment adapter; Pesepay and EcoCash direct as backups; cash and manual methods always available |
| Currency policy changes | Prices, invoices and reports affected | Company-set rates; effective-dated rules; fast change process (§6.4) |
| Power and internet outages | Customers and support stop | Offline-first POS; support backup power and data; cloud hosting |
| Competitors copy features | Less differentiation | Speed, local support, partner network, integrated offering |
| Quality of AI-written code | Errors in money, tax, security | Tests, accountant-verified scenarios, scanning, staged releases, review |
| Key-person dependency | Business stalls | Written plan, password manager, second admin on critical accounts, early first hire |
| Data breach | Trust and legal penalties | Security plan (§14), isolation tests, penetration tests, incident plan |
| Slow SME adoption | Revenue below plan | Free plan, field agents, accountant partners, pilots, testimonials |
| Microsoft or hosting price rises | Lower margins | Margins built in, annual review, portable architecture |
| Public repositories | Plans and code copied | Make private now; rotate exposed keys |

## 24. Measuring success (one dashboard) {#s24}

One internal ZimERP dashboard brings together the numbers every part of this plan depends on:

| Area | Metrics | Section |
|---|---|---|
| Growth | Sign-ups per week, free-to-paid conversion, source of each customer, cost to acquire a paying customer | §18 |
| Revenue | Monthly recurring revenue, average revenue per company, add-on and resale income | §17, §22 |
| Retention | Monthly churn, customer health scores, at-risk companies | §19.3 |
| Support | Ticket volume, response and resolution times, satisfaction, share solved by AI | §19.5 |
| Platform | Uptime, errors, sync failures, performance budgets | §15 |
| Pilot | Pilot usage, conversion, feedback themes | §11.4 |
| Finance | Cash, monthly costs, months of runway | §22 |

---

# Appendices

## Appendix A. Decisions log {#appA}

| Area | Decision |
|---|---|
| Name | ZimERP (formerly ZimboBuz); check availability before registering |
| Offer | ERP plus website, store, Microsoft 365 email and domains, under each company's brand |
| Customisation | Companies choose modules and features; do-it-yourself or done-for-you setup |
| Apps | Staff only; PWA for all, branded Android/iOS on higher plans; no customer app |
| Design | Websites and stores as modern as possible, with motion throughout, controllable per company, fast on low-end phones |
| Branding | Companies customise colours, fonts, shapes and logos in one brand kit applied to every channel, document and app |
| Currency | Each company sets its own exchange rates; English-only interface |
| Payments | Paynow first; money goes straight to each company; ZimERP never holds funds |
| Email | Microsoft 365 via CSP, one tenant per company |
| Domains | ZimERP sells domains; `.co.zw` via name.co.zw; domain drives one-click setup |
| Backend | Supabase (PostgreSQL); PowerSync for offline |
| Multi-tenancy | Shared database with `company_id` and row-level security; dedicated database for Enterprise |
| Hosting | Vercel + Supabase while building; Azure Johannesburg at commercial scale; portable code; no cPanel hosting |
| On-premise | Available to Enterprise via self-hosted Supabase, protected by licence, key and cloud-held logic |
| Licensing | Proprietary, closed source; no GPL/AGPL code copied |
| Reuse | Build on Bromadex and Bravura, converted to multi-company |
| Patterns | Adopt the ERPNext and Odoo patterns in §2.4; light users and free portal users |

## Appendix B. Open questions {#appB}

1. Confirm the staff app scope: daily tasks only (recommended, §9.2) or every module.
2. Validate prices and module counts per plan with pilots (§17).
3. Confirm the first market: Release 1 targets retail and trading SMEs; Mining and Construction is positioned as the first Enterprise and industry bundle (Wave 4), with Bravura as the case study.
4. Choose the fifth website template from pilot feedback.
5. Confirm PowerSync licence terms for closed-source commercial use.
6. Decide whether Ask AI is included from Growth or sold only as usage.

Resolved since earlier notes: multi-tenancy (shared database, §12.2); release waves (§5.1); Release 1 scope (§11.2).

## Appendix C. Questions for partners {#appC}

**name.co.zw**

1. Is there a reseller or partner account, and what are wholesale prices per domain type?
2. Is there an API for availability, registration, renewal and nameserver changes?
3. Can domains be in the customer's name but managed from our account?
4. Can renewals be automatic and billed to us, and how early are reminders sent?
5. Can custom nameservers be set at registration?
6. How are transfers in and out handled?
7. What documents does `.co.zw` require, and how long does approval take?
8. Can we pay on account in USD and ZiG with monthly invoicing?
9. What partner support is offered?

**Paynow**

1. Is there a partner, reseller or referral programme for platforms?
2. Can a platform onboard merchants on their behalf, and how long does approval take?
3. Which methods support express checkout, in USD and ZiG?
4. Fees per method and currency, and settlement times?
5. Is there a test environment and result-notification documentation?
6. Is recurring billing or tokenised card payment supported?
7. Is there a settlement report or API for reconciliation?

**Microsoft distributor (CSP)**

1. Requirements and timeline to become an indirect reseller?
2. Current Microsoft 365 and Azure prices and margins in USD?
3. Billing terms and credit limits?
4. Support for tenant creation and delegated admin (GDAP) at scale?

**ZIMRA**

1. Process, requirements and timeline for fiscalisation software approval (FDMS)?
2. Test environment and technical documentation?
3. Requirements for offline fiscal days and receipt formats?

## Appendix D. Owner action checklist {#appD}

**Now**

- Make all ZimERP, Bromadex and Bravura repositories private.
- Rotate any API key ever committed to a repository; git-ignore `.env` files everywhere.
- Turn on two-step verification for GitHub, Supabase, Vercel and email.

**Before and during Release 1**

- Register the company; trademark search and filing; secure `zimerp.co.zw` and `zimerp.com`.
- Open accounts: Paynow merchant (for ZimERP subscriptions), name.co.zw, an international registrar, WhatsApp Business API.
- Start conversations with Paynow, a Microsoft distributor (CSP) and ZIMRA (Appendix C).
- Engage an accountant or tax adviser to verify accounting, tax and payroll scenarios.
- Recruit 5–10 pilot businesses.

**Before Azure move**

- Azure subscription through the Microsoft partnership; Microsoft for Startups application.

## Appendix E. Glossary {#appE}

| Term | Meaning |
|---|---|
| ZiG | Zimbabwe Gold, the local currency, used alongside USD |
| ZIMRA | Zimbabwe Revenue Authority |
| FDMS | ZIMRA's Fiscalisation Data Management System |
| PAYE, NSSA, AIDS Levy, ZIMDEF | Payroll taxes and statutory contributions |
| QPD | Quarterly payment dates for provisional income tax |
| ITF263 | ZIMRA tax clearance certificate |
| IMTT | Intermediated money transfer tax on electronic payments |
| POTRAZ | Regulator acting as data protection authority |
| ZIPO | Zimbabwe Intellectual Property Office |
| PWA | Progressive web app: a website installable on a phone's home screen |
| CSP, GDAP | Microsoft's Cloud Solution Provider programme and granular delegated admin |
| Row-level security | Database rules that restrict which rows each user can access |
| Tenant | One customer company on the shared platform |
| Light user / portal user | Low-cost limited staff user / free customer or supplier login |

## Appendix F. Sources {#appF}

- M&J Consultants, "Top ERP Software for Zimbabwe Retail" (mjconsultants.co.zw)
- Matiyas Solutions Zimbabwe (matiyas.com/en-zw)
- Unicorn Solutions ERP Systems (unicornsolutions.co.zw)
- YoERP (yoerp.co.zw)
- name.co.zw
- ERPNext (frappe.io/erpnext)
- Odoo apps and pricing (odoo.com)
- Owner's Bromadex and Bravura codebases

All external information was checked in October 2026 and should be re-checked before decisions.
