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
      { href: "/sales/quotes", label: "Quotes", anyOf: ["sales.view"] },
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
      { href: "/settings/billing", label: "Subscription", anyOf: ["admin.billing.manage"] },
      { href: "/settings/audit", label: "Audit log", anyOf: ["admin.audit.view"] },
    ],
  },
];

export function visibleNav(permissions: Set<string>): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.anyOf.length === 0 || i.anyOf.some((p) => permissions.has(p))),
  })).filter((g) => g.items.length > 0);
}
