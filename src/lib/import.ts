// Checking rows of a CSV import (P18) before anything is saved: products
// (with optional opening stock) and customers. Every problem is reported per
// row in plain English, including duplicates against existing records and
// within the file. Pure functions, so the same checks run for the preview and
// again, inside the import's transaction, when the import is confirmed.

import { toCsv } from "./csv";
import { parseMoney, type CurrencyCode } from "./money";

export type ImportKind = "products" | "customers";

export const MAX_IMPORT_ROWS = 5000;

interface ColumnSpec {
  key: string;
  /** Header written in the template. `{base}` becomes the base currency. */
  header: string;
  aliases: string[];
}

const PRODUCT_COLUMNS: ColumnSpec[] = [
  { key: "sku", header: "code", aliases: ["code", "product code", "item code", "sku"] },
  { key: "name", header: "name", aliases: ["name", "product name", "product", "item name"] },
  { key: "price", header: "price ({base})", aliases: ["price", "selling price", "sale price"] },
  { key: "unit", header: "unit", aliases: ["unit", "uom", "unit of measure"] },
  { key: "tax", header: "vat type", aliases: ["vat type", "vat", "tax", "tax type", "tax code"] },
  { key: "barcode", header: "barcode", aliases: ["barcode", "bar code", "ean"] },
  { key: "reorder", header: "reorder level", aliases: ["reorder level", "reorder", "reorder point", "minimum stock"] },
  { key: "qty", header: "opening quantity", aliases: ["opening quantity", "opening qty", "opening stock", "quantity", "qty"] },
  { key: "cost", header: "unit cost ({base})", aliases: ["unit cost", "cost", "cost price"] },
];

const CUSTOMER_COLUMNS: ColumnSpec[] = [
  { key: "name", header: "name", aliases: ["name", "customer name", "contact name", "full name"] },
  { key: "company", header: "business name", aliases: ["business name", "business", "company", "company name"] },
  { key: "phone", header: "phone", aliases: ["phone", "phone number", "mobile", "cell", "cellphone"] },
  { key: "whatsapp", header: "whatsapp", aliases: ["whatsapp", "whatsapp number"] },
  { key: "email", header: "email", aliases: ["email", "email address", "e mail"] },
  { key: "currency", header: "currency", aliases: ["currency", "usually pays in"] },
];

export const COLUMNS: Record<ImportKind, ColumnSpec[]> = { products: PRODUCT_COLUMNS, customers: CUSTOMER_COLUMNS };

const LABEL: Record<CurrencyCode, string> = { USD: "USD", ZWG: "ZiG", ZAR: "ZAR" };

export function templateHeaders(kind: ImportKind, base: CurrencyCode): string[] {
  return COLUMNS[kind].map((c) => c.header.replace("{base}", LABEL[base]));
}

/** A template CSV with two example rows. */
export function templateCsv(kind: ImportKind, base: CurrencyCode): string {
  const examples =
    kind === "products"
      ? [
          ["CEM-50", "Cement 50kg", "12.50", "bag", "standard", "6001234567890", "20", "100", "9.80"],
          ["DELIVERY", "Delivery within town", "5.00", "each", "exempt", "", "", "", ""],
        ]
      : [
          ["Tendai Moyo", "", "077 123 4567", "", "tendai@example.com", LABEL[base]],
          ["Rudo Chikore", "Chikore Builders", "+263 71 234 5678", "+263 71 234 5678", "", "USD"],
        ];
  return toCsv([templateHeaders(kind, base), ...examples]);
}

function normaliseHeader(h: string): string {
  return h
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Last 9 digits of a phone number, as app.phone_key does in the database. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? digits.slice(-9) : null;
}

export function parseTaxCode(value: string): "standard" | "zero_rated" | "exempt" | null {
  const v = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["", "standard", "standard vat", "standard rated", "standard rate", "vat"].includes(v)) return "standard";
  if (["zero rated", "zero", "zero rate", "zerorated", "0", "0%"].includes(v)) return "zero_rated";
  if (["exempt", "exempted", "vat exempt"].includes(v)) return "exempt";
  return null;
}

export function parseCurrency(value: string): CurrencyCode | null {
  const v = value.trim().toUpperCase();
  if (v === "USD" || v === "US$" || v === "$") return "USD";
  if (v === "ZWG" || v === "ZIG") return "ZWG";
  if (v === "ZAR" || v === "R" || v === "RAND") return "ZAR";
  return null;
}

function parseAmount(value: string): number | null {
  const v = value.trim().replace(/^(US)?\$\s*/i, "");
  try {
    const cents = parseMoney(v);
    return cents < 0 ? null : cents;
  } catch {
    return null;
  }
}

/** "1,250.5" → "1250.5"; null when not a number of at most 3 decimal places. */
function parseQuantity(value: string): string | null {
  const v = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,3})?$/.test(v)) return null;
  return v.replace(/^0+(?=\d)/, "");
}

export interface ProductImportRow {
  sku: string;
  name: string;
  priceCents: number;
  unit: string;
  taxCode: "standard" | "zero_rated" | "exempt";
  barcode: string | null;
  reorderLevel: string | null;
  openingQty: string | null;
  unitCostCents: number | null;
}

export interface CustomerImportRow {
  name: string;
  companyName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  currency: CurrencyCode;
}

export interface CheckedRow<T> {
  /** Row number as a spreadsheet shows it (the header is row 1). */
  row: number;
  cells: Record<string, string>;
  value: T | null;
  errors: string[];
}

export interface ImportCheck<T> {
  kind: ImportKind;
  /** Problems with the file as a whole; nothing can be imported while there are any. */
  fileErrors: string[];
  /** Columns that were not recognised and will be ignored. */
  ignored: string[];
  /** Recognised column keys, in file order. */
  columns: string[];
  rows: CheckedRow<T>[];
  /** Number of rows with at least one problem. */
  errorRows: number;
}

export interface ExistingProducts {
  /** Lower-case codes of every product, archived ones included (codes are never reused). */
  skus: Set<string>;
  /** Barcodes of live products. */
  barcodes: Set<string>;
}

export interface ExistingCustomers {
  /** Lower-case emails of live customers. */
  emails: Set<string>;
  /** Phone keys (last 9 digits) of live customers. */
  phoneKeys: Set<string>;
}

function mapColumns(kind: ImportKind, header: string[]) {
  const specs = COLUMNS[kind];
  const index = new Map<string, number>();
  const ignored: string[] = [];
  const fileErrors: string[] = [];
  header.forEach((h, i) => {
    const n = normaliseHeader(h);
    if (!n) return;
    const spec = specs.find((s) => s.aliases.includes(n));
    if (!spec) ignored.push(h.trim());
    else if (index.has(spec.key)) fileErrors.push(`The column "${h.trim()}" appears twice. Keep only one.`);
    else index.set(spec.key, i);
  });
  return { index, ignored, fileErrors };
}

interface Prepared {
  fileErrors: string[];
  ignored: string[];
  index: Map<string, number>;
  body: Array<{ row: number; fields: string[] }>;
}

function prepare(kind: ImportKind, table: string[][], required: Array<[string, string]>): Prepared {
  const fileErrors: string[] = [];
  if (table.length === 0) {
    return { fileErrors: ["The file is empty. Download the template to see what it should look like."], ignored: [], index: new Map(), body: [] };
  }
  const { index, ignored, fileErrors: headerErrors } = mapColumns(kind, table[0]);
  fileErrors.push(...headerErrors);
  for (const [key, label] of required) {
    if (!index.has(key)) fileErrors.push(`The first row must name the columns, including "${label}". Download the template to see the column names.`);
  }
  const body = table
    .slice(1)
    .map((fields, i) => ({ row: i + 2, fields }))
    .filter((r) => r.fields.some((f) => f.trim() !== ""));
  if (body.length === 0) fileErrors.push("There are no rows to import under the column names.");
  if (body.length > MAX_IMPORT_ROWS) fileErrors.push(`A file can have at most ${MAX_IMPORT_ROWS.toLocaleString("en-GB")} rows. Split it into smaller files.`);
  return { fileErrors, ignored, index, body };
}

function cellsOf(index: Map<string, number>, fields: string[]): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const [key, i] of index) cells[key] = (fields[i] ?? "").trim();
  return cells;
}

export function checkProducts(table: string[][], existing: ExistingProducts, base: CurrencyCode): ImportCheck<ProductImportRow> {
  const { fileErrors, ignored, index, body } = prepare("products", table, [
    ["sku", "code"],
    ["name", "name"],
    ["price", "price"],
  ]);
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const cur = LABEL[base];
  const rows = fileErrors.length
    ? []
    : body.map(({ row, fields }): CheckedRow<ProductImportRow> => {
        const c = cellsOf(index, fields);
        const errors: string[] = [];
        const sku = c.sku ?? "";
        const name = c.name ?? "";
        if (!sku) errors.push("The product code is missing.");
        else if (sku.length > 60) errors.push("The product code is too long (60 characters at most).");
        else if (existing.skus.has(sku.toLowerCase())) errors.push(`A product with the code ${sku} already exists.`);
        else if (seenSku.has(sku.toLowerCase())) errors.push(`The code ${sku} is also used on row ${seenSku.get(sku.toLowerCase())}.`);
        if (sku) seenSku.set(sku.toLowerCase(), seenSku.get(sku.toLowerCase()) ?? row);
        if (!name) errors.push("The name is missing.");
        else if (name.length > 200) errors.push("The name is too long (200 characters at most).");

        const priceCents = c.price ? parseAmount(c.price) : null;
        if (!c.price) errors.push(`The price is missing. Write the selling price in ${cur}, like 12.50.`);
        else if (priceCents === null) errors.push(`The price "${c.price}" is not a valid amount. Write it like 12.50.`);

        const taxCode = parseTaxCode(c.tax ?? "");
        if (!taxCode) errors.push(`The VAT type "${c.tax}" is not known. Use standard, zero-rated or exempt.`);

        const barcode = c.barcode || null;
        if (barcode) {
          if (existing.barcodes.has(barcode)) errors.push(`Another product already has the barcode ${barcode}.`);
          else if (seenBarcode.has(barcode)) errors.push(`The barcode ${barcode} is also used on row ${seenBarcode.get(barcode)}.`);
          if (!seenBarcode.has(barcode)) seenBarcode.set(barcode, row);
        }

        let reorderLevel: string | null = null;
        if (c.reorder) {
          reorderLevel = parseQuantity(c.reorder);
          if (reorderLevel === null) errors.push(`The reorder level "${c.reorder}" is not a valid quantity.`);
        }

        let openingQty: string | null = null;
        let unitCostCents: number | null = null;
        if (c.qty) {
          openingQty = parseQuantity(c.qty);
          if (openingQty === null) errors.push(`The opening quantity "${c.qty}" is not a valid quantity.`);
          else if (Number(openingQty) === 0) openingQty = null;
        }
        if (c.cost) {
          unitCostCents = parseAmount(c.cost);
          if (unitCostCents === null) errors.push(`The unit cost "${c.cost}" is not a valid amount. Write it like 9.80.`);
        }
        if (openingQty !== null && !c.cost) errors.push(`Give the unit cost (in ${cur}) of the opening stock, so stock is valued correctly.`);

        const value =
          errors.length === 0
            ? {
                sku,
                name,
                priceCents: priceCents!,
                unit: (c.unit || "each").slice(0, 30),
                taxCode: taxCode!,
                barcode,
                reorderLevel,
                openingQty,
                unitCostCents: openingQty === null ? null : unitCostCents,
              }
            : null;
        return { row, cells: c, value, errors };
      });
  return { kind: "products", fileErrors, ignored, columns: [...index.keys()], rows, errorRows: rows.filter((r) => r.errors.length).length };
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function checkCustomers(table: string[][], existing: ExistingCustomers, base: CurrencyCode): ImportCheck<CustomerImportRow> {
  const { fileErrors, ignored, index, body } = prepare("customers", table, [["name", "name"]]);
  const seenEmail = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const rows = fileErrors.length
    ? []
    : body.map(({ row, fields }): CheckedRow<CustomerImportRow> => {
        const c = cellsOf(index, fields);
        const errors: string[] = [];
        const companyName = c.company || null;
        const name = c.name || companyName || "";
        if (!name) errors.push("The name is missing.");
        else if (name.length > 200) errors.push("The name is too long (200 characters at most).");

        const email = c.email ? c.email.toLowerCase() : null;
        if (email) {
          if (!EMAIL.test(email)) errors.push(`The email address "${c.email}" does not look right.`);
          else if (existing.emails.has(email)) errors.push(`A customer with the email ${email} already exists.`);
          else if (seenEmail.has(email)) errors.push(`The email ${email} is also used on row ${seenEmail.get(email)}.`);
          if (!seenEmail.has(email)) seenEmail.set(email, row);
        }

        const phone = c.phone || null;
        const key = phoneKey(phone);
        if (phone) {
          if (!key || key.length < 9 || /[a-z]/i.test(phone)) errors.push(`The phone number "${phone}" looks too short or has letters in it.`);
          else if (existing.phoneKeys.has(key)) errors.push(`A customer with the phone number ${phone} already exists.`);
          else if (seenPhone.has(key)) errors.push(`The phone number ${phone} is also used on row ${seenPhone.get(key)}.`);
          if (key && !seenPhone.has(key)) seenPhone.set(key, row);
        }
        const whatsapp = c.whatsapp || null;
        if (whatsapp && ((phoneKey(whatsapp)?.length ?? 0) < 9 || /[a-z]/i.test(whatsapp))) {
          errors.push(`The WhatsApp number "${whatsapp}" looks too short or has letters in it.`);
        }

        const currency = c.currency ? parseCurrency(c.currency) : base;
        if (!currency) errors.push(`The currency "${c.currency}" is not known. Use USD, ZiG or ZAR.`);

        const value = errors.length === 0 ? { name, companyName, phone, whatsapp, email, currency: currency! } : null;
        return { row, cells: c, value, errors };
      });
  return { kind: "customers", fileErrors, ignored, columns: [...index.keys()], rows, errorRows: rows.filter((r) => r.errors.length).length };
}

/** Column titles for showing a preview. */
export const COLUMN_LABELS: Record<string, string> = {
  sku: "Code",
  name: "Name",
  price: "Price",
  unit: "Unit",
  tax: "VAT type",
  barcode: "Barcode",
  reorder: "Reorder level",
  qty: "Opening quantity",
  cost: "Unit cost",
  company: "Business name",
  phone: "Phone",
  whatsapp: "WhatsApp",
  email: "Email",
  currency: "Currency",
};

/** What step 1 of the import screen shows: the checked file, ready to import. */
export interface ImportPreview {
  kind: ImportKind;
  csv: string;
  /** Where opening stock goes (products only). */
  location: string;
  check: ImportCheck<ProductImportRow> | ImportCheck<CustomerImportRow> | null;
  error: string | null;
}
