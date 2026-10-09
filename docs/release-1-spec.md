# ZimERP Release 1 Specification

Status: draft for review. Release 1 is Wave 1 from [product-vision.md](product-vision.md): enough for a small retailer or trader to run daily business on ZimERP and pay for it.

## Goal

A shop with 1–5 tills can sign up, set up its products, sell in ZiG and USD (cash, EcoCash, card), manage stock, issue quotes and invoices, take payments through Paynow, run a branded website and store on its own domain, and keep working during load-shedding.

## In scope

| Area | Included |
|---|---|
| Platform | Company sign-up, plans and subscriptions, module and feature toggles, branding, custom domain, PWA, audit log |
| Core | Company, branches, users, roles and permissions, currencies and company-set exchange rates, customers, suppliers, products |
| POS | Offline-first sales, split tender, change handling, tills and cash-up, EcoCash express checkout, receipts (print and WhatsApp) |
| Inventory | Warehouses/locations, stock movements, transfers, stock takes, low-stock alerts, valuation |
| Sales and invoicing | Quotes, invoices, payments, credit book, customer statements |
| Payments | Paynow (EcoCash, OneMoney, InnBucks, cards), payment links and QR codes, reconciliation |
| Website and store | 2 templates at launch (5 by end of Wave 2), drag-and-drop page editor, store with Buy and Add-to-quote, motion presets |
| Reports | Daily sales by currency and payment method, cash-up report, stock on hand and valuation, low stock, debtors ageing |

## Out of scope (later waves)

- ZIMRA fiscalisation, payroll, tax returns, purchasing workflows (Wave 2)
- Microsoft 365 provisioning automation (Wave 2; Release 1 supports manual setup of email DNS records)
- CRM pipeline, projects, manufacturing, helpdesk (Wave 3)
- Industry modules, AI assistant, IoT (Wave 4)
- Branded APK and iOS builds (after Release 1; PWA only at launch)

## Features and acceptance criteria

### P1. Company sign-up and setup
- A new company signs up with name, email or phone, and password; gets a `name.zimerp.co.zw` address immediately.
- Setup checklist: company details, logo and colours, base currency, exchange rate, first branch, first product, Paynow keys, first sale.
- **Done when:** a new user goes from sign-up to a completed first sale in under 15 minutes without help.

### P2. Plans, modules and features
- Plans from [Pricing](product-vision.md#pricing-proposal-to-validate-with-pilot-customers) control user, module and branch limits.
- Company admins switch modules and individual features on or off within their plan.
- **Done when:** turning a feature off hides it from menus, screens and the API for every user in that company, and a test proves it.

### P3. Users, roles and permissions
- Default roles: Owner, Manager, Cashier, Storekeeper, Accountant; custom roles allowed.
- Permissions per module action (view, create, edit, delete, approve) following the Bravura model.
- Two-step verification required for Owner and admin roles.
- **Done when:** a Cashier cannot refund, void without manager PIN, change prices or see cost prices, verified by automated tests.

### P4. Currencies and exchange rates
- USD and ZiG enabled by default; ZAR optional.
- Company sets its own exchange rates with effective date and time; full history kept.
- Each product can have a price per currency, or one currency converted at the current rate with configurable rounding (e.g. ZiG to the nearest note, USD to $0.05).
- **Done when:** a sale and its invoice always record the rate used, and changing the rate later never changes past documents.

### P5. POS
- Works fully offline (PowerSync): products, prices, customers and open till session available without internet; sales queue and sync on reconnect.
- **Split tender:** one sale paid by any mix of USD cash, ZiG cash, EcoCash, card, store credit.
- **Change handling:** change in either currency; if exact change is unavailable, issue store credit, a voucher or an EcoCash refund, tracked as a liability.
- **Tills:** open with float per currency; close with counted cash per currency; variance recorded per cashier.
- Barcode scanning (camera or scanner), quick search, discounts within permission limits, voids and refunds with manager PIN.
- Receipts: Bluetooth thermal printer (58mm and 80mm) and WhatsApp.
- **Done when:** with the network disconnected, a cashier completes 50 sales including split tender, reconnects, and all sales, stock movements and till totals are correct on the server.

### P6. EcoCash express checkout
- Cashier enters the customer's number; the customer approves on their phone; the sale completes on confirmation.
- Timeout and failure handling: retry, switch payment method, or cancel without leaving a half-paid sale.
- **Done when:** in the Paynow test environment, success, decline, timeout and duplicate-notification cases all leave the sale and the payment in the correct state.

### P7. Inventory
- Locations per branch; every stock change is a movement (receipt, sale, transfer, adjustment, return); stock cannot go negative unless the company enables it.
- Stock take with variance report and approval.
- Low-stock alerts by reorder level, shown on the dashboard and sent by WhatsApp to the owner.
- Valuation by weighted average cost.
- **Done when:** stock on hand always equals the sum of movements, proved by a database check and tests.

### P8. Quotes, invoices and payments
- Quotes convert to invoices; invoices in USD or ZiG; partial payments; credit notes.
- Credit book: customer credit limits, balances, ageing, WhatsApp reminders.
- Statements sent as PDF by WhatsApp and email.
- Payment links and QR codes via Paynow on invoices and quotes.
- **Done when:** a Paynow payment against an invoice marks it paid automatically, and a missed notification is caught by the status check within 15 minutes.

### P9. Website and store
- 2 templates, each with its own motion style; logo, colours and fonts applied automatically.
- Drag-and-drop editor with blocks (hero, text, image, gallery, product grid, contact form, testimonials, map, WhatsApp button); each block has an entrance animation option; company motion setting Off / Subtle / Rich.
- Store shows ERP products and stock; Buy (Paynow checkout) and Add-to-quote (quote request becomes a lead and a draft quote).
- Custom domain: company enters its domain (bought via name.co.zw), points nameservers or records, and SSL is issued automatically.
- **Done when:** a store page scores at least 85 on mobile Lighthouse performance on a mid-range Android phone profile, and an order placed on the store appears in the ERP within 10 seconds.

### P10. Reports and dashboard
- Owner dashboard: today's sales by currency and payment method, cash in tills, top products, low stock, debtors.
- Daily WhatsApp summary to the owner.
- Export every report to Excel and PDF.

### P11. ZimERP subscription billing
- Monthly invoice per company, Paynow payment link, reminders, grace period, then read-only mode.
- **Done when:** an unpaid company becomes read-only after the grace period but can still log in and export all data.

### P12. Audit log
- Every create, edit, void, refund, price change and permission change logged with user, time, before and after.

## Supported devices (Release 1)
See [Supported devices](product-vision.md#supported-devices).

## Release checklist
- All acceptance criteria above pass in automated tests.
- Company isolation tests pass.
- Accounting accuracy tests agreed with an accountant pass.
- Penetration test completed and critical findings fixed.
- Help centre articles and videos for every P-feature.
- 5–10 pilot companies have used it for at least 4 weeks.
