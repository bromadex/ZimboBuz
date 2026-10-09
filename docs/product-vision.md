# ZimboBuz Product Vision

Status: brainstorming. This records decisions made so far; nothing here is built yet.

## Pitch

One Zimbabwean business platform with every feature competitors offer (see [erp-feature-research.md](erp-feature-research.md)), ZiG-ready, offline-capable, with transparent pricing, sold under each company's own brand.

## What a company gets

### 1. Public side (web only, for the company's customers)
- **Website:** choose from ~5 templates, connect their own domain, set logo and colours, edit pages with a drag-and-drop editor.
- **Online store:** template-based, connected to ERP stock and prices, takes ZiG/USD and Paynow.
- No customer-facing mobile app.

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

## Decisions log
- Exchange rates are set by each company (no automatic RBZ feed).
- Interface is English only.
- Mobile apps are for staff (ERP) only, not for customers.
- PWA for everyone; branded APK/iOS builds on a premium plan.

## Open questions
- Which modules and features ship in the first release?
- Do the mobile apps include every module, or daily tasks only (POS, stock, approvals, dashboard) with the rest on the web?
- Pricing per module, bundles, setup fees, premium app tier.
- First target industries and pilot customers.
