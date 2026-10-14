// Where each kind of record lives in the ERP, for links between records
// (connections panel, activity lists, search results).

export interface DoctypeRoute {
  list: string;
  detail?: (id: string) => string;
  /** Link column on this doctype's table → list filter parameter. */
  filters?: Record<string, string>;
}

export const DOCTYPE_ROUTES: Record<string, DoctypeRoute> = {
  customer: { list: "/customers", detail: (id) => `/customers/${id}` },
  product: { list: "/products", detail: (id) => `/products/${id}` },
  quote: { list: "/sales/quotes", detail: (id) => `/sales/quotes/${id}`, filters: { customer_id: "customer", lead_id: "lead" } },
  sales_invoice: {
    list: "/sales/invoices",
    detail: (id) => `/sales/invoices/${id}`,
    filters: { customer_id: "customer", quote_id: "quote", till_session_id: "session" },
  },
  payment: { list: "/sales/payments", detail: (id) => `/sales/payments/${id}`, filters: { customer_id: "customer", till_session_id: "session" } },
  credit_note: { list: "/sales/credit-notes", detail: (id) => `/sales/credit-notes/${id}`, filters: { invoice_id: "invoice", customer_id: "customer" } },
  refund: { list: "/sales/refunds", detail: (id) => `/sales/refunds/${id}`, filters: { customer_id: "customer", till_session_id: "session" } },
  lead: { list: "/leads", filters: { customer_id: "customer" } },
  stock_movement: {
    list: "/stock/movements",
    detail: (id) => `/stock/movements/${id}`,
    filters: { product_id: "product", source_id: "source" },
  },
  stock_take: { list: "/stock/takes", detail: (id) => `/stock/takes/${id}` },
  till_session: { list: "/pos/sessions", detail: (id) => `/pos/sessions/${id}` },
};

/** List link for records of `doctype` connected through `column` to `recordId`, if the list supports it. */
export function connectionHref(doctype: string, column: string, recordId: string): string | null {
  const route = DOCTYPE_ROUTES[doctype];
  const param = route?.filters?.[column];
  return route && param ? `${route.list}?${param}=${encodeURIComponent(recordId)}` : null;
}

export function recordHref(doctype: string, id: string): string | null {
  return DOCTYPE_ROUTES[doctype]?.detail?.(id) ?? null;
}
