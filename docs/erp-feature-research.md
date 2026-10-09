# ERP Feature Research: Zimbabwe Market

Competitor and market research for ZimboBuz. Features below are what each vendor **claims** on its website (checked October 2026); none have been verified hands-on.

## Sources

| Tag | Source | Type | Notes |
|---|---|---|---|
| **MJ** | [M&J Consultants – Top ERP Software for Zimbabwe Retail](https://mjconsultants.co.zw/insights/top-erp-software-zimbabwe-retail/) | Article by an implementation consultancy | Covers Acumatica, Dynamics 365 Business Central + LS Retail, Odoo. No pricing, no drawbacks listed. |
| **Mt** | [Matiyas Solutions](https://www.matiyas.com/en-zw/) | ERPNext implementation partner | Most detailed Zimbabwe localisation claims. Stats counters show "0+", testimonials are non-Zimbabwean, page appears templated from other countries, +91 phone number. No prices. |
| **U** | [Unicorn Solutions](https://www.unicornsolutions.co.zw/erp-systems.html) | Harare IT company (hosting, web, CRM, ERP) | Only source with public pricing. Underlying ERP not named. No Zimbabwe-specific features (currency, ZIMRA, mobile money) listed. |
| **Y** | [YoERP](https://yoerp.co.zw/) | Cloud ERP product with iOS/Android apps | Widest set of industry modules. No pricing, no address/phone/email, no named clients. USD/ZWL only (no ZiG). |

## Consolidated features

### 1. Zimbabwe localisation

| Feature | Sources |
|---|---|
| Multi-currency: USD, ZWL, ZAR (EUR in Mt FAQ) | MJ, Mt, Y |
| ZiG support | Single "ZiG/USD" mention on Mt only |
| ZIMRA fiscalisation / fiscal device integration | Mt, Y |
| VAT 15%, zero-rated and exempt items, VAT return reporting | MJ, Mt, Y (sample invoice only) |
| Payroll in USD/ZWL | Mt |
| PAYE, NSSA, AIDS Levy, labour-law compliance | MJ (PAYE), Mt, U (generic) |
| Mobile money and payments: EcoCash, OneMoney, Telecash, Paynow, InnBucks | Mt |
| SMS via Econet, NetOne, Telecel | Mt |
| Offline mode for load-shedding, sync on reconnect | Mt |
| SADC multi-country consolidated reporting | Mt |
| Zimbabwe accounting standards | U |
| Standards Association of Zimbabwe (SAZ) quality compliance | Mt |

### 2. Accounting and finance
- Chart of accounts, general ledger, double-entry, journal entries (Mt, U, Y)
- Accounts payable/receivable, bank reconciliation (Mt, U)
- Cost centres (Mt)
- Budgets, budget vs actual, forecasting (Mt)
- Financial statements, multi-currency reports (all)
- Expenses: categories, recurring expenses, posting to the ledger (Mt, Y)
- Fixed assets with automatic depreciation (Y, Mt)
- Subscription and contract billing: recurring, maintenance contracts, renewals, usage-based (Mt)

### 3. Sales, POS and CRM
- Quotations/estimates that convert to orders or invoices, emailed to clients (Mt, U, Y)
- Sales orders, price lists, discounts, delivery tracking (Mt, U, Y)
- Multi-currency invoicing, payment tracking (Mt, Y)
- POS: barcode scanning, multi-store real-time sync, offline mode, mobile money, VAT (MJ, Mt, Y)
- Restaurant POS and kitchen display (MJ via LS Retail, Y)
- CRM: leads, opportunities, pipeline, activities, conversion to orders (MJ, Mt, Y)
- Campaigns by SMS, email and WhatsApp with templates (Y; Mt SMS/email)
- Website, e-commerce cart, customer portal, forms, blog, marketplace integration (MJ, Mt)
- Omnichannel: consistent pricing and stock online and in-store (MJ)

### 4. Inventory and warehousing
- Item master, stock ledger, real-time stock levels (all)
- Multi-warehouse/location, stock transfers (all)
- Batch and serial tracking (Mt, U)
- Stock valuation (Mt)
- Automatic reordering, low-stock alerts (MJ, Mt, U, Y)
- Stock takes and adjustments (Y)
- Demand forecasting (MJ, Mt)

### 5. Purchasing
- Suppliers, RFQs, purchase orders and invoices, returns (Mt, U, Y)
- Quote comparison, supplier evaluation (Mt, U)
- Automated procurement workflows (U)
- Supply chain management (U)

### 6. HR and payroll
- Employee records, attendance, leave (Mt, U, Y)
- Payroll with automatic payslips and tax calculation (Mt, U, Y)
- Performance tracking, recruitment (U)
- Expense claims (Mt)

### 7. Operations
- Manufacturing: bills of materials, work orders, production planning, capacity planning, job cards, shop floor (Mt, U)
- Projects: templates, tasks, timesheets, Gantt charts, budgets, billing (Mt, U)
- Quality: inspections, test plans, non-conformance (Mt, U)
- Assets and maintenance: preventive maintenance, service requests, downtime, asset history (Mt)
- Helpdesk: tickets, SLAs, portal, escalation (Mt)

### 8. Industry modules

| Industry | Features | Sources |
|---|---|---|
| Healthcare | Patients, appointments, lab, radiology, pharmacy, inpatient, maternity, insurance claims | Y, Mt (pharmacy) |
| Microfinance | Borrowers, applications, disbursements, repayments, collateral, IFRS 9 provisioning | Y |
| Hospitality | Bookings, guest folios, housekeeping, reservations | Y |
| Garages | Job cards, inspections, service history, reminders | Y |
| Fleet and logistics | Vehicles, drivers, routes, dispatch, fuel, incidents, telematics, 3PL | Y, Mt |
| Farming | Herds, seasons, inputs, production, field mapping | Y |
| Retail verticals | Apparel, quick-service restaurants, meat | MJ (LS Retail) |

### 9. Platform
- Cloud, on-premise or hybrid deployment (all)
- Mobile access and native apps (MJ, U, Y)
- Multi-branch with central control and consolidated reporting (all)
- Dashboards, KPIs, drill-down, BI, scheduled exports (all)
- AI insights, predictive analytics, pricing optimisation (MJ, Mt)
- IoT (Mt)
- Integrations: banking, mobile money, government portals, legacy systems, API (Mt, U)
- Custom workflows and modules, white-labelling (Mt, U)
- Security: encryption, multi-factor authentication, AI threat detection, backups (MJ, U, Y)

### 10. Pricing and services
- **Published pricing (U only):** SME $200/month (10 users), Business $500/month (50 users), Enterprise $1,000/month (unlimited users), Custom by quote
- Other models, no figures: fixed project price, per-user, time and materials, hourly, dedicated resource (Mt); free trial and demo (Y)
- Services: business analysis, implementation, data migration, customisation, training, support, 24/7 SLAs (Mt, U)

### Gaps no competitor clearly covers
- ZiG as a first-class currency
- Mobile money (EcoCash, Paynow) built into POS, claimed only by Mt
- Offline-first operation, claimed only by Mt
- Transparent pricing with self-service sign-up
- Evidence of real Zimbabwean customers

## Proposed additions for ZimboBuz

> Decisions: exchange rates are set by each company (no automatic RBZ feed). The interface is English only; Shona/Ndebele localisation is out of scope.

Features beyond the consolidated list, aimed at the gaps above and at how Zimbabwean businesses actually trade. Prioritised as **P1** (differentiator, build early), **P2** (strong value), **P3** (later).

### Money and currency
- **P1 – ZiG-first, USD-equal multi-currency.** Every price, invoice and report in ZiG and USD. **Each company sets its own exchange rates** (effective-dated, with history), and realised/unrealised FX gain/loss is posted automatically.
- **P1 – Split tender.** One sale paid partly in USD cash, partly in ZiG via EcoCash, partly by swipe, with correct change and per-currency till balances.
- **P1 – Change-shortage handling.** Issue small change as store credit, a voucher or a mobile-money refund, and track it as a liability.
- **P2 – Per-currency price lists and rounding rules** (e.g. round ZiG prices to the nearest note, USD to $0.05).
- **P2 – Per-currency bank and cash accounts** (nostro/FCA vs ZiG accounts), with bank statement import for local banks.

### Payments
- **P1 – Native payment integrations:** EcoCash, OneMoney, InnBucks, O'mari, Paynow, ZIPIT/Zimswitch, Visa/Mastercard. Send payment prompts from POS and invoices.
- **P1 – Automatic payment reconciliation:** match mobile-money and bank payments to invoices.
- **P2 – Payment links and QR codes** on invoices, WhatsApp messages and receipts.
- **P2 – IMTT tracking:** record the intermediated money transfer tax on electronic payments as a cost.

### Tax and compliance
- **P1 – Direct ZIMRA FDMS integration (virtual fiscal device):** fiscal receipts with QR codes, offline fiscal-day handling, and automatic submission on reconnect, with no separate hardware box needed.
- **P1 – Statutory returns generated from data:** VAT returns, monthly PAYE (P2), NSSA (P4), ZIMDEF, AIDS Levy, and annual employee tax certificates.
- **P2 – Compliance calendar** with WhatsApp/SMS reminders for VAT, PAYE, QPD dates (25 Mar, 25 Jun, 25 Sep, 20 Dec) and NSSA.
- **P2 – Supplier tax clearance (ITF263) tracking**, with automatic withholding tax when a supplier's clearance is missing or expired.
- **P3 – Customs landed costs:** duty, freight, clearing agent fees and Beitbridge transport added to item cost for imported stock.

### Reliability and access
- **P1 – Offline-first by design.** The POS, invoicing and stock work fully offline, sync when the connection returns, and resolve conflicts automatically.
- **P1 – Low-data mode** for expensive mobile data: compressed sync and text-only views.
- **P2 – Runs on cheap Android phones and tablets**, with Bluetooth thermal printers and phone-camera barcode scanning.
- **P2 – USSD and SMS fallback** for owners to check daily sales, stock or balances without data.

### WhatsApp-first commerce
- **P1 – Send invoices, receipts, quotes and statements by WhatsApp** in one tap.
- **P2 – WhatsApp catalogue and ordering:** customers browse and order through WhatsApp, and orders appear in the system.
- **P2 – Daily owner summary on WhatsApp:** sales, cash by currency, low stock, and overdue debtors.
- **P3 – WhatsApp assistant for customers:** check balances, request statements, track deliveries.

### SME and informal-trade realities
- **P1 – Simple mode:** a stripped-down interface for small shops (sell, stock, cash-up) that can upgrade to the full ERP.
- **P1 – Cash-up and till control:** opening and closing floats per currency, cashier shortages and overs, void and discount audit trail.
- **P2 – Credit sales ledger ("chikwereti" book):** customer credit limits, automatic reminders, and partial payments.
- **P2 – Lay-bys and instalment sales.**
- **P2 – Diaspora purchasing:** relatives abroad pay for goods or vouchers online, and the family collects in-store.
- **P3 – Loyalty points and gift cards.**

### Migration and growth
- **P1 – Import from Excel, Sage Pastel, QuickBooks and Tally**, which Zimbabwean SMEs commonly use today.
- **P2 – Accountant portal:** one login for a bookkeeper or accountant to manage many client companies.
- **P2 – Open REST API and webhooks.**
- **P3 – AI help:** ask questions about the business in plain language, read supplier invoices and receipts automatically, and forecast demand.

### Commercial model
- **P1 – Public pricing in USD and ZiG, payable monthly by EcoCash or card**, with self-service sign-up.
- **P1 – Free tier** for a single user or till, to compete with spreadsheets and exercise books.
- **P2 – Industry starter templates** (retail, hardware, pharmacy, restaurant, agro-dealer) that set up chart of accounts, taxes and products in minutes.
