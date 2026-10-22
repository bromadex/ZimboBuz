import { DEFAULT_TERMS, type Terms } from "@/lib/terms";

// The ERP menu. An item shows when the user has any of its permissions;
// permissions already account for the plan, switched-off modules and features,
// read-only companies and light users (app.can), so no other checks are needed.

export interface NavItem {
  href: string;
  label: string;
  /** Shown when the user has at least one of these. Empty: everyone. */
  anyOf: string[];
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: null, items: [{ href: "/", label: "Home", anyOf: [] }] },
  {
    label: "Sell",
    items: [
      { href: "/pos", label: "Till", anyOf: ["pos.sell"] },
      { href: "/sales/quotes", label: "Quotes", anyOf: ["sales.quote.create"] },
      { href: "/sales/invoices", label: "Invoices", anyOf: ["sales.view"] },
      { href: "/sales/payments", label: "Payments", anyOf: ["sales.view"] },
      { href: "/sales/credit-notes", label: "Credit notes and refunds", anyOf: ["sales.view"] },
      { href: "/sales/debtors", label: "Credit book", anyOf: ["sales.view"] },
      { href: "/customers", label: "Customers", anyOf: ["core.customers.view"] },
      { href: "/leads", label: "Enquiries", anyOf: ["sales.view"] },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/products", label: "Products", anyOf: ["core.products.view"] },
      { href: "/stock", label: "Stock levels", anyOf: ["inventory.view"] },
      { href: "/stock/movements", label: "Stock movements", anyOf: ["inventory.view"] },
      { href: "/stock/takes", label: "Stock takes", anyOf: ["inventory.view"] },
    ],
  },
  {
    label: "Website",
    items: [
      { href: "/website", label: "Website and store", anyOf: ["website.view"] },
      { href: "/settings/domains", label: "Domains", anyOf: ["admin.domains.manage"] },
    ],
  },
  {
    label: "Grow",
    items: [
      { href: "/crm", label: "CRM pipeline", anyOf: ["crm.view"] },
      { href: "/crm/campaigns", label: "Campaigns", anyOf: ["crm.view"] },
      { href: "/projects", label: "Projects", anyOf: ["projects.view"] },
      { href: "/helpdesk", label: "Helpdesk", anyOf: ["helpdesk.view"] },
      { href: "/subscriptions", label: "Subscriptions", anyOf: ["subscriptions.view"] },
      { href: "/signatures", label: "E-signatures", anyOf: ["esign.view"] },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/manufacturing", label: "Manufacturing", anyOf: ["manufacturing.view"] },
      { href: "/maintenance", label: "Assets and maintenance", anyOf: ["maintenance.view"] },
      { href: "/field-service", label: "Field service", anyOf: ["field_service.view"] },
      { href: "/rental", label: "Rental", anyOf: ["rental.view"] },
      { href: "/fleet", label: "Fleet and fuel", anyOf: ["fleet.view"] },
    ],
  },
  {
    label: "Engage",
    items: [
      { href: "/appointments", label: "Appointments", anyOf: ["appointments.view"] },
      { href: "/events", label: "Events and tickets", anyOf: ["events.view"] },
      { href: "/surveys", label: "Surveys and forms", anyOf: ["surveys.view"] },
      { href: "/learning", label: "eLearning", anyOf: ["elearning.view"] },
    ],
  },
  {
    label: "Industry",
    items: [
      { href: "/mining", label: "Mining and construction", anyOf: ["mining.view"] },
      { href: "/clinic", label: "Clinic", anyOf: ["healthcare.view"] },
      { href: "/loans", label: "Loans", anyOf: ["microfinance.view"] },
      { href: "/restaurant", label: "Restaurant", anyOf: ["hospitality.view"] },
      { href: "/garage", label: "Garage", anyOf: ["garage.view"] },
      { href: "/farm", label: "Farm", anyOf: ["farming.view"] },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/ai", label: "Ask AI", anyOf: ["ai.view"] },
      { href: "/ai/capture", label: "Read receipts and bills", anyOf: ["ai.view"] },
      { href: "/ai/forecasts", label: "Forecasts", anyOf: ["ai.view"] },
      { href: "/ai/benchmarks", label: "Benchmarks", anyOf: ["ai.view"] },
      { href: "/iot", label: "Devices and sensors", anyOf: ["iot.view"] },
    ],
  },
  { label: "Reports", items: [{ href: "/reports", label: "Reports", anyOf: ["reports.view"] }] },
  {
    label: "Settings",
    items: [
      { href: "/settings/company", label: "Company", anyOf: ["admin.company.edit", "core.settings.tax"] },
      { href: "/settings/users", label: "Users", anyOf: ["admin.users.manage"] },
      { href: "/settings/roles", label: "Roles", anyOf: ["admin.roles.manage"] },
      { href: "/settings/modules", label: "Modules and features", anyOf: ["admin.modules.manage"] },
      { href: "/settings/rates", label: "Exchange rates", anyOf: [] },
      { href: "/settings/branding", label: "Brand kit", anyOf: ["admin.branding.edit"] },
      { href: "/settings/payments", label: "Payment gateways", anyOf: ["admin.company.edit"] },
      { href: "/settings/notifications", label: "Notifications", anyOf: ["admin.company.edit"] },
      { href: "/settings/import", label: "Import data", anyOf: ["core.products.create", "core.customers.create"] },
      { href: "/settings/studio", label: "Studio (custom fields)", anyOf: ["studio.manage"] },
      { href: "/settings/api", label: "API and webhooks", anyOf: ["api.manage"] },
      { href: "/settings/billing", label: "Subscription", anyOf: ["admin.billing.manage"] },
      { href: "/settings/audit", label: "Audit log", anyOf: ["admin.audit.view"] },
    ],
  },
];

/** Menu labels in the company's own words (a church sees Members, a school Fees). */
const TERM_LABELS: Record<string, keyof Terms> = { "/customers": "customers", "/products": "products", "/sales/invoices": "invoices" };

export function visibleNav(permissions: Set<string>, terms: Terms = DEFAULT_TERMS): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => i.anyOf.length === 0 || i.anyOf.some((p) => permissions.has(p)))
      .map((i) => (TERM_LABELS[i.href] ? { ...i, label: terms[TERM_LABELS[i.href]] } : i)),
  })).filter((g) => g.items.length > 0);
}
