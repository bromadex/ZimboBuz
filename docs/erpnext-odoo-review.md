# ERPNext and Odoo Review: What ZimERP Adopts

Reviewed October 2026 from public product pages ([ERPNext](https://frappe.io/erpnext), [Odoo apps](https://www.odoo.com/page/all-apps), [Odoo pricing](https://www.odoo.com/pricing)).

**Licence rule:** ERPNext (GPL) and Odoo Community (LGPL) are studied for **ideas and patterns only**. No code, designs or assets are copied into ZimERP, which is closed source.

## Comparison

| | ERPNext | Odoo | ZimERP position |
|---|---|---|---|
| Model | Fully open source; pay for hosting (Frappe Cloud), no per-user fees | One app free; otherwise per user per month | Plan per company with users included |
| Price | Hosting from about $14/month | Standard about $25–39/user/month; Custom (Studio, multi-company, API) about $49–76/user/month; Light User $8.90 (figures as extracted; confirm on the live page) | Business $29, Growth $79 (15 users), Pro $199 |
| Strength | Accounting discipline, workflows, customisation | Polish, website builder, very wide app range | Built-in Zimbabwe features, local support, website + ERP + email in one |
| Zimbabwe gaps | No built-in ZiG, ZIMRA fiscalisation, EcoCash | Same, and per-user cost adds up | ZiG/USD, ZIMRA, EcoCash, NSSA/PAYE built in |

Example: 10 users on Odoo Standard ≈ $250–390/month; ZimERP Growth = $79 for 15 users.

## Adopted from ERPNext

| # | Pattern | ZimERP use | When |
|---|---|---|---|
| 1 | Document lifecycle: Draft → Submitted (locked) → Cancelled or Amended (new linked version) | All financial and stock documents; submitted documents can never be edited | Release 1 |
| 2 | Configurable naming series (e.g. `INV-2026-0001`) | Per document type and branch, with offline-safe device prefixes | Release 1 |
| 3 | Pricing rules engine | Discounts by quantity, customer group, date range, promotion | Wave 2 |
| 4 | Drag-and-drop print format designer | Invoices, quotes, receipts, statements; ZIMRA-compliant fiscal invoice layouts | Wave 2 (Release 1 ships fixed templates) |
| 5 | Custom fields and form layout without code; field-level permissions | e.g. hide cost price from cashiers | Field-level permissions in Release 1; custom fields Wave 2 |
| 6 | Workflow designer (states, transitions, approvers per document) | e.g. purchase order above a limit needs manager approval | Wave 2 |
| 7 | Connections panel on every document | Order → delivery → invoice → payment → return | Release 1 |
| 8 | POS profiles and shift opening/closing entries | Matches ZimERP till sessions with per-currency float and count | Release 1 |
| 9 | Data import tool with downloadable templates | Excel, Sage Pastel, QuickBooks migration | Release 1 (products, customers, suppliers, opening stock and balances) |
| 10 | Customer and supplier portals | Customers view invoices and statements and pay; suppliers confirm orders | Customer portal Release 1; supplier portal Wave 2 |

## Adopted from Odoo

| # | Pattern | ZimERP use | When |
|---|---|---|---|
| 1 | Chatter on every record: messages, internal notes, followers, scheduled activities | Activity panel on customers, invoices, orders, products, employees; "call this customer Friday" reminders | Release 1 |
| 2 | Edit the website directly on the live page | Click-to-edit text and images, drag-in blocks, built-in SEO settings | Release 1 (website builder) |
| 3 | Multiple views of the same data | List and card views in Release 1; calendar, pivot, graph, map, timeline/Gantt in later waves | Release 1 / later |
| 4 | Smart buttons with counts on records | "5 invoices", "2 deliveries" opening the related records (works with the Connections panel) | Release 1 |
| 5 | Studio (no-code builder) | **ZimERP Studio**: custom fields, screens, reports and automations; Pro and Enterprise feature | Wave 3 |
| 6 | Light users at a lower price | Users who only approve, request leave, view reports or use the staff app's self-service | Pricing from launch |
| 7 | Portal users are free | Customers and suppliers using portals never count as paying users | Pricing from launch |
| 8 | POS extras | Restaurant mode (table plans, kitchen printers/display), loyalty and gift cards, QR self-ordering | Wave 2 (loyalty/gift cards), Wave 4 (restaurant via Hospitality module) |
| 9 | Additional apps | Sign (e-signatures), Appointments, Field Service, Rental, Events and ticketing, Surveys, eLearning, website Live Chat, marketing automation | Added to the module catalogue for Waves 3–4 |
| 10 | AI document capture | Supplier invoices and receipts read by AI into draft bills and expenses | Wave 4 (AI features) |

## Not adopted

- **Complexity:** both overwhelm small businesses with menus and settings. ZimERP uses simple mode, feature toggles and role-based home screens.
- **Per-user pricing for everyone:** discourages SMEs. ZimERP keeps per-company plans, adding cheap light users.
- **Local requirements left to partners:** ZiG, ZIMRA, EcoCash and NSSA/PAYE are built into ZimERP, not add-ons.
