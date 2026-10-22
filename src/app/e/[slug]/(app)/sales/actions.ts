"use server";

import { act, amount, currency, optional, quantity, text, UserError, uuid } from "@/server/act";
import type { Query } from "@/server/data";

// Quotes, invoices, payments and enquiries (P8, P13). Documents are created as
// drafts, edited line by line, then submitted (locked and numbered). Submitted
// documents can only be cancelled with a reason, then amended into a new draft.

export type DocKind = "quote" | "invoice";

const DOC = {
  quote: { table: "quotes", lines: "quote_lines", parent: "quote_id", doctype: "quote", path: "/sales/quotes", noun: "Quote" },
  invoice: { table: "sales_invoices", lines: "sales_invoice_lines", parent: "invoice_id", doctype: "sales_invoice", path: "/sales/invoices", noun: "Invoice" },
} as const;

function date(form: FormData, key: string, label: string, required = false): string | null {
  const v = text(form, key);
  if (!v) {
    if (required) throw new UserError(`Please choose ${label}.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new UserError(`Please choose ${label}.`);
  return v;
}

async function headOffice(q: Query, companyId: string, wanted: string | null): Promise<string> {
  const { rows } = await q<{ id: string }>(
    `select id from public.branches where company_id = $1 and archived_at is null and ($2::uuid is null or id = $2::uuid)
     order by is_head_office desc, created_at limit 1`,
    [companyId, wanted],
  );
  if (!rows[0]) throw new UserError("Please choose a branch.");
  return rows[0].id;
}

// --- Creating and editing drafts -------------------------------------------

export async function createDocument(slug: string, kind: DocKind, formData: FormData): Promise<never> {
  const d = DOC[kind];
  return act(
    slug,
    `${d.path}/new`,
    `${d.noun} started. Add the items below.`,
    async (q, ctx) => {
      const customer = uuid(formData, "customer_id", "a customer");
      const cur = currency(formData);
      const branch = await headOffice(q, ctx.company.id, optional(formData, "branch_id"));
      const notes = optional(formData, "notes");
      if (kind === "quote") {
        const lead = optional(formData, "lead_id");
        const id = (
          await q<{ id: string }>(
            `insert into public.quotes (company_id, branch_id, customer_id, currency, valid_until, lead_id, notes)
             values ($1, $2, $3, $4, $5, $6, $7) returning id`,
            [ctx.company.id, branch, customer, cur, date(formData, "valid_until", "a date"), lead, notes],
          )
        ).rows[0].id;
        if (lead) {
          await q("update public.leads set status = 'quoted', quote_id = $3 where company_id = $1 and id = $2 and status in ('new', 'contacted')", [
            ctx.company.id,
            lead,
            id,
          ]);
        }
        return id;
      }
      return (
        await q<{ id: string }>(
          `insert into public.sales_invoices (company_id, branch_id, customer_id, currency, invoice_date, due_date, notes)
           values ($1, $2, $3, $4, coalesce($5::date, current_date), $6, $7) returning id`,
          [ctx.company.id, branch, customer, cur, date(formData, "invoice_date", "the invoice date"), date(formData, "due_date", "a due date"), notes],
        )
      ).rows[0].id;
    },
    { then: (id) => `${d.path}/${id}` },
  );
}

export async function updateHeader(slug: string, kind: DocKind, id: string, formData: FormData): Promise<never> {
  const d = DOC[kind];
  return act(slug, `${d.path}/${id}`, "Saved.", async (q, ctx) => {
    const customer = uuid(formData, "customer_id", "a customer");
    const cur = currency(formData);
    const hasLines = Number((await q<{ n: string }>(`select count(*) as n from public.${d.lines} where ${d.parent} = $1`, [id])).rows[0].n) > 0;
    const before = (await q<{ currency: string }>(`select currency from public.${d.table} where company_id = $1 and id = $2`, [ctx.company.id, id])).rows[0];
    if (hasLines && before && before.currency.trim() !== cur) {
      throw new UserError("Remove the lines before changing the currency, so prices are not mixed up.");
    }
    const r =
      kind === "quote"
        ? await q(
            `update public.quotes set customer_id = $3, currency = $4, valid_until = $5, notes = $6
             where company_id = $1 and id = $2 and docstatus = 0`,
            [ctx.company.id, id, customer, cur, date(formData, "valid_until", "a date"), optional(formData, "notes")],
          )
        : await q(
            `update public.sales_invoices set customer_id = $3, currency = $4, invoice_date = $5, due_date = $6, notes = $7
             where company_id = $1 and id = $2 and docstatus = 0`,
            [ctx.company.id, id, customer, cur, date(formData, "invoice_date", "the invoice date", true), date(formData, "due_date", "a due date"), optional(formData, "notes")],
          );
    if (!r.rowCount) throw new UserError("Only drafts can be changed.");
  });
}

export async function addLine(slug: string, kind: DocKind, id: string, formData: FormData): Promise<never> {
  const d = DOC[kind];
  return act(slug, `${d.path}/${id}`, "Line added.", async (q, ctx) => {
    const product = optional(formData, "product_id");
    const description = optional(formData, "description");
    if (!product && !description) throw new UserError("Choose a product or type a description.");
    const qty = quantity(formData, "quantity");
    const doc = (await q<{ currency: string; docstatus: number }>(`select currency, docstatus from public.${d.table} where company_id = $1 and id = $2`, [ctx.company.id, id])).rows[0];
    if (!doc) throw new UserError("That document no longer exists.");
    let price: number | null = text(formData, "unit_price") ? amount(formData, "unit_price", "a price") : null;
    if (price === null) {
      if (!product) throw new UserError("Please enter a price.");
      const p = (await q<{ cents: string | null }>("select app.price_cents($1, $2, $3) as cents", [ctx.company.id, product, doc.currency])).rows[0].cents;
      if (p === null) throw new UserError("This product has no price yet. Please enter a price.");
      price = Number(p);
    }
    const discount = text(formData, "discount") ? amount(formData, "discount", "a discount") : 0;
    const next = Number((await q<{ n: string }>(`select coalesce(max(line_no), 0) + 1 as n from public.${d.lines} where ${d.parent} = $1`, [id])).rows[0].n);
    await q(
      `insert into public.${d.lines} (company_id, ${d.parent}, line_no, product_id, description, quantity, unit_price_cents, discount_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ctx.company.id, id, next, product, description, qty, price, discount],
    );
  });
}

export async function removeLine(slug: string, kind: DocKind, id: string, formData: FormData): Promise<never> {
  const d = DOC[kind];
  return act(slug, `${d.path}/${id}`, "Line removed.", (q) => q("select public.remove_draft_line($1, $2)", [d.lines, uuid(formData, "line_id")]));
}

// --- Lifecycle ---------------------------------------------------------------

export async function submitDocument(slug: string, kind: DocKind, id: string): Promise<never> {
  const d = DOC[kind];
  return act(slug, `${d.path}/${id}`, `${d.noun} submitted. It is now locked.`, async (q, ctx) => {
    const r = await q(`update public.${d.table} set docstatus = 1 where company_id = $1 and id = $2 and docstatus = 0`, [ctx.company.id, id]);
    if (!r.rowCount) throw new UserError("Only drafts can be submitted.");
  });
}

export async function cancelDocument(slug: string, kind: DocKind, id: string, formData: FormData): Promise<never> {
  const d = DOC[kind];
  return act(slug, `${d.path}/${id}`, `${d.noun} cancelled.`, async (q, ctx) => {
    const reason = text(formData, "reason");
    if (!reason) throw new UserError("Please give a reason for cancelling.");
    const r = await q(`update public.${d.table} set docstatus = 2, cancel_reason = $3 where company_id = $1 and id = $2 and docstatus = 1`, [
      ctx.company.id,
      id,
      reason.slice(0, 500),
    ]);
    if (!r.rowCount) throw new UserError("Only submitted documents can be cancelled, and only by someone allowed to.");
  });
}

export async function amendDocument(slug: string, kind: DocKind, id: string): Promise<never> {
  const d = DOC[kind];
  return act(
    slug,
    `${d.path}/${id}`,
    "A new draft was made from the cancelled document. Correct it and submit.",
    async (q) => (await q<{ id: string }>("select public.amend_document($1, $2) as id", [d.doctype, id])).rows[0].id,
    { then: (newId) => `${d.path}/${newId}` },
  );
}

export async function convertQuote(slug: string, id: string): Promise<never> {
  return act(
    slug,
    `/sales/quotes/${id}`,
    "Invoice drafted from the quote. Check it and submit.",
    async (q) => (await q<{ id: string }>("select public.convert_quote_to_invoice($1) as id", [id])).rows[0].id,
    { then: (invoiceId) => `/sales/invoices/${invoiceId}` },
  );
}

// --- Payments ----------------------------------------------------------------

const METHODS = ["cash", "ecocash", "onemoney", "innbucks", "card", "bank_transfer", "zipit", "store_credit", "other"];

export async function recordPayment(slug: string, formData: FormData): Promise<never> {
  const back = `/sales/payments/new?customer=${encodeURIComponent(text(formData, "customer_id"))}`;
  return act(
    slug,
    back,
    "Payment recorded.",
    async (q, ctx) => {
      const customer = uuid(formData, "customer_id", "a customer");
      const cur = currency(formData);
      const total = amount(formData, "amount", "the amount received", { allowZero: false });
      const method = text(formData, "method");
      if (!METHODS.includes(method)) throw new UserError("Please choose how they paid.");
      const branch = await headOffice(q, ctx.company.id, optional(formData, "branch_id"));
      const allocations: Array<[string, number]> = [];
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith("alloc_") || !String(value).trim()) continue;
        const cents = amount(formData, key, "the amounts against each invoice");
        if (cents > 0) allocations.push([key.slice(6), cents]);
      }
      const allocated = allocations.reduce((s, [, c]) => s + c, 0);
      if (allocated > total) throw new UserError("The amounts against invoices add up to more than the amount received.");
      const id = (
        await q<{ id: string }>(
          `insert into public.payments (company_id, branch_id, customer_id, currency, amount_cents, method, reference, received_on, notes)
           values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::date, current_date), $9) returning id`,
          [ctx.company.id, branch, customer, cur, total, method, optional(formData, "reference"), date(formData, "received_on", "the date"), optional(formData, "notes")],
        )
      ).rows[0].id;
      for (const [invoice, cents] of allocations) {
        await q("insert into public.payment_allocations (company_id, payment_id, invoice_id, amount_cents) values ($1, $2, $3, $4)", [
          ctx.company.id,
          id,
          invoice,
          cents,
        ]);
      }
      await q("update public.payments set docstatus = 1 where id = $1", [id]);
      return id;
    },
    { then: (id) => `/sales/payments/${id}` },
  );
}

export async function cancelPayment(slug: string, id: string, formData: FormData): Promise<never> {
  return act(slug, `/sales/payments/${id}`, "Payment cancelled.", async (q, ctx) => {
    const reason = text(formData, "reason");
    if (!reason) throw new UserError("Please give a reason for cancelling.");
    const r = await q("update public.payments set docstatus = 2, cancel_reason = $3 where company_id = $1 and id = $2 and docstatus = 1", [
      ctx.company.id,
      id,
      reason.slice(0, 500),
    ]);
    if (!r.rowCount) throw new UserError("Only submitted payments can be cancelled, and only by someone allowed to.");
  });
}

// --- Enquiries ---------------------------------------------------------------

const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"];

export async function setLeadStatus(slug: string, id: string, formData: FormData): Promise<never> {
  return act(slug, "/leads", "Enquiry updated.", async (q, ctx) => {
    const status = text(formData, "status");
    if (!LEAD_STATUSES.includes(status)) throw new UserError("Please choose a status.");
    const r = await q("update public.leads set status = $3 where company_id = $1 and id = $2", [ctx.company.id, id, status]);
    if (!r.rowCount) throw new UserError("You do not have permission to do that, or it no longer exists.");
  });
}
