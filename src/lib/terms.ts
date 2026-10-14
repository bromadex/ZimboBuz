// The words a company uses for the people and things it deals with, from its
// industry (public.industries.terms): a church has members and giving types,
// a school has parents and fees. Anything the industry does not set keeps
// the ordinary word.

export interface Terms {
  customer: string;
  customers: string;
  product: string;
  products: string;
  invoice: string;
  invoices: string;
}

export const DEFAULT_TERMS: Terms = {
  customer: "Customer",
  customers: "Customers",
  product: "Product",
  products: "Products",
  invoice: "Invoice",
  invoices: "Invoices",
};

export function termsFrom(raw: unknown): Terms {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_TERMS };
  for (const key of Object.keys(out) as (keyof Terms)[]) {
    const v = r[key];
    if (typeof v === "string" && v.trim() && v.length <= 40) out[key] = v.trim();
  }
  return out;
}
