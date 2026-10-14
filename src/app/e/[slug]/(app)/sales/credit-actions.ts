"use server";

import { act, amount, currency, optional, text, UserError, uuid } from "@/server/act";

// Credit notes and refunds (P8). Both are created and submitted in one step
// by database functions, which check permissions, quantities and credit.

export async function createCreditNote(slug: string, invoiceId: string, formData: FormData): Promise<never> {
  return act(
    slug,
    `/sales/invoices/${invoiceId}/credit`,
    "Credit note made.",
    async (q) => {
      const lines: Array<{ invoice_line_id: string; quantity: string }> = [];
      for (const [key, value] of formData.entries()) {
        if (!key.startsWith("qty_")) continue;
        const raw = String(value).trim().replace(/,/g, "");
        if (!raw || Number(raw) === 0) continue;
        if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new UserError("Please check the quantities.");
        lines.push({ invoice_line_id: key.slice(4), quantity: raw });
      }
      if (lines.length === 0) throw new UserError("Enter how many of each item to credit.");
      const reason = text(formData, "reason");
      if (!reason) throw new UserError("Please give a reason for the credit note.");
      return (
        await q<{ id: string }>("select public.create_credit_note($1, $2, $3, $4) as id", [invoiceId, JSON.stringify(lines), reason, formData.get("return_stock") === "on"])
      ).rows[0].id;
    },
    { then: (id) => `/sales/credit-notes/${id}` },
  );
}

export async function cancelCreditNote(slug: string, id: string, formData: FormData): Promise<never> {
  return act(slug, `/sales/credit-notes/${id}`, "Credit note cancelled.", async (q) => {
    const reason = text(formData, "reason");
    if (!reason) throw new UserError("Please give a reason for cancelling.");
    await q("select public.cancel_credit_note($1, $2)", [id, reason]);
  });
}

const METHODS = ["cash", "ecocash", "onemoney", "innbucks", "card", "bank_transfer", "zipit", "other"];

export async function recordRefund(slug: string, formData: FormData): Promise<never> {
  const customer = text(formData, "customer_id");
  return act(
    slug,
    `/sales/refunds/new?customer=${encodeURIComponent(customer)}`,
    "Refund recorded.",
    async (q) => {
      const method = text(formData, "method");
      if (!METHODS.includes(method)) throw new UserError("Please choose how the money is paid back.");
      return (
        await q<{ id: string }>("select public.record_refund($1, $2, $3, $4, $5, $6, $7, $8) as id", [
          uuid(formData, "customer_id", "a customer"),
          currency(formData),
          amount(formData, "amount", "the amount", { allowZero: false }),
          method,
          optional(formData, "reference"),
          optional(formData, "credit_note_id"),
          formData.get("from_till") === "on" ? uuid(formData, "till_session_id", "your till") : null,
          optional(formData, "notes"),
        ])
      ).rows[0].id;
    },
    { then: (id) => `/sales/refunds/${id}` },
  );
}
